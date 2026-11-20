import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,randomInt,createHmac,createHash} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {smsProviders,smsLabels,smsPurposes,smsContentDefaults,smsContent,templateFields,smsDefaults,smsConfig,smsConfigured,validateSmsCredentials,SmsTransport,SmsProviderError} from '../channels/sms.mjs';
import {fail} from './errors.mjs';

const key=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),version=z.number().int().nonnegative();
const parse=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)fail('SMS_INPUT_INVALID',formValidationMessage(p.error));return p.data};
const saveInput=z.object({version,config:z.unknown(),accessKeyId:z.string().trim().max(200).default(''),secret:z.string().trim().max(512).default(''),clearSecrets:z.boolean().default(false),makeDefault:z.boolean().default(false)}).strict();
const sendInput=z.object({version,requestId:z.uuid(),phone:z.string().regex(/^1[3-9]\d{9}$/,'须为有效的 11 位手机号'),purpose:z.enum(['login','register','reset'])}).strict();
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey}),aad=row=>'tenant-sms:'+row.tenantId+':'+row.applicationKey;
const initial=()=>({defaultProvider:null,channels:Object.fromEntries(smsProviders.map(provider=>[provider,structuredClone(smsDefaults)]))});
const safeCode=e=>/^[A-Za-z0-9_.-]{1,64}$/.test(e?.code||'')?e.code:'SMS_RESULT_UNKNOWN';
const messages={SENDING:'测试短信正在提交，请查询发送记录',ACCEPTED:'服务商已受理测试短信，请查看接收手机；测试验证码不能用于登录',FAILED:'测试短信发送失败，请核对配置和发送记录',UNKNOWN:'结果未确认，请先在服务商后台核对，避免重复发送'};

