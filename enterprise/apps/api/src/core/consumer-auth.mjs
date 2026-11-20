import {formValidationMessage} from './form-validation.mjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {passwordHash,passwordMatches} from './admin-auth.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {fail} from './errors.mjs';
import {readConsumerSettings,nextMemberNumber} from './tenant-consumer-settings.mjs';
import {assertConsumerConsent} from './consumer-consent.mjs';
import {initializeMember} from './member-management.mjs';
import {consumerPolicies} from './consumer-consent.mjs';
import {consumerTheme} from './consumer-theme.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const input=z.object({tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/,'须为 1–64 个小写字母、数字或短横线，以字母或数字开头'),account:z.string().trim().min(1).max(64),password:z.string().min(1).max(128),loginType:z.enum(['account','phone','auto']).default('auto'),consent:z.object({terms:z.number().int().positive().optional(),privacy:z.number().int().positive().optional()}).strict().optional()}).strict();
export class ConsumerAuth {
 /** @param {any} db @param {any} redis @param {{phoneDigest?:((tenantId:string,key:string,phone:string)=>string|undefined)|null}} options */
 constructor(db,redis,{phoneDigest=null}={}){this.phoneDigest=phoneDigest;this.db=db;this.redis=redis;this.applications=new TenantApplications(db);this.dummy=passwordHash(randomBytes(32).toString('hex'))}
 async settings(input){
  const parsed=z.object({tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/,'须为 1–64 个小写字母、数字或短横线，以字母或数字开头')}).strict().safeParse(input);
  if(!parsed.success)fail('CONSUMER_SETTINGS_INVALID','站点参数无效');const {tenantId,applicationKey}=parsed.data;
  await this.applications.available(tenantId,applicationKey);
  const {config}=await readConsumerSettings(this.db,tenantId,applicationKey),tenant=await this.db.tenant.findUnique({where:{id:tenantId}}),brand=await this.db.tenantSiteSetting.findUnique({where:{tenantId}}),policies=await consumerPolicies(this.db,tenantId,applicationKey);
  const theme=await consumerTheme(this.db,tenantId,applicationKey);
  await this.applications.available(tenantId,applicationKey);return{siteName:brand?.config.name||tenant?.name||'QiCore',registration:config.registration,policies,theme};
 }
 async register(body,ip){
  const parsed=input.extend({loginType:z.literal('account').optional(),account:z.string().regex(/^[a-zA-Z0-9]{3,64}$/,'须为 3–64 个英文字母或数字'),password:z.string().min(6).max(128)}).safeParse(body);if(!parsed.success)fail('CONSUMER_REGISTER_INVALID',formValidationMessage(parsed.error));const q=parsed.data;
  const count=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],3600) end;return n",1,'consumer-register:'+hash(ip)));if(count>10)fail('CONSUMER_LOGIN_LIMIT','注册过于频繁，请稍后重试',429);
  await this.applications.available(q.tenantId,q.applicationKey);const secret=await passwordHash(q.password);
  await this.applications.transaction(async db=>{await this.applications.available(q.tenantId,q.applicationKey,db,true);await assertConsumerConsent(db,q.tenantId,q.applicationKey,q.consent);const registration=(await readConsumerSettings(db,q.tenantId,q.applicationKey)).config.registration;if(!registration.passwordLoginEnabled)fail('PASSWORD_LOGIN_DISABLED','本站已关闭账号密码登录',403);if(!registration.autoRegister)fail('AUTO_REGISTER_DISABLED','本站暂不开放新用户注册',403);const identity={tenantId:q.tenantId,applicationKey:q.applicationKey,userId:q.account};if(await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:identity}}))fail('CONSUMER_EXISTS','该账号不可注册，请更换账号',409);const memberNumber=await nextMemberNumber(db,q.tenantId,q.applicationKey);await db.consumerProfile.create({data:{...identity,nickname:'',memberNumber,passwordHash:secret}});await initializeMember(db,q.tenantId,q.applicationKey,q.account);await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:q.tenantId,applicationKey:q.applicationKey,actor:'consumer:'+hash(q.account).slice(0,48),action:'consumer.password.register',details:{userId:q.account}}})});
  return this.login({...body,loginType:'account'},ip);
 }
 async changePassword(s,body){
  const parsed=z.object({oldPassword:z.string().max(128),password:z.string().min(6).max(128)}).strict().safeParse(body);if(!parsed.success)fail('PASSWORD_INVALID',formValidationMessage(parsed.error,{password:'新密码'}));const q=parsed.data,identity={tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId},where={tenantId_applicationKey_userId:identity};
  const attempts=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],900) end;return n",1,'consumer-password:'+hash(String(s.token))));if(attempts>10)fail('CONSUMER_LOGIN_LIMIT','尝试过于频繁，请稍后再试',429);
  await this.applications.available(s.tenantId,s.applicationKey);const profile=await this.db.consumerProfile.findUnique({where});if(profile&&(!profile.enabled||profile.deletedAt))fail('UNAUTHENTICATED','用户不可用',401);if(profile?.passwordHash&&!await passwordMatches(q.oldPassword,profile.passwordHash))fail('PASSWORD_INVALID','原密码不正确',400);const secret=await passwordHash(q.password);
  await this.applications.transaction(async db=>{await this.applications.available(s.tenantId,s.applicationKey,db,true);if(!await db.session.findFirst({where:{token:s.token,...identity,role:'user',expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','用户会话已失效',401);const current=await db.consumerProfile.findUnique({where});if(current&&(!current.enabled||current.deletedAt)||!!current!==!!profile||current?.passwordHash!==profile?.passwordHash)fail('PROFILE_CONFLICT','账号状态已变化，请重新登录',409);if(current)await db.consumerProfile.update({where,data:{passwordHash:secret,version:{increment:1}}});else await db.consumerProfile.create({data:{...identity,nickname:'',passwordHash:secret}});await db.session.deleteMany({where:identity});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:s.tenantId,applicationKey:s.applicationKey,actor:'consumer:'+hash(s.userId).slice(0,48),action:'consumer.password.change',details:{userId:s.userId}}})});return{updated:true};
 }
 async login(body,ip){
  const parsed=input.safeParse(body);if(!parsed.success)fail('CONSUMER_LOGIN_INVALID','请输入有效账号和密码',401);const q=parsed.data;
  const count=async(key,seconds)=>Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",1,key,seconds));
  const ipKey='consumer-login-ip:'+hash(ip),key='consumer-login:'+hash(ip+'|'+q.tenantId+'|'+q.applicationKey+'|'+q.account.toLowerCase());
  if(await count(ipKey,60)>60||await count(key,900)>10)fail('CONSUMER_LOGIN_LIMIT','尝试过于频繁，请稍后再试',429);
  await this.applications.available(q.tenantId,q.applicationKey);
  if(!(await readConsumerSettings(this.db,q.tenantId,q.applicationKey)).config.registration.passwordLoginEnabled)fail('PASSWORD_LOGIN_DISABLED','本站已关闭账号密码登录',403);
  const requested=q.account,directWhere={tenantId_applicationKey_userId:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId:requested}};
  let phoneWhere=null,bound=null;
  if(q.loginType!=='account'&&/^1[3-9]\d{9}$/.test(requested)&&this.phoneDigest&&await this.db.consumerExternalIdentity.findFirst({where:{tenantId:q.tenantId,applicationKey:q.applicationKey,provider:'sms',appId:'phone'},select:{userId:true}})){const subjectHash=this.phoneDigest(q.tenantId,q.applicationKey,requested);if(subjectHash){phoneWhere={tenantId_applicationKey_provider_appId_subjectHash:{tenantId:q.tenantId,applicationKey:q.applicationKey,provider:'sms',appId:'phone',subjectHash}};bound=await this.db.consumerExternalIdentity.findUnique({where:phoneWhere})}}
  const direct=q.loginType==='phone'?null:await this.db.consumerProfile.findUnique({where:directWhere}),byPhone=bound?(bound.userId===requested&&direct?direct:await this.db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId:bound.userId}}})):null;
  const candidates=q.loginType==='account'?[direct]:q.loginType==='phone'?[byPhone]:phoneWhere?[direct,byPhone]:[direct],matches=[];
  for(const candidate of candidates){const valid=await passwordMatches(q.password,candidate?.passwordHash||await this.dummy);if(valid&&candidate?.passwordHash&&candidate.enabled&&!candidate.deletedAt&&!matches.some(row=>row.userId===candidate.userId))matches.push(candidate)}
  if(matches.length!==1)fail(matches.length>1?'CONSUMER_LOGIN_AMBIGUOUS':'CONSUMER_LOGIN_INVALID',matches.length>1?'手机号与账号存在冲突，请使用验证码登录或联系管理员':'手机号、账号或密码不正确，或用户不可用',401);
  const profile=matches[0];q.account=profile.userId;if(q.loginType!=='phone'&&profile.userId===requested)phoneWhere=null;
  const where={tenantId_applicationKey_userId:{tenantId:q.tenantId,applicationKey:q.applicationKey,userId:q.account}};
  const result=await this.applications.transaction(async db=>{
   await this.applications.available(q.tenantId,q.applicationKey,db,true);if(phoneWhere&&(await db.consumerExternalIdentity.findUnique({where:phoneWhere}))?.userId!==q.account)fail('CONSUMER_LOGIN_INVALID','手机号绑定已变化，请重新登录',401);const current=await db.consumerProfile.findUnique({where});
   if(!(await readConsumerSettings(db,q.tenantId,q.applicationKey)).config.registration.passwordLoginEnabled)fail('PASSWORD_LOGIN_DISABLED','本站已关闭账号密码登录',403);
   if(!current?.enabled||current.deletedAt||current.passwordHash!==profile.passwordHash)fail('CONSUMER_LOGIN_INVALID','账号状态已变更，请重新登录',401);
   const policies=await assertConsumerConsent(db,q.tenantId,q.applicationKey,q.consent);if(policies.length)await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:q.tenantId,applicationKey:q.applicationKey,actor:'consumer:'+hash(q.account).slice(0,48),action:'consumer.policy.consent',details:{policies}}});
   const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*3600000);
   await db.session.create({data:{token:hash(token),tenantId:q.tenantId,applicationKey:q.applicationKey,userId:current.userId,role:'user',expiresAt}});
   return{token,tenantId:q.tenantId,applicationKey:q.applicationKey,userId:current.userId,role:'user',expiresAt};
  });await this.redis.del(key);return result;
 }
}
