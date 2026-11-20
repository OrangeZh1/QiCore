import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {subscriptionConfig,subscriptionConfigured,subscriptionData,subscriptionTemplate,SubscriptionTransport} from '../channels/subscriptions.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {identityAad} from './wechat-consumer-auth.mjs';
import {fail} from './errors.mjs';
import {selectTemplates} from '../channels/subscription-selection.mjs';

const key=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),version=z.number().int().nonnegative();
const parse=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)fail('SUBSCRIPTION_INPUT_INVALID',formValidationMessage(p.error));return p.data};
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey});
const safeCode=e=>/^[A-Z0-9_]{1,64}$/.test(e?.code||'')?e.code:'SUBSCRIPTION_UNAVAILABLE';
const defaultEvent=()=>({enabled:false,templateId:'',fields:[{key:'thing1',source:'title'},{key:'thing2',source:'status'},{key:'time3',source:'time'}]});

export class TenantSubscriptions {
 constructor(db,mini,{transport=new SubscriptionTransport(),enabled=process.env.WECHAT_SUBSCRIPTION_SEND_ENABLED==='true',selectionEnabled=process.env.WECHAT_SUBSCRIPTION_TEMPLATES_ENABLED==='true'}={}){this.db=db;this.mini=mini;this.apps=new TenantApplications(db);this.transport=transport;this.enabled=enabled;this.selectionEnabled=selectionEnabled;this.busy=false;this.selecting=0}
 adapter(key){const value=application(key).subscriptions;if(!value)fail('SUBSCRIPTION_UNSUPPORTED','该应用未接入订阅消息');return value}
 async context(db,s,tenantId,applicationKey,write=false){parse(key,tenantId);if(applicationKey)parse(key,applicationKey);if(write)await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true);return this.apps.featureContext(db,s,tenantId,applicationKey,'subscriptions','settings.read')}
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:key.optional()}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),applicationKey=ctx.selected?.key;
  const row=applicationKey?await this.db.tenantSubscriptionSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}}):null;
  const mini=applicationKey?await this.db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}}):null;
  const adapter=applicationKey?this.adapter(applicationKey):null,current=await this.context(this.db,s,tenantId,applicationKey);
  const selection=row?.config._selection||null;
  return{applicationKey:applicationKey||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write'),version:row?.version||0,appId:mini?.config.appId||'',miniEnabled:!!mini?.config.appId&&!!mini.keyCipher,appChanged:!!row&&row.appId!==mini?.config.appId,sendEnabled:this.enabled,selectionEnabled:this.selectionEnabled,selection:selection?{id:selection.id,status:selection.status==='RUNNING'&&Date.parse(selection.expiresAt)<=Date.now()?'UNKNOWN':selection.status,rows:selection.rows||[],finishedAt:selection.finishedAt||null}:null,fields:adapter?.fields||[],events:adapter?.events.map(e=>({...e,...(row?.config[e.key]||defaultEvent()),enabled:subscriptionConfigured(row?.config[e.key])}))||[]};
 }
 async save(s,tenantId,applicationKey,event,input){
  const q=parse(z.object({version,config:z.unknown()}).strict(),input),adapter=this.adapter(applicationKey);if(!adapter.events.some(e=>e.key===event))fail('SUBSCRIPTION_EVENT_INVALID','不支持的通知场景');const config=subscriptionConfig(q.config,adapter);
  await this.apps.transaction(async db=>{await this.context(db,s,tenantId,applicationKey,true);const where={tenantId_applicationKey:scope(tenantId,applicationKey)},old=await db.tenantSubscriptionSetting.findUnique({where});if((old?.version||0)!==q.version)fail('SUBSCRIPTION_CONFIG_CONFLICT','订阅消息配置已更新，请重新读取',409);
   if(old?.config._selection?.status==='RUNNING'&&Date.parse(old.config._selection.expiresAt)>Date.now())fail('SUBSCRIPTION_SELECTION_BUSY','正在获取模板，请稍后再保存',409);
   const mini=await db.tenantMiniProgramSetting.findUnique({where});if(config.enabled)await this.mini.credentials(tenantId,applicationKey,db);const appId=mini?.config.appId||'';
   // AppID changes invalidate every other template; never carry templates to another mini program.
   const saved=old?.appId===appId?structuredClone(old.config):{};saved[event]=config;
   await db.tenantSubscriptionSetting.upsert({where,create:{tenantId,applicationKey,appId,config:saved,version:1},update:{appId,config:saved,version:q.version+1}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'subscription.config.save',details:{event,enabled:config.enabled,version:q.version+1}}});
  });return this.view(s,tenantId,{applicationKey});
 }
 async select(s,tenantId,applicationKey,input){
  const q=parse(z.object({version,requestId:z.uuid()}).strict(),input),where={tenantId_applicationKey:scope(tenantId,applicationKey)},actorId=s.impersonatedBy||s.id,payloadHash=createHash('sha256').update(JSON.stringify([tenantId,applicationKey,q.version])).digest('hex');
  const prepared=await this.apps.transaction(async db=>{
   await this.context(db,s,tenantId,applicationKey,true);const old=await db.tenantSubscriptionSetting.findUnique({where}),request=await db.adminProvisionRequest.findUnique({where:{actorId_requestId:{actorId,requestId:q.requestId}}});
   if(request){if(request.kind!=='subscription.select'||request.payloadHash!==payloadHash)fail('SUBSCRIPTION_REQUEST_CONFLICT','请求编号已用于其他操作',409);if(old?.config._selection?.id!==q.requestId)fail('SUBSCRIPTION_REQUEST_FINISHED','该请求已结束，请读取当前配置',409);return{existing:true}}
   if(!this.selectionEnabled)fail('SUBSCRIPTION_SELECTION_BLOCKED','当前环境尚未开放微信模板获取，可先手动配置',503);
   if((old?.version||0)!==q.version)fail('SUBSCRIPTION_CONFIG_CONFLICT','订阅配置已更新，请重新读取',409);if(old?.config._selection?.status==='RUNNING'&&Date.parse(old.config._selection.expiresAt)>Date.now())fail('SUBSCRIPTION_SELECTION_BUSY','已有模板获取任务正在执行',409);
   const credentials=await this.mini.credentials(tenantId,applicationKey,db),config=old?.appId===credentials.appId?structuredClone(old.config):{},uncertainTitles=config._selection?.uncertainTitles||[];
   config._selection={id:q.requestId,status:'RUNNING',expiresAt:new Date(Date.now()+180000).toISOString(),uncertainTitles,rows:[]};
   await db.tenantSubscriptionSetting.upsert({where,create:{tenantId,applicationKey,appId:credentials.appId,config,version:q.version},update:{appId:credentials.appId,config}});
   await db.adminProvisionRequest.create({data:{actorId,requestId:q.requestId,kind:'subscription.select',payloadHash,resultId:q.requestId}});return{credentials,uncertainTitles};
  });if(prepared.existing)return this.view(s,tenantId,{applicationKey});
  this.selecting++;
  const check=async(db,admin=true)=>{
   if(admin)await this.context(db,s,tenantId,applicationKey,true);const row=await db.tenantSubscriptionSetting.findUnique({where});if(row?.version!==q.version||row.appId!==prepared.credentials.appId||row.config._selection?.id!==q.requestId||row.config._selection.status!=='RUNNING'||Date.parse(row.config._selection.expiresAt)<=Date.now())fail('SUBSCRIPTION_CONFIG_CONFLICT','模板获取期间配置已变化',409);if(admin){const c=await this.mini.credentials(tenantId,applicationKey,db);if(c.version!==prepared.credentials.version)fail('SUBSCRIPTION_CONFIG_CONFLICT','小程序凭据已变化',409)}return row;
  };
  const guard=()=>this.apps.transaction(db=>check(db));
  try{
   await guard();const token=await this.transport.token(prepared.credentials);
   const result=await selectTemplates(this.transport,token,this.adapter(applicationKey),{guard,uncertainTitles:prepared.uncertainTitles,beforeAdd:(title,event)=>this.apps.transaction(async db=>{const row=await check(db),config=structuredClone(row.config);config._selection.uncertainTitles=[...new Set([...config._selection.uncertainTitles,title])];config._selection.rows=[...config._selection.rows,{key:event,state:'adding',title,message:'正在选用模板'}];await db.tenantSubscriptionSetting.update({where,data:{config}})})});
   await this.apps.transaction(async db=>{const row=await check(db),matched=Object.keys(result.config).length;for(const [event,value] of Object.entries(result.config))if(row.config[event])value.enabled=subscriptionConfigured(value);const changed=Object.entries(result.config).some(([event,value])=>JSON.stringify(row.config[event])!==JSON.stringify(value)),config={...row.config,...result.config};config._selection={...config._selection,status:result.rows.some(r=>r.state==='unknown')?'UNKNOWN':result.rows.some(r=>r.state==='failed')?'FAILED':'COMPLETED',rows:result.rows,uncertainTitles:result.uncertainTitles,finishedAt:new Date().toISOString()};await db.tenantSubscriptionSetting.update({where,data:{config,version:changed?q.version+1:q.version}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:actorId,action:'subscription.templates.select',details:{requestId:q.requestId,matched,rows:result.rows}}})});
  }catch(e){
   // Finalize only our durable attempt, even when its actor has since lost permission.
   await this.apps.transaction(async db=>{await db.$queryRaw`SELECT tenantId FROM TenantSubscriptionSetting WHERE tenantId=${tenantId} AND applicationKey=${applicationKey} FOR UPDATE`;const row=await db.tenantSubscriptionSetting.findUnique({where});if(row?.config._selection?.id!==q.requestId||row.config._selection.status!=='RUNNING')return;const config=structuredClone(row.config);config._selection={...config._selection,status:config._selection.uncertainTitles.length?'UNKNOWN':'FAILED',finishedAt:new Date().toISOString(),rows:[...config._selection.rows,{key:'result',label:'获取结果',state:'failed',message:'获取未完成，原配置保留；请重新读取后核对。'}]};await db.tenantSubscriptionSetting.update({where,data:{config}})});throw e;
  }finally{this.selecting--}
  return this.view(s,tenantId,{applicationKey});
 }
 async consumer(db,s){
  if(s.role!=='user'||s.authProvider!=='wechat')fail('WECHAT_LOGIN_REQUIRED','请使用当前小程序微信身份登录',401);
  await this.apps.available(s.tenantId,s.applicationKey,db,true);await assertConsumerActive(db,s.tenantId,s.applicationKey,s.userId);
  const session=await db.session.findUnique({where:{token:s.token}});if(!session||session.expiresAt<=new Date()||session.userId!==s.userId||session.tenantId!==s.tenantId||session.applicationKey!==s.applicationKey||session.authAppId!==s.authAppId)fail('UNAUTHENTICATED','会话已失效，请重新登录',401);
  const credentials=await this.mini.credentials(s.tenantId,s.applicationKey,db);if(credentials.appId!==s.authAppId)fail('WECHAT_LOGIN_REQUIRED','小程序配置已变化，请重新登录',401);return credentials;
 }
 async options(s,targetId){parse(key,targetId);return this.apps.transaction(async db=>{
  const credentials=await this.consumer(db,s),target=await this.adapter(s.applicationKey).target(db,s,targetId),where={tenantId:s.tenantId,applicationKey:s.applicationKey,targetId,attempt:target.attempt};
  const previous=await db.subscriptionConsent.findUnique({where:{tenantId_applicationKey_targetId_attempt:where}}),row=await db.tenantSubscriptionSetting.findUnique({where:{tenantId_applicationKey:scope(s.tenantId,s.applicationKey)}});
  const templateIds=row?.appId===credentials.appId?[...new Set(Object.values(row.config).filter(subscriptionConfigured).map(e=>e.templateId))]:[];
  return{targetId,attempt:target.attempt,version:row?.version||0,templateIds:previous?[]:templateIds,recorded:!!previous,choices:previous?.choices||{},terminal:target.terminal};
 })}
 async consent(s,targetId,input){
  parse(key,targetId);const q=parse(z.object({version,attempt:z.number().int().positive(),choices:z.record(subscriptionTemplate,z.enum(['accept','reject','ban','filter']))}).strict(),input);
  return this.apps.transaction(async db=>{const credentials=await this.consumer(db,s),adapter=this.adapter(s.applicationKey),target=await adapter.target(db,s,targetId);if(target.attempt!==q.attempt)fail('SUBSCRIPTION_ATTEMPT_CHANGED','任务已进入新的尝试，请重新读取',409);
   const where={tenantId:s.tenantId,applicationKey:s.applicationKey,targetId,attempt:q.attempt},existing=await db.subscriptionConsent.findUnique({where:{tenantId_applicationKey_targetId_attempt:where}});
   if(existing){if(existing.userId!==s.userId)fail('FORBIDDEN','订阅归属不匹配',403);return{recorded:true,choices:existing.choices}}
   const row=await db.tenantSubscriptionSetting.findUnique({where:{tenantId_applicationKey:scope(s.tenantId,s.applicationKey)}});if(!row||row.version!==q.version||row.appId!==credentials.appId)fail('SUBSCRIPTION_CONFIG_CONFLICT','订阅模板已变化，请重新读取',409);
   const ids=[...new Set(Object.values(row.config).filter(subscriptionConfigured).map(e=>e.templateId))];if(!ids.length||ids.length>3||Object.keys(q.choices).length!==ids.length||ids.some(id=>!Object.hasOwn(q.choices,id)))fail('SUBSCRIPTION_CHOICES_INVALID','订阅结果与当前模板不一致');
   await db.subscriptionConsent.create({data:{id:randomUUID(),...where,userId:s.userId,appId:credentials.appId,settingsVersion:row.version,choices:q.choices,configSnapshot:row.config,expiresAt:new Date(Date.now()+86400000)}});
   if(target.terminal)await this.enqueue(db,adapter.event(target.job));return{recorded:true,choices:q.choices};
  });
 }
 async enqueue(db,event){
  const {tenantId,applicationKey,userId,targetId,attempt}=event,consent=await db.subscriptionConsent.findUnique({where:{tenantId_applicationKey_targetId_attempt:{tenantId,applicationKey,targetId,attempt}}});
  if(!consent||consent.userId!==userId||consent.expiresAt<=new Date())return;
  const config=consent.configSnapshot[event.event];if(!subscriptionConfigured(config)||consent.choices[config.templateId]!=='accept')return;
  const payload={page:event.page,data:subscriptionData(config.fields,event.values)};
  await db.subscriptionDelivery.upsert({where:{consentId:consent.id},update:{},create:{id:randomUUID(),consentId:consent.id,tenantId,applicationKey,userId,appId:consent.appId,event:event.event,targetId,templateId:config.templateId,payload,settingsVersion:consent.settingsVersion,status:'PENDING',expiresAt:consent.expiresAt}});
 }
 async logs(s,tenantId,applicationKey,input={}){
  const q=parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n),'须为 10、20 或 50').default(20)}).strict(),input);await this.context(this.db,s,tenantId,applicationKey);
  const where=scope(tenantId,applicationKey),total=await this.db.subscriptionDelivery.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize))),items=await this.db.subscriptionDelivery.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*q.pageSize,take:q.pageSize,select:{id:true,userId:true,event:true,targetId:true,status:true,errorCode:true,createdAt:true,updatedAt:true}});await this.context(this.db,s,tenantId,applicationKey);
  return{items:items.map(r=>({...r,provider:'wechat',phoneMasked:r.userId,purposeLabel:this.adapter(applicationKey).events.find(e=>e.key===r.event)?.label||r.event,receipt:null})),total,page,pageSize:q.pageSize};
 }
 async sendContext(db,row){
  await this.apps.available(row.tenantId,row.applicationKey,db,true);await assertConsumerActive(db,row.tenantId,row.applicationKey,row.userId);
  if(row.expiresAt<=new Date())fail('SUBSCRIPTION_EXPIRED','订阅任务已到期');
  const setting=await db.tenantSubscriptionSetting.findUnique({where:{tenantId_applicationKey:scope(row.tenantId,row.applicationKey)}});
  if(setting?.version!==row.settingsVersion||setting.appId!==row.appId||!subscriptionConfigured(setting.config[row.event]))fail('SUBSCRIPTION_CONFIG_CHANGED','订阅配置已变更');
  const credentials=await this.mini.credentials(row.tenantId,row.applicationKey,db);if(credentials.appId!==row.appId)fail('SUBSCRIPTION_APP_CHANGED','小程序已变更');
  const identity=await db.consumerExternalIdentity.findFirst({where:{tenantId:row.tenantId,applicationKey:row.applicationKey,userId:row.userId,provider:'wechat',appId:row.appId}});if(!identity)fail('SUBSCRIPTION_IDENTITY_MISSING','微信身份已失效');
  const {openId}=this.mini.secrets.decrypt(identityAad(identity),identity.identityCipher);if(typeof openId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(openId))fail('SUBSCRIPTION_IDENTITY_INVALID','微信身份无效');return{credentials,openId};
 }
 async deliver(row){
  const claimToken=randomUUID();const claimed=await this.db.subscriptionDelivery.updateMany({where:{id:row.id,status:'PENDING',attempts:row.attempts,nextAttemptAt:{lte:new Date()},expiresAt:{gt:new Date()}},data:{status:'PREPARING',claimToken,attempts:{increment:1}}});if(!claimed.count)return;
  let sending=false;
  try{
   const first=await this.apps.transaction(db=>this.sendContext(db,row)),token=await this.transport.token(first.credentials);
   const ready=await this.apps.transaction(async db=>{const current=await db.subscriptionDelivery.findUnique({where:{id:row.id}});if(current.status!=='PREPARING'||current.claimToken!==claimToken)fail('SUBSCRIPTION_CLAIM_LOST','任务状态已变化');const ctx=await this.sendContext(db,row);if(ctx.credentials.version!==first.credentials.version)fail('SUBSCRIPTION_CONFIG_CHANGED','小程序凭据已变更');await db.subscriptionDelivery.update({where:{id:row.id},data:{status:'SENDING'}});return ctx});
   sending=true;const result=await this.transport.send(token,{touser:ready.openId,template_id:row.templateId,...row.payload});
   await this.db.subscriptionDelivery.updateMany({where:{id:row.id,claimToken,status:'SENDING'},data:{status:result.accepted?'ACCEPTED':'FAILED',errorCode:result.accepted?null:result.code}});
  }catch(e){const transient=!sending&&e?.code==='WECHAT_CHECK_UNAVAILABLE'&&row.attempts<2,status=sending?'UNKNOWN':transient?'PENDING':'CANCELLED';await this.db.subscriptionDelivery.updateMany({where:{id:row.id,claimToken,status:{in:['PREPARING','SENDING']}},data:{status,errorCode:sending?'SUBSCRIPTION_RESULT_UNKNOWN':safeCode(e),nextAttemptAt:new Date(Date.now()+60000)}})}
 }
 async tick(){if(this.busy)return;this.busy=true;try{
  const stale=new Date(Date.now()-120000);await this.db.subscriptionDelivery.updateMany({where:{status:'SENDING',updatedAt:{lt:stale}},data:{status:'UNKNOWN',errorCode:'SUBSCRIPTION_INTERRUPTED'}});
  await this.db.subscriptionDelivery.updateMany({where:{status:'PREPARING',updatedAt:{lt:stale},attempts:{lt:3}},data:{status:'PENDING'}});
  await this.db.subscriptionDelivery.updateMany({where:{status:'PREPARING',updatedAt:{lt:stale},attempts:{gte:3}},data:{status:'CANCELLED',errorCode:'SUBSCRIPTION_PREPARE_EXHAUSTED'}});
  await this.db.subscriptionDelivery.updateMany({where:{status:'PENDING',expiresAt:{lte:new Date()}},data:{status:'CANCELLED',errorCode:'SUBSCRIPTION_EXPIRED'}});
  if(!this.enabled)return;for(const row of await this.db.subscriptionDelivery.findMany({where:{status:'PENDING',nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:10}))await this.deliver(row);
 }finally{this.busy=false}}
}
