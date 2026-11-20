import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assertConsumerConsent} from './consumer-consent.mjs';
import {fail} from './errors.mjs';
import {h5Origin,h5Host,isH5PlatformHost} from './h5-entry.mjs';
import {readConsumerSettings,nextMemberNumber} from './tenant-consumer-settings.mjs';
import {initializeMember} from './member-management.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {identityAad} from './wechat-consumer-auth.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const cookieName=state=>'qicore_h5_oauth_'+state;
const cookieValue=(cookies,name)=>String(cookies||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
const opaque=z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const takeScript="local v=redis.call('GET',KEYS[1]);if v==ARGV[1] then redis.call('DEL',KEYS[1]);return v end;return false";
export class OfficialOAuthClient {
 async exchange(credentials,code){
  const url=new URL('https://api.weixin.qq.com/sns/oauth2/access_token');url.search=new URLSearchParams({appid:credentials.appId,secret:credentials.appSecret,code,grant_type:'authorization_code'}).toString();
  try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000)}),text=await response.text();if(!response.ok||text.length>64000)throw Error();const value=JSON.parse(text);if(value.errcode||typeof value.openid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.openid))throw Error();return{openId:value.openid}}
  catch{fail('OFFICIAL_LOGIN_FAILED','公众号网页授权未完成，请重新登录',401)}
 }
}
export class OfficialConsumerAuth {
 constructor(db,redis,settings,h5,{client=new OfficialOAuthClient()}={}){this.db=db;this.redis=redis;this.settings=settings;this.h5=h5;this.client=client}
 async credentials(tenantId,key,db=this.db){await this.settings.available(tenantId,key,db);const row=await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:key}}});if(!row?.config.appId||!row.keyCipher)fail('OFFICIAL_LOGIN_UNAVAILABLE','本站公众号网页授权尚未配置',409);const secret=this.settings.decrypt(row);if(!secret.appSecret)fail('OFFICIAL_LOGIN_UNAVAILABLE','本站公众号网页授权尚未配置',409);return{appId:row.config.appId,appSecret:secret.appSecret,version:row.version}}
 cookie(state,value,origin,maxAge=300){return cookieName(state)+'='+value+'; Path=/api/v1/consumer/auth/official; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(origin.startsWith('https:')?'; Secure':'')}
 async start(input,ip,session=null){
  const parsed=z.object({host:z.string().max(300),tenantId:z.string().max(64),applicationKey:z.string().max(64),consent:z.object({terms:z.number().int().positive().optional(),privacy:z.number().int().positive().optional()}).strict().optional(),returnPath:z.string().max(1000).regex(/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?(?:\?[^#\s<>]*)?$/).default('/')}).strict().safeParse(input);if(!parsed.success)fail('OFFICIAL_LOGIN_INVALID','网页授权参数无效');const q=parsed.data;
  const n=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",1,'official-oauth-ip:'+hash(ip)));if(n>30)fail('OFFICIAL_LOGIN_LIMIT','登录过于频繁，请稍后重试',429);
  await this.h5.resolve({host:q.host,tenantId:q.tenantId,applicationKey:q.applicationKey});if(!session)await assertConsumerConsent(this.db,q.tenantId,q.applicationKey,q.consent);const credentials=await this.credentials(q.tenantId,q.applicationKey),origin=isH5PlatformHost(q.host)?h5Origin().origin:'https://'+h5Host(q.host),state=randomBytes(24).toString('base64url'),browser=randomBytes(24).toString('base64url');
  if(session&&(session.tenantId!==q.tenantId||session.applicationKey!==q.applicationKey||session.role!=='user'))fail('OFFICIAL_SCOPE_MISMATCH','绑定范围不匹配',403);
  await this.redis.set('official-oauth-state:'+state,JSON.stringify({...q,origin,appId:credentials.appId,version:credentials.version,browserHash:hash(browser),...(session?{binding:{userId:session.userId,token:session.token}}:{})}),'EX',300);
  const url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');url.search=new URLSearchParams({appid:credentials.appId,redirect_uri:origin+'/api/v1/consumer/auth/official/callback',response_type:'code',scope:'snsapi_base',state}).toString();url.hash='wechat_redirect';return{url:url.href,cookie:this.cookie(state,browser,origin)};
 }
 async callback(query,cookies){
  const parsed=z.object({state:opaque,code:z.string().min(1).max(256)}).strict().safeParse(query);if(!parsed.success)fail('OFFICIAL_LOGIN_INVALID','网页授权已取消或失效',400);const q=parsed.data,key='official-oauth-state:'+q.state,raw=await this.redis.get(key);if(!raw)fail('OFFICIAL_STATE_EXPIRED','网页授权已过期，请重新登录',401);const state=JSON.parse(raw),browser=cookieValue(cookies,cookieName(q.state));if(!browser||hash(browser)!==state.browserHash)fail('OFFICIAL_BROWSER_MISMATCH','请在发起授权的浏览器中完成登录',401);
  if(!await this.redis.eval(takeScript,1,key,raw))fail('OFFICIAL_STATE_EXPIRED','网页授权已使用，请重新登录',401);
  await this.h5.resolve({host:state.host,tenantId:state.tenantId,applicationKey:state.applicationKey});const credentials=await this.credentials(state.tenantId,state.applicationKey);if(credentials.appId!==state.appId||credentials.version!==state.version)fail('OFFICIAL_CONFIG_CHANGED','公众号配置已变化，请重新登录',409);
  if(await this.redis.set('official-oauth-code:'+hash(state.appId+'|'+q.code),'used','EX',300,'NX')!=='OK')fail('OFFICIAL_CODE_USED','授权凭证已使用，请重新登录',401);
  const verified=await this.client.exchange(credentials,q.code);if(typeof verified?.openId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(verified.openId))fail('OFFICIAL_LOGIN_FAILED','公众号身份验证未通过',401);
  const session=await this.settings.apps.transaction(async db=>{
   const tenantId=state.tenantId,applicationKey=state.applicationKey;if(!state.binding){const policies=await assertConsumerConsent(db,tenantId,applicationKey,state.consent);if(policies.length)await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:'consumer-oauth:'+hash(q.state).slice(0,40),action:'consumer.policy.consent',details:{policies}}})}await this.settings.available(tenantId,applicationKey,db,true);const current=await this.credentials(tenantId,applicationKey,db);if(current.appId!==credentials.appId||current.version!==credentials.version)fail('OFFICIAL_CONFIG_CHANGED','公众号配置已变化，请重新登录',409);
   const identity={tenantId,applicationKey,provider:'wechat-official',appId:credentials.appId,subjectHash:hash(verified.openId)},bound=await db.consumerExternalIdentity.findFirst({where:identity});let userId=bound?.userId;
   if(state.binding){if(!await db.session.findFirst({where:{token:state.binding.token,tenantId,applicationKey,userId:state.binding.userId,role:'user',expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','原登录会话已失效，请重新绑定',401);if(bound&&bound.userId!==state.binding.userId)fail('OFFICIAL_ALREADY_BOUND','该微信身份已绑定其他账号，不能自动合并',409);userId=state.binding.userId;await assertConsumerActive(db,tenantId,applicationKey,userId);if(await db.consumerExternalIdentity.findFirst({where:{tenantId,applicationKey,provider:'wechat-official',appId:credentials.appId,userId,subjectHash:{not:identity.subjectHash}}}))fail('OFFICIAL_ACCOUNT_ALREADY_BOUND','当前账号已绑定其他微信身份',409)}
   if(!bound){if(!userId){if(!(await readConsumerSettings(db,tenantId,applicationKey)).config.registration.autoRegister)fail('AUTO_REGISTER_DISABLED','本站已关闭新用户自动注册，请联系管理员',403);userId='wx'+randomBytes(16).toString('hex');const memberNumber=await nextMemberNumber(db,tenantId,applicationKey);await db.consumerProfile.create({data:{tenantId,applicationKey,userId,nickname:'',memberNumber}});await initializeMember(db,tenantId,applicationKey,userId)}await this.settings.secrets.assertExistingKey(db);await db.consumerExternalIdentity.create({data:{...identity,userId,identityCipher:this.settings.secrets.encrypt(identityAad(identity),{openId:verified.openId})}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:'consumer:'+hash(userId).slice(0,48),action:state.binding?'consumer.official.bind':'consumer.official.register',details:{userId}}})}
   await assertConsumerActive(db,tenantId,applicationKey,userId);const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*3600000);await db.session.create({data:{token:hash(token),tenantId,applicationKey,userId,role:'user',authProvider:'wechat-official',authAppId:credentials.appId,expiresAt}});return{token,tenantId,applicationKey,userId,expiresAt,authProvider:'wechat-official',authAppId:credentials.appId};
  });
  const ticket=randomBytes(24).toString('base64url');await this.redis.set('official-oauth-ticket:'+ticket,JSON.stringify({state:q.state,browserHash:state.browserHash,origin:state.origin,payload:this.settings.secrets.encrypt('official-ticket:'+ticket,{session,returnPath:state.returnPath})}),'EX',60);
  return{url:state.origin+(isH5PlatformHost(state.host)?'/h5/'+encodeURIComponent(state.tenantId)+'/':'/')+'login?'+new URLSearchParams({ticket}).toString()};
 }
 async exchange(body,cookies){
  const q=z.object({ticket:opaque}).strict().safeParse(body);if(!q.success)fail('OFFICIAL_TICKET_INVALID','登录凭证无效',401);const key='official-oauth-ticket:'+q.data.ticket,raw=await this.redis.get(key);if(!raw)fail('OFFICIAL_TICKET_EXPIRED','登录凭证已过期，请重新登录',401);const row=JSON.parse(raw),browser=cookieValue(cookies,cookieName(row.state));if(!browser||hash(browser)!==row.browserHash)fail('OFFICIAL_BROWSER_MISMATCH','请在原浏览器中完成登录',401);if(!await this.redis.eval(takeScript,1,key,raw))fail('OFFICIAL_TICKET_EXPIRED','登录凭证已使用',401);
  const payload=this.settings.secrets.decrypt('official-ticket:'+q.data.ticket,row.payload);await this.settings.available(payload.session.tenantId,payload.session.applicationKey);await assertConsumerActive(this.db,payload.session.tenantId,payload.session.applicationKey,payload.session.userId);if(!await this.db.session.findUnique({where:{token:hash(payload.session.token)}}))fail('UNAUTHENTICATED','会话已失效',401);
  return{data:{...payload.session,returnPath:payload.returnPath},cookie:this.cookie(row.state,'',row.origin,0)};
 }
}