export class TenantSms {
 constructor(db,redis,secrets,{transport=new SmsTransport(),testEnabled=process.env.SMS_TEST_SEND_ENABLED==='true'}={}){this.db=db;this.redis=redis;this.secrets=secrets;this.apps=new TenantApplications(db);this.transport=transport;this.testEnabled=testEnabled;this.busy=false}
 provider(value){if(!smsProviders.includes(value))fail('SMS_PROVIDER_INVALID','不支持的短信服务商');return value}
 async context(db,s,tenantId,applicationKey,write=false){
  parse(key,tenantId);if(applicationKey)parse(key,applicationKey);
  // Acquire the write lock before serializable reads, avoiding shared-to-exclusive lock upgrades.
  if(write){if(!applicationKey)fail('FORBIDDEN','没有短信配置权限',403);await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true)}
  const ctx=await this.apps.featureContext(db,s,tenantId,applicationKey,'sms','settings.read');return ctx;
 }
 decrypt(row){if(!row?.secretsCipher)return{};try{return this.secrets.decrypt(aad(row),row.secretsCipher)}catch{fail('SMS_KEYS_UNAVAILABLE','短信密钥无法解密，请检查服务端加密密钥',503)}}
 notifications(config){const provider=config.defaultProvider||null;return Object.entries(smsPurposes).map(([purpose,label])=>({purpose,label,typeLabel:'验证码',business:label+'验证码',provider,providerLabel:provider?smsLabels[provider]:'未设置默认短信渠道',templateId:provider?config.channels[provider][templateFields[purpose]]||'':'',content:config.notificationContents?.[purpose]?.[provider]??smsContentDefaults[purpose],enabled:!!provider&&!!config.channels[provider][templateFields[purpose]],templates:Object.fromEntries(smsProviders.map(p=>[p,config.channels[p][templateFields[purpose]]||'']))}))}
 expose(row){const config=row?.config||initial(),credentials=this.decrypt(row);return{version:row?.version||0,defaultProvider:config.defaultProvider,updatedAt:row?.updatedAt||null,channels:smsProviders.map(provider=>({provider,label:smsLabels[provider],config:{...config.channels[provider],enabled:smsConfigured(provider,config.channels[provider],credentials[provider]||{})},hasCredentials:!!credentials[provider]?.accessKeyId&&!!credentials[provider]?.secret,maskedAccessKeyId:credentials[provider]?.accessKeyId?'••••'+credentials[provider].accessKeyId.slice(-4):'',isDefault:config.defaultProvider===provider}))}}
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:key.optional()}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),row=ctx.selected?await this.db.tenantSmsSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,ctx.selected.key)}}):null;
  const current=await this.context(this.db,s,tenantId,ctx.selected?.key||q.applicationKey);return{applicationKey:ctx.selected?.key||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write'),...this.expose(row),notifications:this.notifications(row?.config||initial()),testEnabled:this.testEnabled};
 }
 async saveNotification(s,tenantId,applicationKey,purpose,input){
  if(!Object.hasOwn(templateFields,purpose))fail('SMS_INPUT_INVALID','不支持的短信通知场景');
  const q=parse(z.union([z.object({version,enabled:z.boolean(),provider:z.enum(['aliyun','tencent']),templateId:z.string().trim().max(100),content:z.string().max(1000)}).strict(),z.object({version,enabled:z.boolean(),templates:z.object({aliyun:z.string().trim().max(100),tencent:z.string().trim().max(100)}).strict()}).strict()]),input);
  const single=Object.hasOwn(q,'templateId');if(single)q.content=smsContent(q.content);
  q.enabled=single?!!q.templateId:!!Object.values(q.templates).some(Boolean);
  await this.apps.transaction(async db=>{await this.context(db,s,tenantId,applicationKey,true);const where={tenantId_applicationKey:scope(tenantId,applicationKey)},old=await db.tenantSmsSetting.findUnique({where});if((old?.version||0)!==q.version)fail('SMS_CONFIG_CONFLICT','通知设置已更新，请重新读取',409);
   const config=structuredClone(old?.config||initial());if(single&&config.defaultProvider!==q.provider)fail('SMS_DEFAULT_CHANNEL_CHANGED','默认短信渠道未设置或已变化，请重新读取后编辑',409);
   for(const provider of single?[q.provider]:smsProviders)config.channels[provider]=smsConfig(provider,{...config.channels[provider],[templateFields[purpose]]:single?q.templateId:q.templates[provider]});config.notifications={...config.notifications,[purpose]:q.enabled};
   if(single)config.notificationContents={...config.notificationContents,[purpose]:{...config.notificationContents?.[purpose],[q.provider]:q.content}};
   await db.tenantSmsSetting.upsert({where,create:{tenantId,applicationKey,config,version:1},update:{config,version:q.version+1}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'sms.notification.save',details:{purpose,enabled:q.enabled,version:q.version+1}}});
  });return this.view(s,tenantId,{applicationKey});
 }
 async save(s,tenantId,applicationKey,provider,input){
  this.provider(provider);const q=parse(saveInput,input),config=smsConfig(provider,q.config);
  if(q.clearSecrets&&(q.accessKeyId||q.secret))fail('SMS_INPUT_INVALID','不能同时填写和清除密钥');
  await this.context(this.db,s,tenantId,applicationKey);
  await this.apps.transaction(async db=>{
   await this.context(db,s,tenantId,applicationKey,true);const where={tenantId_applicationKey:scope(tenantId,applicationKey)},old=await db.tenantSmsSetting.findUnique({where});if((old?.version||0)!==q.version)fail('SMS_CONFIG_CONFLICT','短信配置已更新，请重新读取后编辑',409);
   const all=this.decrypt(old),previous=all[provider]||{};
   if(q.accessKeyId&&previous.accessKeyId&&q.accessKeyId!==previous.accessKeyId&&!q.secret)fail('SMS_KEYS_REPLACE_REQUIRED','更换访问 Key ID 时须同时填写对应 Secret',409);
   const credentials=q.clearSecrets?{}:{accessKeyId:q.accessKeyId||previous.accessKeyId||'',secret:q.secret||previous.secret||''};validateSmsCredentials(provider,config,credentials,false);config.enabled=smsConfigured(provider,config,credentials);if(q.makeDefault&&!config.enabled)fail('SMS_CONFIG_INCOMPLETE','请先填写完整的默认短信渠道配置');
   if(q.clearSecrets)delete all[provider];else if(credentials.accessKeyId||credentials.secret)all[provider]=credentials;
   const saved=structuredClone(old?.config||initial());saved.channels[provider]=config;if(q.makeDefault)saved.defaultProvider=provider;else if(saved.defaultProvider===provider&&!config.enabled)saved.defaultProvider=null;
   let secretsCipher=null;if(Object.keys(all).length){await this.secrets.assertExistingKey(db);secretsCipher=this.secrets.encrypt(aad({tenantId,applicationKey}),all)}
   await db.tenantSmsSetting.upsert({where,create:{tenantId,applicationKey,config:saved,secretsCipher,version:1},update:{config:saved,secretsCipher,version:q.version+1}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'sms.config.save',details:{provider,version:q.version+1,enabled:config.enabled,defaultProvider:saved.defaultProvider,keysChanged:!!(q.accessKeyId||q.secret),keysCleared:q.clearSecrets,...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,{applicationKey});
 }
 async check(s,tenantId,applicationKey,provider,input){
  this.provider(provider);const q=parse(z.object({version}).strict(),input);
  return this.apps.transaction(async db=>{await this.context(db,s,tenantId,applicationKey,true);const row=await db.tenantSmsSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(!row||row.version!==q.version)fail('SMS_CONFIG_CONFLICT','请先保存当前配置，再进行自检',409);const config=smsConfig(provider,row.config.channels[provider]),credentials=this.decrypt(row)[provider]||{};validateSmsCredentials(provider,config,credentials,true);const purposes=Object.keys(templateFields).filter(p=>config[templateFields[p]]);if(!purposes.length)this.transport.request(provider,{...config,loginTemplate:provider==='aliyun'?'SMS_LOCALCHECK':'1'},credentials,'13800000000','login','000000');for(const purpose of purposes)this.transport.request(provider,config,credentials,'13800000000',purpose,'000000');await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'sms.config.check',details:{provider,version:row.version,purposes}}});return{checkedAt:new Date(),version:row.version,message:'字段与请求签名自检通过，未发送短信；账号权限和模板审核状态需在联调时确认。'}});
 }
 digest(tenantId,applicationKey,value){try{return createHmac('sha256',this.secrets.key(false)).update(JSON.stringify([tenantId,applicationKey,value])).digest('hex')}catch{fail('SMS_KEYS_UNAVAILABLE','短信密钥不可用',503)}}
 async limit(tenantId,applicationKey,phoneHash,ip,config){
  const prefix='sms:'+tenantId+':'+applicationKey+':',ipHash=this.digest(tenantId,applicationKey,ip),now=Date.now(),day=Math.floor((now+28800000)/86400000),ttl=Math.max(1,Math.ceil(((day+1)*86400000-28800000-now)/1000));
  let result;try{result=Number(await this.redis.eval("for i=1,#KEYS do if tonumber(redis.call('GET',KEYS[i]) or '0')>=tonumber(ARGV[(i-1)*2+1]) then return i end end; for i=1,#KEYS do local n=redis.call('INCR',KEYS[i]); if n==1 then redis.call('EXPIRE',KEYS[i],ARGV[(i-1)*2+2]) end end; return 0",3,prefix+'interval:'+phoneHash,prefix+'day:'+day+':'+phoneHash,prefix+'ip:'+ipHash,1,config.intervalSeconds,config.phoneDailyLimit,ttl,config.ipHourlyLimit,3600))}catch{fail('SMS_LIMITER_UNAVAILABLE','短信限流服务不可用，未发起发送',503)}
  if(!Number.isInteger(result))fail('SMS_LIMITER_UNAVAILABLE','短信限流结果无效，未发起发送',503);if(result!==0)fail('SMS_RATE_LIMITED','发送过于频繁或已达到发送上限，请稍后重试',429);
 }
 record(row){return{id:row.id,requestId:row.requestId,provider:row.provider,purpose:row.purpose,purposeLabel:row.actorId==='consumer-auth:bind'?'手机号绑定':smsPurposes[row.purpose],phoneMasked:row.phoneMasked,status:row.status,errorCode:row.errorCode,receipt:row.receipt,createdAt:row.createdAt,updatedAt:row.updatedAt,message:row.actorId?.startsWith('consumer-auth:')?{SENDING:'验证码正在提交，请稍后查询',ACCEPTED:'服务商已受理验证码短信',FAILED:'验证码发送失败，请核对配置和记录',UNKNOWN:'发送结果未确认，请先核对服务商记录'}[row.status]:messages[row.status]}}
 async sendTest(s,tenantId,applicationKey,provider,input,ip){
  this.provider(provider);const q=parse(sendInput,input);await this.context(this.db,s,tenantId,applicationKey,true);if(!this.testEnabled)fail('SMS_TEST_BLOCKED','当前环境尚未开放真实短信发送，可先保存配置并进行自检',503);
  const phoneHash=this.digest(tenantId,applicationKey,q.phone),payloadHash=createHash('sha256').update(JSON.stringify([provider,q.purpose,phoneHash,q.version])).digest('hex');
  const prepared=await this.apps.transaction(async db=>{
   await this.context(db,s,tenantId,applicationKey,true);const old=await db.tenantSmsDelivery.findUnique({where:{tenantId_applicationKey_requestId:{tenantId,applicationKey,requestId:q.requestId}}});if(old){if(old.payloadHash!==payloadHash)fail('SMS_REQUEST_CONFLICT','该发送请求已用于其他内容，请查询原记录',409);return{existing:old}}
   const row=await db.tenantSmsSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(!row||row.version!==q.version)fail('SMS_CONFIG_CONFLICT','短信配置已变化，请重新读取',409);const config=smsConfig(provider,row.config.channels[provider]),credentials=this.decrypt(row)[provider]||{};validateSmsCredentials(provider,config,credentials,true);if(!this.notifications(row.config).find(n=>n.purpose===q.purpose)?.enabled)fail('SMS_NOTIFICATION_DISABLED','该短信通知场景已关闭');if(!config[templateFields[q.purpose]])fail('SMS_TEMPLATE_REQUIRED','请先配置所选用途的模板');
   const log=await db.tenantSmsDelivery.create({data:{id:randomUUID(),tenantId,applicationKey,requestId:q.requestId,actorId:s.impersonatedBy||s.id,provider,purpose:q.purpose,phoneHash,phoneMasked:q.phone.slice(0,3)+'****'+q.phone.slice(-4),payloadHash,settingsVersion:row.version,status:'SENDING'}});return{log,config,credentials};
  });if(prepared.existing)return this.record(prepared.existing);
  const {log,config,credentials}=prepared;let dispatched=false;
  try{
   await this.limit(tenantId,applicationKey,phoneHash,ip,config);
   // Recheck current grants and configuration immediately before the external call.
   await this.apps.transaction(async db=>{await this.context(db,s,tenantId,applicationKey,true);const row=await db.tenantSmsSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(row?.version!==q.version)fail('SMS_CONFIG_CONFLICT','配置已变化，本次测试未发送',409)});
   dispatched=true;const receipt=await this.transport.send(provider,config,credentials,q.phone,q.purpose,String(randomInt(100000,1000000)));
   const saved=await this.apps.transaction(async db=>{const result=await db.tenantSmsDelivery.update({where:{id:log.id},data:{status:'ACCEPTED',receipt,errorCode:null}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:log.actorId,action:'sms.test.accepted',details:{logId:log.id,provider,purpose:q.purpose}}});return result});return this.record(saved);
  }catch(e){const known=!dispatched||e instanceof SmsProviderError;await this.db.tenantSmsDelivery.updateMany({where:{id:log.id,status:'SENDING'},data:{status:known?'FAILED':'UNKNOWN',errorCode:e instanceof SmsProviderError?e.providerCode:safeCode(e)}});if(!dispatched)throw e;fail(e instanceof SmsProviderError?'SMS_SEND_REJECTED':'SMS_RESULT_UNKNOWN',e instanceof SmsProviderError?'短信服务商拒绝请求，请查看发送记录中的错误码':'发送结果未确认，请核对服务商记录；不要直接重复发送',503)}
 }
 async logs(s,tenantId,applicationKey,input={}){
  const q=parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n),'须为 10、20 或 50').default(20)}).strict(),input);await this.context(this.db,s,tenantId,applicationKey);
  const where=scope(tenantId,applicationKey),total=await this.db.tenantSmsDelivery.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize))),items=await this.db.tenantSmsDelivery.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*q.pageSize,take:q.pageSize});await this.context(this.db,s,tenantId,applicationKey);return{items:items.map(r=>this.record(r)),total,page,pageSize:q.pageSize};
 }
 async recover(){if(this.busy)return;this.busy=true;try{await this.db.tenantSmsDelivery.updateMany({where:{status:'SENDING',createdAt:{lt:new Date(Date.now()-120000)}},data:{status:'UNKNOWN',errorCode:'SMS_INTERRUPTED'}})}finally{this.busy=false}}
}
