import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,randomInt,randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {readConsumerSettings,nextMemberNumber} from './tenant-consumer-settings.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {initializeMember} from './member-management.mjs';
import {assertConsumerConsent} from './consumer-consent.mjs';
import {passwordHash,passwordMatches} from './admin-auth.mjs';
import {smsConfig,templateFields,validateSmsCredentials,SmsProviderError} from '../channels/sms.mjs';
import {fail} from './errors.mjs';

const identity=z.object({tenantId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/,'须为 1–64 个小写字母、数字或短横线，以字母或数字开头'),phone:z.string().regex(/^1[3-9]\d{9}$/,'须为有效的 11 位手机号')});
const consent=z.object({terms:z.number().int().positive().optional(),privacy:z.number().int().positive().optional()}).strict().optional();
const parse=(schema,input)=>{const q=schema.safeParse(input);if(!q.success)fail('SMS_AUTH_INPUT',formValidationMessage(q.error));return q.data};
const hash=value=>createHash('sha256').update(value).digest('hex');
// Check and consume atomically; wrong attempts preserve the original TTL.
export const consumeSmsChallenge="local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local v=cjson.decode(raw);if not v.ready or v.attempts>=5 then return 0 end;v.attempts=v.attempts+1;if v.digest==ARGV[1] then redis.call('DEL',KEYS[1]);return 1 end;local ttl=redis.call('PTTL',KEYS[1]);if ttl>0 then redis.call('SET',KEYS[1],cjson.encode(v),'PX',ttl) end;return 0";
const activateChallenge="local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local v=cjson.decode(raw);if v.requestId~=ARGV[1] then return 0 end;local ttl=redis.call('PTTL',KEYS[1]);if ttl<=0 then return 0 end;v.ready=true;redis.call('SET',KEYS[1],cjson.encode(v),'PX',ttl);return 1";

