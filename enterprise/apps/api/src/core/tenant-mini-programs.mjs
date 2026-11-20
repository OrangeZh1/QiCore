import {formValidationMessage} from './form-validation.mjs';
import {paymentConfigured} from '../payments/config.mjs';
import {randomUUID,createPrivateKey} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {fail} from './errors.mjs';
import {miniProgramDomains} from '../channels/mini-domains.mjs';
import {miniSubjectType} from '../payments/product-policy.mjs';
import {WechatMiniIdentity} from '../channels/wechat-mini.mjs';
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线');
export const miniProgramConfigured=row=>!!row?.config.appId&&!!row?.keyCipher;
export const miniProgramDefaults={enabled:false,displayName:'',originalId:'',appId:'',subjectType:'unknown',versionDescription:'',qrMaterialId:null};
export const miniProgramConfig=z.object({enabled:z.boolean(),displayName:z.string().trim().max(32),originalId:z.string().trim().max(64).refine(v=>!v||/^gh_[a-zA-Z0-9]+$/.test(v),'须以 gh_ 开头，后接英文字母或数字，可留空'),appId:z.string().trim().max(18).refine(v=>!v||/^wx[a-fA-F0-9]{16}$/.test(v),'须以 wx 开头，后接 16 位十六进制字符，可留空'),subjectType:z.enum(['unknown','personal','business']).optional(),versionDescription:z.string().trim().max(200).default(''),qrMaterialId:z.uuid().nullable().default(null)}).strict();
const parse=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)fail('MINI_INPUT_INVALID',formValidationMessage(p.error,{displayName:'小程序名称'}));return p.data};
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey}),aad=row=>'tenant-mini:'+row.tenantId+':'+row.applicationKey;
export class TenantMiniPrograms {
 constructor(db,secrets,{origin=()=>process.env.PUBLIC_API_ORIGIN}={}){this.db=db;this.secrets=secrets;this.apps=new TenantApplications(db);this.origin=origin}
 context(db,s,tenantId,key){parse(identifier,tenantId);if(key)parse(identifier,key);return this.apps.featureContext(db,s,tenantId,key,'wechatMini','settings.read')}
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:identifier.optional()}).strict(),input);await this.context(this.db,s,tenantId,q.applicationKey);
  const value=await this.db.$transaction(async db=>{const ctx=await this.context(db,s,tenantId,q.applicationKey),row=ctx.selected?await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,ctx.selected.key)}}):null,payment=ctx.selected?await db.tenantPaymentRevision.findFirst({where:{tenantId,applicationKey:ctx.selected.key,provider:'wechat'},orderBy:{version:'desc'}}):null;return{uploadSupported:!!ctx.selected&&!!application(ctx.selected.key).miniProgramPackageKey,applicationKey:ctx.selected?.key||null,applications:ctx.sources,version:row?.version||0,config:{...miniProgramDefaults,...row?.config,subjectType:ctx.selected?await miniSubjectType(db,scope(tenantId,ctx.selected.key)):'unknown',enabled:miniProgramConfigured(row)},hasAppSecret:!!row?.keyCipher,hasUploadPrivateKey:!!row?.uploadKeyCipher,domains:miniProgramDomains(this.origin()),paymentAppId:payment?.config.appId||'',paymentEnabled:!!payment&&paymentConfigured(payment.provider,payment.config,payment.secretFields),canWrite:ctx.permissions.includes('settings.write')}},{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,value.applicationKey||q.applicationKey);value.canWrite=current.permissions.includes('settings.write');return value;
 }
 decrypt(row){if(!row?.keyCipher)return'';try{return this.secrets.decrypt(aad(row),row.keyCipher).appSecret}catch{fail('MINI_KEY_UNAVAILABLE','小程序密钥无法解密，请检查服务端加密密钥',503)}}
 uploadKey(row){if(!row?.uploadKeyCipher)fail('MINI_UPLOAD_KEY_REQUIRED','请先保存小程序上传密钥',409);try{return this.secrets.decrypt('tenant-mini-upload:'+row.tenantId+':'+row.applicationKey+':'+row.config.appId,row.uploadKeyCipher).privateKey}catch{fail('MINI_KEY_UNAVAILABLE','上传密钥无法解密，请检查服务器加密密钥',503)}}
 async check(s,tenantId,applicationKey,input,client=new WechatMiniIdentity()){
  const q=parse(z.object({version:z.number().int().positive()}).strict(),input);await this.apps.admin(s,tenantId,applicationKey,'settings.write');const row=await this.db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(row?.version!==q.version)fail('MINI_CONFIG_CONFLICT','配置已更新，请重新读取',409);if(!row.config.appId||!row.keyCipher)fail('MINI_CONFIG_INCOMPLETE','请先保存 AppID 和 AppSecret');await client.check({appId:row.config.appId,appSecret:this.decrypt(row)});
  await this.apps.transaction(async db=>{await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true);if((await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}}))?.version!==q.version)fail('MINI_CONFIG_CONFLICT','验证期间配置已变化，请重新验证',409);await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'mini.config.check',details:{version:q.version}}})});return{version:q.version,checkedAt:new Date().toISOString(),message:'微信已确认凭据有效；登录、域名与上传需分别验证。'};
 }
 async available(tenantId,key,db=this.db){if(!application(key).wechatMini)fail('MINI_NOT_SUPPORTED','该应用未开放微信小程序登录',403);return this.apps.available(tenantId,key,db)}
 async credentials(tenantId,applicationKey,db=this.db){await this.available(tenantId,applicationKey,db);const row=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(!miniProgramConfigured(row))fail('MINI_NOT_CONFIGURED','该站点尚未配置或启用微信登录',409);return{appId:row.config.appId,appSecret:this.decrypt(row),version:row.version}}
 async publicView(input){const q=parse(z.object({tenantId:identifier,applicationKey:identifier}).strict(),input);await this.available(q.tenantId,q.applicationKey);const row=await this.db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:q}}),enabled=miniProgramConfigured(row);return{enabled,appId:enabled?row.config.appId:null}}
 async save(s,tenantId,applicationKey,input){
  const q=parse(z.object({version:z.number().int().nonnegative(),config:miniProgramConfig,appSecret:z.string().trim().max(32).default('').refine(v=>!v||/^[A-Fa-f0-9]{32}$/.test(v),'须为 32 位十六进制字符，可留空保留原密钥'),clearSecret:z.boolean().default(false),uploadPrivateKey:z.string().trim().max(12000).default(''),clearUploadPrivateKey:z.boolean().default(false)}).strict(),input);if(q.clearSecret&&q.appSecret)fail('MINI_INPUT_INVALID','不能同时填写和清除 AppSecret');
  if(q.clearUploadPrivateKey&&q.uploadPrivateKey)fail('MINI_INPUT_INVALID','不能同时填写和清除上传密钥');if(q.uploadPrivateKey){try{const parsed=createPrivateKey(q.uploadPrivateKey);if(parsed.asymmetricKeyType!=='rsa'||parsed.asymmetricKeyDetails.modulusLength<2048||!q.config.appId)throw Error()}catch{fail('MINI_UPLOAD_KEY_INVALID','请填写 AppID 和有效的 RSA 上传密钥')}}
  await this.context(this.db,s,tenantId,applicationKey);
  await this.apps.transaction(async db=>{
   const ctx=await this.context(db,s,tenantId,applicationKey);if(!ctx.permissions.includes('settings.write'))fail('FORBIDDEN','没有小程序配置管理权限',403);await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true);
   const where={tenantId_applicationKey:scope(tenantId,applicationKey)},old=await db.tenantMiniProgramSetting.findUnique({where});if((old?.version||0)!==q.version)fail('MINI_CONFIG_CONFLICT','配置已更新，请重新读取后编辑',409);
   const changedApp=!!old&&old.config.appId!==q.config.appId;if(q.config.subjectType===undefined)q.config.subjectType=changedApp?'unknown':await miniSubjectType(db,scope(tenantId,applicationKey));if(changedApp&&old.keyCipher&&!q.appSecret&&!q.clearSecret)fail('MINI_KEY_REPLACE_REQUIRED','更换 AppID 后须重新填写或明确清除 AppSecret',409);
   q.config.enabled=!!q.config.appId&&!!(q.appSecret||!q.clearSecret&&old?.keyCipher);
   // Virtual pay follows this AppID on its next save; execution rejects stale revisions in the meantime.
   for(const provider of q.config.subjectType==='personal'?[]:['wechat']){const payment=await db.tenantPaymentRevision.findFirst({where:{tenantId,applicationKey,provider},orderBy:{version:'desc'}});if(q.config.enabled&&payment&&paymentConfigured(provider,payment.config,payment.secretFields)&&payment.config.appId!==q.config.appId)fail('MINI_PAYMENT_APPID_MISMATCH','小程序 AppID 与已配置的支付渠道 AppID 不一致',409)}
   let keyCipher=q.clearSecret?null:old?.keyCipher||null;
   if(q.appSecret){try{await this.secrets.assertExistingKey(db);keyCipher=this.secrets.encrypt(aad({tenantId,applicationKey}),{appSecret:q.appSecret})}catch{fail('MINI_KEY_UNAVAILABLE','小程序密钥加密失败，请检查服务端加密密钥',503)}}
   q.config.enabled=!!q.config.appId&&!!keyCipher;
   let uploadKeyCipher=q.clearUploadPrivateKey||changedApp?null:old?.uploadKeyCipher||null;if(q.uploadPrivateKey){await this.secrets.assertExistingKey(db);uploadKeyCipher=this.secrets.encrypt('tenant-mini-upload:'+tenantId+':'+applicationKey+':'+q.config.appId,{privateKey:q.uploadPrivateKey})}
   if(q.config.qrMaterialId&&!await db.tenantMaterial.count({where:{id:q.config.qrMaterialId,tenantId,scopeKey:'shared',kind:'image',status:'ready',deletedAt:null}}))fail('MINI_IMAGE_INVALID','小程序码图片不存在或不属于本站素材库');
   const data={config:q.config,keyCipher,uploadKeyCipher,version:q.version+1};if(old)await db.tenantMiniProgramSetting.update({where,data});else await db.tenantMiniProgramSetting.create({data:{...scope(tenantId,applicationKey),...data}});
   if(changedApp||!q.config.enabled||q.clearSecret)await db.session.deleteMany({where:{tenantId,applicationKey,role:'user',authProvider:'wechat'}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'mini.config.save',details:{version:data.version,enabled:q.config.enabled,appChanged:changedApp,keyChanged:!!q.appSecret,keyCleared:q.clearSecret,uploadKeyChanged:!!q.uploadPrivateKey,uploadKeyCleared:q.clearUploadPrivateKey||changedApp,...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,{applicationKey});
 }
}
