import {formValidationMessage} from './form-validation.mjs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {paymentProviders,paymentLabels,paymentDefaults,paymentConfig,secretFields,validatePaymentKeys,paymentConfigured} from '../payments/config.mjs';
import {fail} from './errors.mjs';
import {miniSubjectType} from '../payments/product-policy.mjs';
import {miniProgramDomains} from '../channels/mini-domains.mjs';

const key=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),version=z.number().int().nonnegative();
const input=z.object({version,config:z.unknown(),secrets:z.object({appKey:z.string().max(256).optional(),sandboxAppKey:z.string().max(256).optional(),callbackToken:z.string().max(32).optional(),encodingAESKey:z.string().max(43).optional(),apiV2Key:z.string().max(64).optional(),apiV3Key:z.string().max(64).optional(),privateKey:z.string().max(12000).optional(),publicKey:z.string().max(12000).optional(),merchantCertificate:z.string().max(12000).optional()}).strict().default({}),clearSecrets:z.boolean().default(false)}).strict();
const scope=(tenantId,applicationKey,provider)=>({tenantId,applicationKey,provider});
const aad=row=>['tenant-payment',row.tenantId,row.applicationKey,row.provider,row.id].join(':');
const parse=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)fail('PAYMENT_INPUT_INVALID',formValidationMessage(p.error));return p.data};
export class TenantPayments {
 constructor(db,secrets){this.db=db;this.secrets=secrets;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,applicationKey){parse(key,tenantId);if(applicationKey)parse(key,applicationKey);return this.apps.featureContext(db,s,tenantId,applicationKey,'payments','settings.read')}
 async writeContext(db,s,tenantId,applicationKey){const ctx=await this.context(db,s,tenantId,applicationKey);if(!ctx.selected||!ctx.permissions.includes('settings.write'))fail('FORBIDDEN','没有支付配置管理权限',403);await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true);return ctx}
 provider(value){if(!paymentProviders.includes(value))fail('PAYMENT_PROVIDER_INVALID','不支持的支付渠道');return value}
 expose(provider,row){const config=row?paymentConfig(provider,row.config):structuredClone(paymentDefaults[provider]);config.enabled=paymentConfigured(provider,config,row?.secretFields||[]);return{provider,label:paymentLabels[provider],execution:{implemented:true,clients:provider==='alipay'?['h5']:provider==='wechat'?['mini','h5','official']:['mini'],enabled:process.env.PAYMENT_EXECUTION_ENABLED==='true',liveVerified:false},version:row?.version||0,config,hasSecrets:Object.fromEntries(secretFields({...config,provider}).map(name=>[name,!!row?.secretFields?.includes(name)])),updatedAt:row?.createdAt||null}}
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:key.optional()}).strict(),input);await this.context(this.db,s,tenantId,q.applicationKey);
  const result=await this.db.$transaction(async db=>{const ctx=await this.context(db,s,tenantId,q.applicationKey),rows=ctx.selected?await Promise.all(paymentProviders.map(provider=>db.tenantPaymentRevision.findFirst({where:{tenantId,applicationKey:ctx.selected.key,provider},orderBy:{version:'desc'}}))):[];return{applicationKey:ctx.selected?.key||null,applications:ctx.sources,canWrite:ctx.permissions.includes('settings.write'),channels:ctx.selected?paymentProviders.map(provider=>this.expose(provider,rows.find(row=>row?.provider===provider))):[],integrationReady:false}},{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,result.applicationKey||q.applicationKey);result.canWrite=current.permissions.includes('settings.write');result.canReadVirtualOrders=current.permissions.includes('orders.read');const mini=result.applicationKey?await this.db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:result.applicationKey}},select:{config:true}}):null;result.miniProgramAppId=mini?.config.appId||'';result.miniProgramSubjectType=result.applicationKey?await miniSubjectType(this.db,{tenantId,applicationKey:result.applicationKey}):'unknown';const virtual=result.channels.find(row=>row.provider==='wechat-virtual');if(virtual&&(!result.miniProgramAppId||virtual.config.appId!==result.miniProgramAppId||result.miniProgramSubjectType==='unknown'||virtual.config.subjectType!==result.miniProgramSubjectType))virtual.config.enabled=false;const domain=miniProgramDomains(process.env.PUBLIC_API_ORIGIN);result.virtualCallbackUrl=domain.available&&result.applicationKey?domain.request+'/api/v1/payments/wechat-virtual/'+encodeURIComponent(tenantId)+'/'+encodeURIComponent(result.applicationKey)+'/notify':null;return result;
 }
 decrypt(row){if(!row?.secretsCipher)return{};try{return this.secrets.decrypt(aad(row),row.secretsCipher)}catch{fail('PAYMENT_KEYS_UNAVAILABLE','支付密钥无法解密，请检查服务器加密密钥',503)}}
 async save(s,tenantId,applicationKey,provider,value){
  this.provider(provider);const q=parse(input,value),config=paymentConfig(provider,q.config),incoming=Object.fromEntries(Object.entries(q.secrets).map(([name,value])=>[name,value.trim()]).filter(([,value])=>value));
  if(q.clearSecrets&&Object.keys(incoming).length)fail('PAYMENT_INPUT_INVALID','不能同时填写和清除密钥');
  const fields=secretFields({...config,provider});if(Object.keys(incoming).some(name=>!fields.includes(name)))fail('PAYMENT_INPUT_INVALID','密钥字段与当前渠道或协议不匹配');
  await this.context(this.db,s,tenantId,applicationKey);
  await this.apps.transaction(async db=>{
   await this.writeContext(db,s,tenantId,applicationKey);const where=scope(tenantId,applicationKey,provider),old=await db.tenantPaymentRevision.findFirst({where,orderBy:{version:'desc'}});
   if((old?.version||0)!==q.version)fail('PAYMENT_CONFIG_CONFLICT','支付配置已更新，请重新读取后编辑',409);

   if(provider==='wechat-virtual'){
    const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});
    const appId=mini?.config.appId||'';
    if(config.appId&&config.appId!==appId)fail('MINI_PAYMENT_APPID_MISMATCH','小程序配置已变化，请重新读取支付设置',409);
    config.appId=appId;const subject=await miniSubjectType(db,{tenantId,applicationKey});if(subject!=='unknown'&&config.subjectType!==subject)fail('MINI_SUBJECT_CHANGED','小程序主体类型已变化，请重新读取支付设置',409);config.subjectType=subject;if(subject==='personal')config.env=0;
   }
   // Completing an empty identity is not a replacement. Old revisions remain available to historical orders.
   const identityFields=provider==='wechat'?['mchId','apiVersion']:provider==='wechat-virtual'?['appId','offerId']:['appId','sellerId'];
   const changedIdentity=old&&identityFields.some(name=>old.config[name]&&old.config[name]!==config[name]);
   const previous=q.clearSecrets||changedIdentity?{}:this.decrypt(old);
   if(provider==='wechat'&&old?.config.publicKeyId&&old.config.publicKeyId!==config.publicKeyId)delete previous.publicKey;
   const credentials=validatePaymentKeys(provider,config,{...previous,...incoming},false),secretNames=Object.keys(credentials);config.enabled=paymentConfigured(provider,config,secretNames);
   if(provider!=='alipay'&&config.enabled){const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});if(mini?.config.appId&&mini.keyCipher&&mini.config.appId!==config.appId)fail('MINI_PAYMENT_APPID_MISMATCH','支付 AppID 与已配置的小程序 AppID 不一致',409)}
   const row={id:randomUUID(),...where,version:q.version+1,config,secretFields:secretNames,secretsCipher:null};
   if(secretNames.length){try{await this.secrets.assertExistingKey(db);row.secretsCipher=this.secrets.encrypt(aad(row),credentials)}catch{fail('PAYMENT_KEYS_UNAVAILABLE','支付密钥加密失败，请检查服务器加密密钥',503)}}
   await db.tenantPaymentRevision.create({data:row});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'payment.config.save',details:{provider,version:row.version,enabled:config.enabled,keysChanged:Object.keys(incoming),keysCleared:q.clearSecrets,...(s.delegated?{targetAdminId:s.id}:{})}}});
  });
  return this.view(s,tenantId,{applicationKey});
 }
 async check(s,tenantId,applicationKey,provider,value){
  this.provider(provider);const q=parse(z.object({version}).strict(),value);
  return this.apps.transaction(async db=>{await this.writeContext(db,s,tenantId,applicationKey);const row=await db.tenantPaymentRevision.findFirst({where:scope(tenantId,applicationKey,provider),orderBy:{version:'desc'}});if(!row||row.version!==q.version)fail('PAYMENT_CONFIG_CONFLICT','请先保存当前配置，再进行自检',409);if(provider==='wechat-virtual'){const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});if(!mini?.config.appId||mini.config.appId!==row.config.appId)fail('MINI_PAYMENT_APPID_MISMATCH','请先保存当前小程序对应的支付配置',409);const subject=await miniSubjectType(db,{tenantId,applicationKey});if(subject==='unknown')fail('MINI_SUBJECT_REQUIRED','请先在微信小程序渠道配置中选择主体类型',409);if((row.config.subjectType||'business')!==subject)fail('MINI_SUBJECT_CHANGED','小程序主体类型已变化，请重新保存支付设置',409)}validatePaymentKeys(provider,paymentConfig(provider,row.config),this.decrypt(row),true);await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'payment.config.check',details:{provider,version:row.version,...(s.delegated?{targetAdminId:s.id}:{})}}});return{version:row.version,checkedAt:new Date(),message:'配置格式与密钥结构检查通过。此检查不会发起付款，也不会验证商户归属或交易结果。'}});
 }
}