export class ConsumerSmsAuth {
 constructor(db,redis,sms,{sendEnabled=process.env.SMS_AUTH_SEND_ENABLED==='true'}={}){this.db=db;this.redis=redis;this.sms=sms;this.apps=new TenantApplications(db);this.sendEnabled=sendEnabled}
 subject(q){return this.sms.digest(q.tenantId,q.applicationKey,q.phone)}
 challenge(q,purpose){return 'consumer-sms:'+q.tenantId+':'+q.applicationKey+':'+purpose+':'+this.subject(q)}
 where(q){return {tenantId_applicationKey_provider_appId_subjectHash:{tenantId:q.tenantId,applicationKey:q.applicationKey,provider:'sms',appId:'phone',subjectHash:this.subject(q)}}}
 async available(q,purpose,db=this.db,lock=false){await this.apps.available(q.tenantId,q.applicationKey,db,lock);const settings=(await readConsumerSettings(db,q.tenantId,q.applicationKey)).config.registration;if(purpose==='login'&&!settings.smsLoginEnabled)fail('SMS_LOGIN_DISABLED','本站尚未开启手机号验证码登录',403);return settings}
 async send(body,ip,session){
  const q=parse(identity.extend({purpose:z.enum(['login','reset','bind']),requestId:z.uuid(),consent}).strict(),body);
  await this.available(q,q.purpose);if(q.purpose==='bind')await this.session(q,session);if(q.purpose==='login')await assertConsumerConsent(this.db,q.tenantId,q.applicationKey,q.consent);
  if(!this.sendEnabled)fail('SMS_AUTH_NOT_READY','当前环境尚未开放短信验证码发送，请联系管理员配置',503);
  const row=await this.db.tenantSmsSetting.findUnique({where:{tenantId_applicationKey:{tenantId:q.tenantId,applicationKey:q.applicationKey}}}),provider=row?.config.defaultProvider;
  if(!provider)fail('SMS_CONFIG_INCOMPLETE','本站尚未配置短信服务，请联系管理员',503);
  const config=smsConfig(provider,row.config.channels[provider]),credentials=this.sms.decrypt(row)[provider]||{},purpose=q.purpose==='bind'?'register':q.purpose;validateSmsCredentials(provider,config,credentials,true);
  if(!config[templateFields[purpose]])fail('SMS_TEMPLATE_REQUIRED','本站尚未配置该用途的验证码模板',503);
  const phoneHash=this.subject(q),payloadHash=hash(JSON.stringify([phoneHash,q.purpose,session?.userId||null])),scope={tenantId:q.tenantId,applicationKey:q.applicationKey},where={tenantId_applicationKey_requestId:{...scope,requestId:q.requestId}};
  const existing=await this.db.tenantSmsDelivery.findUnique({where});if(existing){if(existing.payloadHash!==payloadHash)fail('SMS_REQUEST_CONFLICT','验证码请求已用于其他操作',409);if(existing.status==='ACCEPTED')return{accepted:true,retryAfterSeconds:config.intervalSeconds};fail('SMS_RESULT_UNKNOWN','原发送请求尚未确认，请先核对发送记录',503)}
  await this.sms.limit(q.tenantId,q.applicationKey,phoneHash,ip,config);
  const code=String(randomInt(100000,1000000)),key=this.challenge(q,q.purpose),digest=this.sms.digest(q.tenantId,q.applicationKey,[q.requestId,q.purpose,phoneHash,code]);
  await this.redis.set(key,JSON.stringify({requestId:q.requestId,digest,ready:false,attempts:0}),'EX',600);
  const log=await this.apps.transaction(async db=>{await this.available(q,q.purpose,db,true);return db.tenantSmsDelivery.create({data:{id:randomUUID(),...scope,requestId:q.requestId,actorId:'consumer-auth:'+q.purpose,provider,purpose,phoneHash,phoneMasked:q.phone.slice(0,3)+'****'+q.phone.slice(-4),payloadHash,settingsVersion:row.version,status:'SENDING'}})});
  let dispatched=false;
  try{
   await this.available(q,q.purpose);const current=await this.db.tenantSmsSetting.findUnique({where:{tenantId_applicationKey:scope}});if(current?.version!==row.version)fail('SMS_CONFIG_CONFLICT','短信配置已变化，请重新获取验证码',409);
   dispatched=true;const receipt=await this.sms.transport.send(provider,config,credentials,q.phone,purpose,code);
   await this.db.tenantSmsDelivery.update({where:{id:log.id},data:{status:'ACCEPTED',receipt}});await this.redis.eval(activateChallenge,1,key,q.requestId);
   return{accepted:true,retryAfterSeconds:config.intervalSeconds};
  }catch(e){await this.db.tenantSmsDelivery.updateMany({where:{id:log.id,status:'SENDING'},data:{status:!dispatched||e instanceof SmsProviderError?'FAILED':'UNKNOWN',errorCode:e instanceof SmsProviderError?e.providerCode:'SMS_AUTH_UNCONFIRMED'}});if(!dispatched)throw e;fail(e instanceof SmsProviderError?'SMS_SEND_REJECTED':'SMS_RESULT_UNKNOWN',e instanceof SmsProviderError?'短信服务商拒绝发送，请联系管理员检查配置':'验证码发送结果未确认，请核对发送记录，勿重复发送',503)}
 }
 async consume(q,purpose){
  const key=this.challenge(q,purpose),raw=await this.redis.get(key);let challenge;try{challenge=JSON.parse(raw)}catch{}
  if(!challenge?.requestId)fail('SMS_CODE_INVALID','验证码错误、已失效或已使用',400);
  const digest=this.sms.digest(q.tenantId,q.applicationKey,[challenge.requestId,purpose,this.subject(q),q.code]);
  if(Number(await this.redis.eval(consumeSmsChallenge,1,key,digest))!==1)fail('SMS_CODE_INVALID','验证码错误、已失效或已使用',400);
 }
 async login(body){
  const q=parse(identity.extend({code:z.string().regex(/^\d{6}$/,'须为 6 位数字'),consent}).strict(),body);await this.available(q,'login');await assertConsumerConsent(this.db,q.tenantId,q.applicationKey,q.consent);await this.consume(q,'login');
  return this.apps.transaction(async db=>{
   const settings=await this.available(q,'login',db,true),policies=await assertConsumerConsent(db,q.tenantId,q.applicationKey,q.consent),bound=await db.consumerExternalIdentity.findUnique({where:this.where(q)});let userId=bound?.userId;
   // A verified phone is a separate identity. Never merge an editable profile phone or another application's account.
   if(!userId){if(!settings.autoRegister)fail('AUTO_REGISTER_DISABLED','该手机号尚未绑定账号，请使用账号密码登录后绑定手机号',403);userId='sms'+randomBytes(12).toString('hex');const memberNumber=await nextMemberNumber(db,q.tenantId,q.applicationKey);await db.consumerProfile.create({data:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId,nickname:'',phone:q.phone,memberNumber}});await initializeMember(db,q.tenantId,q.applicationKey,userId);await this.bind(db,q,userId)}
   if(!await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId}}}))fail('UNAUTHENTICATED','账号不存在',401);await assertConsumerActive(db,q.tenantId,q.applicationKey,userId);const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*3600000);
   await db.session.create({data:{token:hash(token),tenantId:q.tenantId,applicationKey:q.applicationKey,userId,role:'user',authProvider:'sms',expiresAt}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:q.tenantId,applicationKey:q.applicationKey,actor:'consumer:'+hash(userId).slice(0,48),action:'consumer.sms.login',details:{policies}}});
   return{token,tenantId:q.tenantId,applicationKey:q.applicationKey,userId,role:'user',expiresAt};
  });
 }
 async reset(body){
  const q=parse(identity.extend({code:z.string().regex(/^\d{6}$/,'须为 6 位数字'),password:z.string().min(6).max(128)}).strict(),body);await this.available(q,'reset');await this.consume(q,'reset');const secret=await passwordHash(q.password);
  return this.apps.transaction(async db=>{await this.available(q,'reset',db,true);const bound=await db.consumerExternalIdentity.findUnique({where:this.where(q)});if(!bound)fail('PHONE_NOT_BOUND','该手机号尚未验证绑定账号，请联系管理员找回',409);await assertConsumerActive(db,q.tenantId,q.applicationKey,bound.userId);const identity={tenantId:q.tenantId,applicationKey:q.applicationKey,userId:bound.userId};await db.consumerProfile.update({where:{tenantId_applicationKey_userId:identity},data:{passwordHash:secret,version:{increment:1}}});await db.session.deleteMany({where:identity});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:q.tenantId,applicationKey:q.applicationKey,actor:'consumer:'+hash(bound.userId).slice(0,48),action:'consumer.password.reset',details:{userId:bound.userId}}});return{updated:true,account:bound.userId}});
 }
 async session(q,s,db=this.db){if(!s||s.tenantId!==q.tenantId||s.applicationKey!==q.applicationKey||!await db.session.findFirst({where:{token:s.token,tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,role:'user',expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','请重新登录后绑定手机号',401);await assertConsumerActive(db,s.tenantId,s.applicationKey,s.userId)}
 async bind(db,q,userId){const values=this.where(q).tenantId_applicationKey_provider_appId_subjectHash;await this.sms.secrets.assertExistingKey(db);return db.consumerExternalIdentity.create({data:{...values,userId,identityCipher:this.sms.secrets.encrypt('consumer-phone:'+q.tenantId+':'+q.applicationKey+':'+values.subjectHash,{phone:q.phone})}})}
 async binding(s){await this.available(s,'bind');await this.session(s,s);const row=await this.db.consumerExternalIdentity.findFirst({where:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,provider:'sms',appId:'phone'}});return{phone:row?this.sms.secrets.decrypt('consumer-phone:'+s.tenantId+':'+s.applicationKey+':'+row.subjectHash,row.identityCipher).phone:null}}
 async bindingPassword(s,password,db=this.db){const profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId}}});if(profile?.passwordHash&&!await passwordMatches(password||'',profile.passwordHash))fail('PASSWORD_INVALID','请输入当前账号的正确密码后绑定手机号',400)}
 async bindPhone(s,body){const q=parse(identity.extend({code:z.string().regex(/^\d{6}$/,'须为 6 位数字'),password:z.string().max(128).optional()}).strict(),{...body,tenantId:s.tenantId,applicationKey:s.applicationKey});await this.available(q,'bind');await this.session(q,s);await this.consume(q,'bind');return this.bindVerifiedPhone(s,q.phone,{password:q.password})}
 async bindVerifiedPhone(s,phone,{password,source='sms',guard=async()=>{}}={}){const q=parse(identity.extend({password:z.string().max(128).optional()}).strict(),{tenantId:s.tenantId,applicationKey:s.applicationKey,phone,password});return this.apps.transaction(async db=>{await this.available(q,'bind',db,true);await this.session(q,s,db);await guard(db);const bound=await db.consumerExternalIdentity.findUnique({where:this.where(q)});if(bound&&bound.userId!==s.userId)fail('PHONE_ALREADY_BOUND','该手机号已绑定其他账号，不能自动合并',409);if(!bound){await this.bindingPassword(s,q.password,db);await db.consumerExternalIdentity.deleteMany({where:{tenantId:s.tenantId,applicationKey:s.applicationKey,provider:'sms',appId:'phone',userId:s.userId}});await this.bind(db,q,s.userId)}await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:s.tenantId,applicationKey:s.applicationKey,actor:'consumer:'+hash(s.userId).slice(0,48),action:'consumer.phone.bind',details:{subjectHash:this.subject(q),source}}});return{bound:true,phone:q.phone}})}
}
