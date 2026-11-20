import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {initializeMember} from './member-management.mjs';
import {WechatMiniIdentity} from '../channels/wechat-mini.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {fail} from './errors.mjs';
import {assertConsumerConsent} from './consumer-consent.mjs';
import {readConsumerSettings,nextMemberNumber} from './tenant-consumer-settings.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const input=z.object({tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),applicationKey:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),code:z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),consent:z.object({terms:z.number().int().positive().optional(),privacy:z.number().int().positive().optional()}).strict().optional()}).strict();
export const identityAad=row=>['consumer-identity',row.tenantId,row.applicationKey,row.provider,row.appId,row.subjectHash].join(':');
export const wechatSessionAad=s=>['wechat-session',s.tenantId,s.applicationKey,s.userId,s.authAppId,s.token].join(':');
export class WechatConsumerAuth {
 constructor(db,redis,settings,{client=new WechatMiniIdentity()}={}){this.db=db;this.redis=redis;this.settings=settings;this.client=client}
 async bindPhone(s,body,phoneAuth){
  const parsed=z.object({code:z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),password:z.string().max(128).optional()}).strict().safeParse(body);
  if(!parsed.success)fail('WECHAT_PHONE_INPUT','请重新发起微信手机号授权',400);const q=parsed.data;
  if(s?.role!=='user'||s.authProvider!=='wechat'||!s.authAppId)fail('WECHAT_LOGIN_REQUIRED','请先使用微信登录，再授权手机号',401);
  await phoneAuth.available(s,'bind');await phoneAuth.session(s,s);
  const attempts=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n",1,'wechat-phone-session:'+hash(s.token)));
  if(attempts>10)fail('WECHAT_PHONE_LIMIT','手机号授权过于频繁，请稍后再试',429);
  await phoneAuth.bindingPassword(s,q.password);
  const credential=await this.settings.credentials(s.tenantId,s.applicationKey);
  if(s.authAppId!==credential.appId)fail('WECHAT_LOGIN_REQUIRED','小程序登录配置已变化，请重新使用微信登录',401);
  const where={tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,provider:'wechat',appId:credential.appId},bound=await this.db.consumerExternalIdentity.findFirst({where});
  let openId;try{openId=bound&&this.settings.secrets.decrypt(identityAad(bound),bound.identityCipher).openId}catch{}
  if(typeof openId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(openId)||hash(openId)!==bound?.subjectHash)fail('WECHAT_LOGIN_REQUIRED','微信身份已变化，请重新登录',401);
  const subjectHash=bound.subjectHash,identityCipher=bound.identityCipher;
  if(await this.redis.set('wechat-phone-code:'+hash(credential.appId+'|'+q.code),'used','EX',300,'NX')!=='OK')fail('WECHAT_PHONE_CODE_INVALID','手机号授权已使用，请先查看当前绑定号码，需要更换时重新授权',409);
  const phone=await this.client.phone(credential,q.code,openId);
  return phoneAuth.bindVerifiedPhone(s,phone,{password:q.password,source:'wechat',guard:async db=>{
   const current=await this.settings.credentials(s.tenantId,s.applicationKey,db);
   if(current.version!==credential.version||current.appId!==credential.appId)fail('MINI_CONFIG_CONFLICT','小程序配置已变化，请重新登录后授权',409);
   const session=await db.session.findFirst({where:{token:s.token,tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,role:'user',authProvider:'wechat',authAppId:credential.appId,expiresAt:{gt:new Date()}}}),identity=await db.consumerExternalIdentity.findFirst({where});
   if(!session||identity?.subjectHash!==subjectHash||identity?.identityCipher!==identityCipher)fail('WECHAT_LOGIN_REQUIRED','微信身份已变化，请重新登录',401);
  }});
 }
 async login(body,ip){
  const parsed=input.safeParse(body);if(!parsed.success)fail('WECHAT_LOGIN_INVALID','微信登录参数无效',400);const q=parsed.data;
  const count=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",1,'wechat-login-ip:'+hash(ip)));if(count>60)fail('WECHAT_LOGIN_LIMIT','登录过于频繁，请稍后重试',429);
  await assertConsumerConsent(this.db,q.tenantId,q.applicationKey,q.consent);
  const credential=await this.settings.credentials(q.tenantId,q.applicationKey);
  if(await this.redis.set('wechat-login-code:'+hash(credential.appId+'|'+q.code),'used','EX',300,'NX')!=='OK')fail('WECHAT_CODE_INVALID','登录凭证已使用，请重新登录',401);
  const identity=await this.client.exchange(credential,q.code);
  if(typeof identity?.openId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(identity.openId))fail('WECHAT_LOGIN_UNAVAILABLE','微信身份验证未通过',503);
  return this.settings.apps.transaction(async db=>{
   await this.settings.apps.available(q.tenantId,q.applicationKey,db,true);const policies=await assertConsumerConsent(db,q.tenantId,q.applicationKey,q.consent);const current=await this.settings.credentials(q.tenantId,q.applicationKey,db);if(current.version!==credential.version||current.appId!==credential.appId)fail('MINI_CONFIG_CONFLICT','登录配置已变化，请重新登录',409);
   const where={tenantId:q.tenantId,applicationKey:q.applicationKey,provider:'wechat',appId:credential.appId,subjectHash:hash(identity.openId)},bound=await db.consumerExternalIdentity.findFirst({where});
   let userId=bound?.userId;
   if(!bound){
    if(!(await readConsumerSettings(db,q.tenantId,q.applicationKey)).config.registration.autoRegister)fail('AUTO_REGISTER_DISABLED','本站已关闭微信新用户自动注册，请联系管理员',403);
    userId='wx'+randomBytes(16).toString('hex');const memberNumber=await nextMemberNumber(db,q.tenantId,q.applicationKey);
    await db.consumerProfile.create({data:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId,nickname:'微信用户',memberNumber}});await initializeMember(db,q.tenantId,q.applicationKey,userId);this.settings.secrets.key(false);const identityCipher=this.settings.secrets.encrypt(identityAad(where),{openId:identity.openId});await db.consumerExternalIdentity.create({data:{...where,userId,identityCipher}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:q.tenantId,applicationKey:q.applicationKey,actor:'consumer:'+hash(userId).slice(0,48),action:'consumer.wechat.register',details:{userId}}})}
   await assertConsumerActive(db,q.tenantId,q.applicationKey,userId);const profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId}}});if(!profile)fail('WECHAT_ACCOUNT_UNAVAILABLE','关联账号不可用，请联系管理员',403);
   if(policies.length)await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:q.tenantId,applicationKey:q.applicationKey,actor:'consumer:'+hash(userId).slice(0,48),action:'consumer.policy.consent',details:{policies}}});
   const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*3600000),session={token:hash(token),tenantId:q.tenantId,applicationKey:q.applicationKey,userId,role:'user',authProvider:'wechat',authAppId:credential.appId,expiresAt};
   if(typeof identity.sessionKey!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(identity.sessionKey))fail('WECHAT_LOGIN_UNAVAILABLE','微信会话验证未通过，请重新登录后重试',503);
   await this.settings.secrets.assertExistingKey(db);
   await db.session.create({data:{...session,wechatSessionCipher:this.settings.secrets.encrypt(wechatSessionAad(session),{openId:identity.openId,sessionKey:identity.sessionKey})}});
   return{token,tenantId:q.tenantId,applicationKey:q.applicationKey,userId,role:'user',expiresAt,authProvider:'wechat',authAppId:credential.appId};
  });
 }
}
