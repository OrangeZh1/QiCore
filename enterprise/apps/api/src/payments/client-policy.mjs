import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {paymentConfigured} from './config.mjs';
import {fail} from '../core/errors.mjs';
import {assertMiniPaymentProduct,paymentProductKind,miniSubjectType,assertPaymentClient} from './product-policy.mjs';

export const paymentClients=[
 {key:'mini',label:'微信小程序',icon:'i-lucide-smartphone',providers:['wechat','balance','wechat-virtual']},
 {key:'official',label:'微信公众号',icon:'i-lucide-message-circle',providers:['wechat','balance']},
 {key:'h5',label:'H5端',icon:'i-lucide-globe',providers:['wechat','alipay','balance']}
];
const labels={wechat:'微信支付',alipay:'支付宝',balance:'余额支付','wechat-virtual':'微信虚拟支付'};
const provider=z.enum(['wechat','alipay','balance','wechat-virtual']);
const method=z.object({provider,enabled:z.boolean()}).strict();
const rules=client=>z.array(method).length(client.providers.length).refine(rows=>new Set(rows.map(r=>r.provider)).size===rows.length&&rows.every(r=>client.providers.includes(r.provider)));
export const paymentPolicySchema=z.object(Object.fromEntries(paymentClients.map(client=>[client.key,rules(client)]))).strict();
export const defaultPaymentPolicy=()=>Object.fromEntries(paymentClients.map(client=>[client.key,client.providers.map(provider=>({provider,enabled:provider!=='wechat-virtual'}))]));
const scope=s=>({tenantId:s.tenantId,applicationKey:s.applicationKey});

export class PaymentClientPolicy {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 async read(db,s){const row=await db.tenantPaymentPolicy.findUnique({where:{tenantId_applicationKey:scope(s)}});return{version:row?.version||0,config:row?.config||defaultPaymentPolicy(),updatedAt:row?.updatedAt||null}}
 async allowed(db,s,client,provider){assertPaymentClient(s,client);const c=paymentClients.find(c=>c.key===client);if(!c||!c.providers.includes(provider))fail('PAYMENT_CLIENT_UNSUPPORTED','该端不支持所选支付方式',409);const policy=await this.read(db,s);if(!policy.config[client].find(r=>r.provider===provider)?.enabled)fail('PAYMENT_METHOD_DISABLED','该端未开放此支付方式',403);return policy.version}
 async product(db,s,client,provider,adapter,order){
  assertPaymentClient(s,client);
  if(client!=='mini'||!['wechat','wechat-virtual'].includes(provider))return;
  assertMiniPaymentProduct(paymentProductKind(adapter,order),provider);
  const subject=await miniSubjectType(db,scope(s));
  if(subject==='unknown')fail('MINI_SUBJECT_REQUIRED','请先在微信小程序渠道配置中选择主体类型',409);
  if(provider==='wechat-virtual'){const row=await db.tenantPaymentRevision.findFirst({where:{...scope(s),provider},orderBy:{version:'desc'}});if(row&&(row.config.subjectType||'business')!==subject)fail('MINI_SUBJECT_CHANGED','主体类型已变化，请重新保存虚拟支付配置',409)}
  if(provider==='wechat'&&subject==='personal')fail('MINI_SUBJECT_UNSUPPORTED','个人主体小程序不支持普通微信支付',409);
 }
 async status(db,s,client,provider,revisions){

  if(provider==='balance')return{configured:true,reason:null};
  if(provider==='wechat'&&client==='mini'){
   const subject=await miniSubjectType(db,scope(s),revisions);
   if(subject!=='business')return{configured:false,reason:subject==='personal'?'个人主体小程序不支持普通微信支付':'请先在微信小程序渠道配置中选择主体类型'};
  }
  const row=revisions.find(r=>r.provider===provider);if(!row||!paymentConfigured(provider,row.config,row.secretFields))return{configured:false,reason:'商户配置不完整'};
  if(provider==='wechat-virtual'){const subject=await miniSubjectType(db,scope(s),revisions);if(subject==='unknown')return{configured:false,reason:'请先在微信小程序渠道配置中选择主体类型'};if((row.config.subjectType||'business')!==subject)return{configured:false,reason:'主体类型已变化，请重新保存虚拟支付配置'};if(row.config.subjectType==='personal'&&!['callbackToken','encodingAESKey'].every(k=>row.secretFields.includes(k)))return{configured:false,reason:'个人主体请先配置安全消息推送凭据'};const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(s)}});if(!mini?.keyCipher||mini.config.appId!==row.config.appId)return{configured:false,reason:'小程序 AppID/AppSecret 未配置或与虚拟支付不一致'}}
  if(provider==='wechat'){
   if(client==='h5'&&row.config.apiVersion!=='V3')return{configured:false,reason:'H5 微信支付需要 API V3'};
   if(client==='mini'){const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(s)}});if(!mini?.config.appId||mini.config.appId!==row.config.appId)return{configured:false,reason:'小程序 AppID 未配置或与支付配置不一致'}}
   if(client==='official'){const official=await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(s)}});if(!official?.config.appId)return{configured:false,reason:'公众号 AppID 尚未配置'}}
  }
  return{configured:true,reason:process.env.PAYMENT_EXECUTION_ENABLED==='true'?null:'平台尚未启用支付执行'};
 }
 async context(db,s,tenantId,key,write=false){const ctx=await this.apps.featureContext(db,s,tenantId,key,'payments','settings.read');if(!ctx.selected)fail('APPLICATION_REQUIRED','请选择应用');await this.apps.admin(s,tenantId,ctx.selected.key,'settings.read',db,write);if(write)await this.apps.admin(s,tenantId,ctx.selected.key,'settings.write',db);return{tenantId,applicationKey:ctx.selected.key,canWrite:ctx.permissions.includes('settings.write')}}
 async expose(db,s,ctx){
  const policy=await this.read(db,ctx),revisions=await db.tenantPaymentRevision.findMany({where:scope(ctx),orderBy:{version:'desc'}}),clients=[];
  for(const c of paymentClients){
   const methods=[];
   for(const row of policy.config[c.key])methods.push({...row,label:labels[row.provider],implemented:true,configPath:row.provider==='balance'?null:'/tenant/payments/'+(row.provider==='wechat-virtual'?'wechat':row.provider)+(row.provider==='wechat-virtual'?'?tab=virtual':row.provider==='wechat'?'?tab=ordinary':''),...await this.status(db,ctx,c.key,row.provider,revisions)});
   if(c.key==='mini'){
    const ordinary=methods.find(row=>row.provider==='wechat'),virtual=methods.find(row=>row.provider==='wechat-virtual');
    if(ordinary&&virtual){virtual.label='微信支付';virtual.combined=true;virtual.configPath='/tenant/payments/wechat';const describe=row=>row.reason||(row.configured?'配置完整':'待配置');virtual.reason='虚拟支付：'+describe(virtual)+'；普通支付：'+describe(ordinary);virtual.configured=virtual.configured||ordinary.configured;}
   }
   clients.push({...c,providers:undefined,methods});
  }
  return{...policy,...ctx,clients};
 }
 async view(s,tenantId,key){const result=await this.apps.transaction(async db=>{const ctx=await this.context(db,s,tenantId,key);return this.expose(db,s,ctx)});const current=await this.context(this.db,s,tenantId,result.applicationKey);result.canWrite=current.canWrite;return result}
 async list(s,tenantId,input={}){const q=z.object({applicationKey:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional()}).strict().safeParse(input);if(!q.success)fail('PAYMENT_POLICY_INPUT_INVALID','支付方式查询参数无效');return this.view(s,tenantId,q.data.applicationKey)}
 async save(s,tenantId,key,input){const parsed=z.object({version:z.number().int().nonnegative(),config:paymentPolicySchema}).strict().safeParse(input);if(!parsed.success)fail('PAYMENT_POLICY_INPUT_INVALID','请检查各端的支付方式及支持范围');const q=parsed.data;await this.apps.transaction(async db=>{const ctx=await this.context(db,s,tenantId,key,true),before=await this.read(db,ctx);if(before.version!==q.version)fail('PAYMENT_POLICY_CONFLICT','支付方式配置已变化，请刷新后再保存',409);const row=await db.tenantPaymentPolicy.upsert({where:{tenantId_applicationKey:scope(ctx)},create:{...scope(ctx),config:q.config},update:{config:q.config,version:{increment:1}}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',...scope(ctx),actor:s.impersonatedBy||s.id,action:'payment.client-policy.save',details:{before:before.config,after:q.config,version:row.version,...(s.delegated?{targetAdminId:s.id}:{})}}})});return this.view(s,tenantId,key)}
}
