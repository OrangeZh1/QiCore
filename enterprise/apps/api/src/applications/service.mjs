import {canonicalConsoleRoutes} from './console-pages.mjs';
import {ownerGrants} from '../core/standalone-maintenance.mjs';
import {activeTenantScope,tenantGrants} from '../core/tenant-access.mjs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../core/errors.mjs';
import {isRetryableTransactionError,waitForTransactionRetry} from '../core/transaction-errors.mjs';
import {application,applicationCatalog,hasApplicationPermission} from './registry.mjs';
import {frameworkKey,frameworkDefinition} from './framework.mjs';

const active=row=>row?.enabled&&(!row.expiresAt||row.expiresAt.getTime()>Date.now());
const target=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const settings=z.object({enabled:z.boolean(),expiresAt:z.iso.datetime({offset:true}).nullable(),version:z.number().int().nonnegative()}).strict();
function parse(schema,input){const parsed=schema.safeParse(input);if(!parsed.success)fail('APPLICATION_INPUT_INVALID','请检查应用、状态、到期时间与版本');return parsed.data}

// The host binds licensing once to its shared DB resource. Domain-only tests
// use independent clients; every service borrowing the host client shares this gate.
const licensePolicies=new WeakMap();
export function bindApplicationLicensing(db,policy){
 if(!db||typeof policy?.allowed!=='function'||typeof policy?.assert!=='function'||licensePolicies.has(db))throw Error('APPLICATION_LICENSE_POLICY_INVALID');
 licensePolicies.set(db,policy);
}

import {initializeMemberLevels} from '../core/member-defaults.mjs';

export class TenantApplications {
 constructor(db){this.db=db}
 licenseAllowed(key){application(key);return key===frameworkKey||(licensePolicies.get(this.db)?.allowed(key)??true)}
 assertLicensed(key){application(key);if(key!==frameworkKey)licensePolicies.get(this.db)?.assert(key)}
 licenseLimit(key){
  const policy=licensePolicies.get(this.db);if(!policy)return null;
  const limit=policy.limit?.(key);
  if(limit!==null&&(!Number.isSafeInteger(limit)||limit<0))fail('APPLICATION_LICENSE_UNAVAILABLE','应用坑位限制暂时无法核验',403);
  return limit;
 }
 async assignable(db=this.db){
  const items=[];
  for(const app of applicationCatalog()){
   if(!this.licenseAllowed(app.key))continue;
   const tenantLimit=this.licenseLimit(app.key),used=await db.tenantApplication.count({where:{applicationKey:app.key,activeSlot:1}});
   items.push({key:app.key,name:app.name,tenantLimit,used,remaining:tenantLimit===null?null:Math.max(0,tenantLimit-used),selectable:tenantLimit===null||used<tenantLimit});
  }
  return{items};
 }
 async prepareAssignment(db,tenantId,key){
  if(key===frameworkKey)fail('APPLICATION_INPUT_INVALID','系统公共能力不属于可授权应用');
  application(key);
  // Match the business path: tenant first, then its application. Existing bindings
  // do not allocate another slot and must not lock every tenant using this app.
  const tenant=await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;
  if(!tenant.length)fail('TENANT_MISSING','租户不存在',404);
  const bindings=await db.$queryRaw`SELECT tenantId, applicationKey, activeSlot, enabled, expiresAt, version, configVersion FROM TenantApplication WHERE tenantId=${tenantId} AND activeSlot=1 FOR UPDATE`;
  if(bindings.length>1)fail('APPLICATION_BINDING_CONFLICT','租户存在多个历史应用绑定，请先核查',409);
  if(bindings.length&&bindings[0].applicationKey!==key)fail('APPLICATION_BINDING_LOCKED','请在租户编辑中更换当前授权应用',409);
  if(bindings.length)return {...bindings[0],enabled:!!bindings[0].enabled};
  this.assertLicensed(key);const limit=this.licenseLimit(key);
  if(limit!==null){
   // The indexed range protects finite quotas, including an empty range.
   const occupied=await db.$queryRaw`SELECT tenantId FROM TenantApplication WHERE applicationKey=${key} AND activeSlot=1 FOR UPDATE`;
   if(occupied.length>=limit)fail('APPLICATION_TENANT_LIMIT','该应用的授权坑位已用完',409);
  }
  return db.tenantApplication.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:key}}});
 }
 async bindTenant(db,tenantId,key){
  const before=await this.prepareAssignment(db,tenantId,key);if(before?.activeSlot===1)return before;
  const app=application(key),row=before?await db.tenantApplication.update({where:{tenantId_applicationKey:{tenantId,applicationKey:key}},data:{activeSlot:1,enabled:true,version:{increment:1}}}):await db.tenantApplication.create({data:{tenantId,applicationKey:key,enabled:true,expiresAt:null,config:app.validateConfig(app.defaultConfig())}});
  if(!before&&app.consumers)await initializeMemberLevels(db,tenantId,key);
  this.assertLicensed(key);return row;
 }
 async assertCanRelease(db,tenantId,key){
  const scope={tenantId,applicationKey:key};
  const [payments,refunds,notices]=await Promise.all([
   db.paymentRecord.count({where:{...scope,OR:[{state:{notIn:['PAID','PARTIAL_REFUND','REFUNDED','CLOSED']}},{leaseUntil:{not:null}}]}}),
   db.paymentRefund.count({where:{payment:scope,state:{notIn:['SUCCESS','CLOSED','REJECTED']}}}),
   db.$queryRaw`SELECT COUNT(*) AS total FROM PaymentNotice n INNER JOIN PaymentRecord p ON p.id=n.paymentId WHERE p.tenantId=${tenantId} AND p.applicationKey=${key} AND n.state<>'DONE'`,
  ]);
  if(payments||refunds||Number(notices[0]?.total))fail('APPLICATION_BUSY','应用仍有待完成的支付、退款或通知，请处理完成后再取消或更换',409);
  const app=key===frameworkKey?application(frameworkKey):applicationCatalog().find(item=>item.key===key);
  for(const task of app?application(key).pendingTasks||[]:[]){
   // Only trusted descriptor identifiers enter SQL. Values always remain parameters.
   if([task.table,task.statusColumn,task.applicationKeyColumn,task.tenantIdColumn].filter(Boolean).some(value=>! /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)))throw Error('APPLICATION_TASK_CONTRACT_INVALID');
   const rows=await db.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM \`${task.table}\` WHERE \`${task.statusColumn}\` IN (${task.pendingStates.map(()=>'?').join(',')})${task.applicationKeyColumn?` AND \`${task.applicationKeyColumn}\`=?`:''}${task.tenantIdColumn?` AND \`${task.tenantIdColumn}\`=?`:''}`,...task.pendingStates,...(task.applicationKeyColumn?[key]:[]),...(task.tenantIdColumn?[tenantId]:[]));
   if(Number(rows[0]?.total))fail('APPLICATION_BUSY','应用仍有待完成的业务任务，请处理完成后再取消或更换',409);
  }
 }
 async selectTenant(db,tenantId,key){
  await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;
  const before=await db.tenantApplication.findFirst({where:{tenantId,activeSlot:1}});
  if((before?.applicationKey??null)===key)return before;
  if(before){
   await this.assertCanRelease(db,tenantId,before.applicationKey);
   await db.tenantApplication.update({where:{tenantId_applicationKey:{tenantId,applicationKey:before.applicationKey}},data:{activeSlot:null,enabled:false,version:{increment:1}}});
   await db.session.deleteMany({where:{tenantId,applicationKey:before.applicationKey}});
  }else if(key){
   await this.assertCanRelease(db,tenantId,frameworkKey);
   await db.session.deleteMany({where:{tenantId,applicationKey:frameworkKey}});
  }
  return key?this.bindTenant(db,tenantId,key):null;
 }
 async transaction(fn){for(let n=0;n<4;n++)try{return await this.db.$transaction(fn,{isolationLevel:'Serializable',maxWait:10000,timeout:15000})}catch(e){if(isRetryableTransactionError(e)&&n<3){await waitForTransactionRetry(n);continue}throw e}}
 async available(tenantId,key,db=this.db,lock=false,session=null){
  parse(target,tenantId);this.assertLicensed(key);
  if(lock){await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;await db.$queryRaw`SELECT tenantId FROM TenantApplication WHERE tenantId=${tenantId} AND applicationKey=${key} FOR UPDATE`}
  const tenant=await db.tenant.findUnique({where:{id:tenantId}});
  if(!tenant)fail('TENANT_MISSING','租户不存在',404);
  if(!tenant.enabled)fail('TENANT_DISABLED','租户已停用',403);
  if(tenant.expiresAt&&tenant.expiresAt.getTime()<=Date.now()){
   if(!session?.delegated)fail('TENANT_EXPIRED','租户已到期',403);
   // A supplied flag is not authority: validate the live platform delegation.
   await this.actor(db,session,'tenant',tenantId);
  }
  if(key===frameworkKey){
   const selected=await db.tenantApplication.findFirst({where:{tenantId,activeSlot:1,enabled:true,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{applicationKey:true}});
   if(selected&&applicationCatalog().some(app=>app.key===selected.applicationKey)&&this.licenseAllowed(selected.applicationKey))fail('APPLICATION_NOT_OPEN','当前站点已切换至应用，请从站点入口重新进入',403);
   const where={tenantId_applicationKey:{tenantId,applicationKey:frameworkKey}};
   let row=await db.tenantApplication.findUnique({where});
   if(lock&&!row){row=await db.tenantApplication.create({data:{tenantId,applicationKey:frameworkKey,activeSlot:null,enabled:true,config:{}}});await initializeMemberLevels(db,tenantId,frameworkKey)}
   return row||{tenantId,applicationKey:frameworkKey,activeSlot:null,enabled:true,expiresAt:null,version:0,configVersion:0,config:{}};
  }
  const row=await db.tenantApplication.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:key}}});
  if(!row||row.activeSlot!==1)fail('APPLICATION_NOT_OPEN','租户尚未开通此应用',403);
  if(!active(row))fail('APPLICATION_UNAVAILABLE','应用已停用或到期',403);
  return row;
 }
 async actor(db,s,portal,tenantId){
  if(!s?._admin||s.role!==(portal==='admin'?'root':'tenant')||!s.tokenHash)fail('FORBIDDEN','后台身份或会话无效',403);
  const account=await db.adminAccount.findUnique({where:{id:s.id},include:{role:true,scopes:{include:{permissionRole:true}}}});
  if(!account?.enabled||account.deletedAt||!account.role.enabled||account.role.portal!==portal)fail('FORBIDDEN','账号权限已变更',403);
  if(s.delegated){
   const delegation=await db.adminDelegation.findUnique({where:{tokenHash:s.tokenHash},include:{parent:{include:{admin:{include:{role:true}}}}}});
   const parent=delegation?.parent,operator=parent?.admin;
   const tenant=delegation?await db.tenant.findUnique({where:{id:delegation.tenantId}}):null;
   if(!delegation||delegation.targetAdminId!==s.id||delegation.tenantId!==s.tenantId||delegation.expiresAt<=new Date()||!parent||parent.expiresAt<=new Date()||parent.portal!=='admin'||!operator?.enabled||operator.deletedAt||operator.role.portal!=='admin'||!operator.role.enabled||!['accounts.write','tenants.read'].every(p=>operator.role.permissions.includes(p))||!tenant?.enabled||tenant.ownerAdminId!==s.id||!account.scopes.some(scope=>scope.tenantId===tenant.id&&activeTenantScope(scope)))fail('UNAUTHENTICATED','代登录授权已失效',401);
  }else if(!await db.adminSession.findFirst({where:{tokenHash:s.tokenHash,adminId:s.id,portal,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','后台会话已失效',401);
  if(portal==='tenant'&&tenantId){
   if(!s.tenantIds?.includes(tenantId)||s.delegated&&s.tenantId!==tenantId||!account.scopes.some(scope=>scope.tenantId===tenantId&&activeTenantScope(scope)))fail('FORBIDDEN','没有该站点的访问权限',403);
   account.role={...account.role,permissions:tenantGrants(account,tenantId)};
  }
  return account;
 }
 async admin(s,tenantId,key,permission,db=this.db,lock=false){
  application(key);
  if(!s?._admin||s.role!=='tenant'||!s.tenantIds?.includes(tenantId)||s.delegated&&s.tenantId!==tenantId)fail('FORBIDDEN','没有该租户的数据权限',403);
  if(!hasApplicationPermission(s.permissions,key,permission))fail('FORBIDDEN','没有该应用操作权限',403);
  const row=await this.available(tenantId,key,db,lock,s),account=await this.actor(db,s,'tenant',tenantId);
  if(!account.scopes.some(scope=>scope.tenantId===tenantId)||!hasApplicationPermission(account.role.permissions,key,permission))fail('FORBIDDEN','应用权限已变更',403);
  return row;
 }
 async featureContext(db,s,tenantId,key,feature,permission){
  const actor=await this.actor(db,s,'tenant',tenantId);
  if(!s.tenantIds?.includes(tenantId)||!actor.scopes.some(row=>row.tenantId===tenantId)||s.delegated&&s.tenantId!==tenantId)fail('FORBIDDEN','没有该站点的访问权限',403);
  const tenant=await db.tenant.findUnique({where:{id:tenantId}});if(!tenant?.enabled||!s.delegated&&tenant.expiresAt&&tenant.expiresAt<=new Date())fail('TENANT_UNAVAILABLE','站点已停用或到期',403);
  const enabled=await db.tenantApplication.findMany({where:{tenantId,activeSlot:1,enabled:true,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{applicationKey:true}});
  const permitted=appKey=>p=>hasApplicationPermission(s.permissions,appKey,p)&&hasApplicationPermission(actor.role.permissions,appKey,p);
  const sources=applicationCatalog().filter(app=>this.licenseAllowed(app.key)&&application(app.key)[feature]&&enabled.some(row=>row.applicationKey===app.key)&&permitted(app.key)(permission)).map(app=>({key:app.key,name:app.name}));
  const liveApplication=enabled.some(row=>applicationCatalog().some(app=>app.key===row.applicationKey)&&this.licenseAllowed(row.applicationKey));
  if(!liveApplication&&(!key||key===frameworkKey)&&frameworkDefinition[feature]&&permitted(frameworkKey)(permission))sources.push({key:frameworkKey,name:frameworkDefinition.name});
  if(!sources.length)fail('FORBIDDEN','没有可查看的应用',403);
  const selected=key?sources.find(app=>app.key===key):sources.length===1?sources[0]:null;
  if(key&&!selected)fail('FORBIDDEN','没有该应用的访问权限',403);
  return{sources,selected,permissions:selected?application(selected.key).permissions.filter(permitted(selected.key)):[]};
 }
 async list(s,tenantId){
  parse(target,tenantId);const account=await this.actor(this.db,s,'admin');if(!account.role.permissions.includes('tenants.read'))fail('FORBIDDEN','没有租户查看权限',403);
  if(!await this.db.tenant.count({where:{id:tenantId}}))fail('TENANT_MISSING','租户不存在',404);
  const rows=await this.db.tenantApplication.findMany({where:{tenantId,applicationKey:{not:frameworkKey}},select:{applicationKey:true,activeSlot:true,enabled:true,expiresAt:true,version:true,configVersion:true}});
  return{catalog:applicationCatalog(),items:rows};
 }
 async configure(s,tenantId,key,input){
  parse(target,tenantId);const app=application(key),q=parse(settings,input);
  return this.transaction(async db=>{
   const account=await this.actor(db,s,'admin');if(!account.role.permissions.includes('tenants.write'))fail('FORBIDDEN','没有应用开通管理权限',403);
   const before=await this.prepareAssignment(db,tenantId,key);
   if(q.enabled)this.assertLicensed(key);
   const where={tenantId_applicationKey:{tenantId,applicationKey:key}};
   if((before?.version??0)!==q.version)fail('APPLICATION_CONFLICT','应用开通信息已变更，请刷新',409);
   const data={activeSlot:1,enabled:q.enabled,expiresAt:q.expiresAt?new Date(q.expiresAt):null};
   const row=before?await db.tenantApplication.update({where,data:{...data,version:{increment:1}}}):await db.tenantApplication.create({data:{tenantId,applicationKey:key,...data,config:app.validateConfig(app.defaultConfig())}});
   if(!before&&app.consumers)await initializeMemberLevels(db,tenantId,key);
   if(!active(row))await db.session.deleteMany({where:{tenantId,applicationKey:key}});
   await db.audit.create({data:{id:randomUUID(),scope:'platform',tenantId,applicationKey:key,actor:s.id,action:before?'application.update':'application.open',details:{enabled:row.enabled,expiresAt:row.expiresAt?.toISOString()??null,version:row.version}}});
   return{applicationKey:key,enabled:row.enabled,expiresAt:row.expiresAt,version:row.version,configVersion:row.configVersion};
  });
 }
 async config(s,tenantId,key){const row=await this.admin(s,tenantId,key,'settings.read');return{id:tenantId,applicationKey:key,config:row.config,version:row.configVersion}}
 async entry(s,input={},systemAllowed=true){
  const q=parse(z.object({tenantId:target.optional(),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional()}).strict(),input);
  const account=await this.actor(this.db,s,'tenant');
  const ids=account.scopes.filter(activeTenantScope).map(scope=>scope.tenantId).filter(id=>!s.delegated||id===s.tenantId);
  const [tenants,bindings]=await Promise.all([
   this.db.tenant.findMany({where:{id:{in:ids}},select:{id:true,name:true,enabled:true,expiresAt:true,ownerAdminId:true},orderBy:[{name:'asc'},{id:'asc'}]}),
   this.db.tenantApplication.findMany({where:{tenantId:{in:ids},activeSlot:1},select:{tenantId:true,applicationKey:true,enabled:true,expiresAt:true}})
  ]);
  const selectedId=q.tenantId||(tenants.length===1?tenants[0].id:null);
  const tenant=tenants.find(row=>row.id===selectedId)||null;
  const catalog=applicationCatalog();
  for(const site of tenants)site.canEnter=systemAllowed&&site.enabled&&(!!s.delegated||active(site));
  const visibleGrants=id=>ownerGrants(account.id,tenants.find(t=>t.id===id)?.ownerAdminId,tenantGrants(account,id)).filter(grant=>grant.startsWith('tenant:')||tenants.find(site=>site.id===id)?.canEnter&&catalog.some(app=>this.licenseAllowed(app.key)&&bindings.some(row=>row.tenantId===id&&row.applicationKey===app.key&&active(row))&&app.permissions.some(qualified=>hasApplicationPermission([grant],app.key,qualified.slice(app.key.length+1)))));
  const overview=id=>catalog.some(app=>application(app.key).overview&&this.licenseAllowed(app.key)&&bindings.some(row=>row.tenantId===id&&row.applicationKey===app.key&&active(row))&&hasApplicationPermission(visibleGrants(id),app.key,'overview.read'));
  const permissions=tenant?visibleGrants(tenant.id):[],canViewOverview=!!tenant&&overview(tenant.id);
  for(const site of tenants)site.canViewOverview=overview(site.id);
  const base={tenants,tenant,applications:[],application:null,access:'choose-tenant',canViewOverview,permissions};
  if(selectedId&&!tenant)return{...base,access:'forbidden'};
  if(!tenant)return{...base,access:tenants.length?'choose-tenant':'no-tenants'};
  if(!systemAllowed)return{...base,access:'system-unavailable'};
  if(!tenant.enabled)return{...base,access:'tenant-disabled'};
  if(!s.delegated&&tenant.expiresAt&&tenant.expiresAt<=new Date())return{...base,access:'tenant-expired'};
  const rows=bindings.filter(row=>row.tenantId===tenant.id);
  // Menu visibility follows featureContext: select the live licensed application, or the
  // independent framework data domain. A role grant alone cannot supply an absent adapter.
  const bound=rows.find(row=>active(row)&&catalog.some(app=>app.key===row.applicationKey)&&this.licenseAllowed(row.applicationKey));
  const source=bound?application(bound.applicationKey):frameworkDefinition;
  const allowed=(feature,permission)=>!!source[feature]&&hasApplicationPermission(permissions,source.key,permission)&&hasApplicationPermission(s.permissions,source.key,permission);
  tenant.features={
   consumers:allowed('consumers','consumers.read'),packages:allowed('packages','entitlements.read'),
   entitlements:allowed('entitlements','entitlements.read'),entitlementLedger:allowed('entitlementLedger','entitlements.read'),
   pointsLedger:allowed('pointsLedger','entitlements.read'),transactions:allowed('transactions','orders.read'),
   payments:allowed('payments','settings.read'),recharge:allowed('payments','entitlements.read'),
   virtualGoods:allowed('virtualGoods','settings.read'),sms:allowed('sms','settings.read'),
   subscriptions:allowed('subscriptions','settings.read'),wechatMini:allowed('wechatMini','settings.read'),
   wechatOfficial:allowed('wechatOfficial','settings.read'),decoration:allowed('decoration','settings.read'),
   h5:allowed('h5','settings.read'),helpCenter:allowed('helpCenter','settings.read'),
  };

  const applications=catalog.map(app=>{
   const row=rows.find(row=>row.applicationKey===app.key);
   const permitted=application(app.key).permissions.some(permission=>hasApplicationPermission(tenantGrants(account,tenant.id),app.key,permission));
   const state=!row?'not-open':!row.enabled?'disabled':row.expiresAt&&row.expiresAt<=new Date()?'expired':!this.licenseAllowed(app.key)?'license-unavailable':!permitted?'forbidden':'available';
   const consoleRoutes=state==='available'?canonicalConsoleRoutes(application(app.key).consoleRoutes||[]).filter(route=>hasApplicationPermission(permissions,app.key,route.permission)):[];
   return{key:app.key,name:app.name,state,expiresAt:row?.expiresAt??null,consoleRoutes};
  });
  const systemRoutes=applications.some(app=>app.state==='available')?[]:canonicalConsoleRoutes(application(frameworkKey).consoleRoutes||[]).filter(route=>hasApplicationPermission(permissions,frameworkKey,route.permission)).map(route=>({...route,applicationKey:frameworkKey}));
  tenant.consoleRoutes=[...applications.flatMap(app=>app.consoleRoutes.map(route=>({...route,applicationKey:app.key}))),...systemRoutes];
  tenant.application=rows[0]?(applications.find(app=>app.key===rows[0].applicationKey)||{key:rows[0].applicationKey,name:'应用未加载',state:'not-installed',expiresAt:rows[0].expiresAt,consoleRoutes:[]}):null;
  const selected=q.applicationKey?applications.find(app=>app.key===q.applicationKey)||null:null;
  return{...base,applications,application:selected,access:q.applicationKey?(selected?.state||'unknown-application'):applications.some(app=>app.state==='available')?'choose-application':'no-applications'};
 }
 async updateConfig(s,tenantId,key,input){
  const app=application(key);
  if(!input||Object.keys(input).some(k=>!['config','version'].includes(k))||!Number.isSafeInteger(input.version)||input.version<1)fail('CONFIG_INVALID','请提交配置与有效版本');
  const config=app.validateConfig(input.config);
  return this.transaction(async db=>{
   const before=await this.admin(s,tenantId,key,'settings.write',db,true);
   if(before.configVersion!==input.version)fail('CONFIG_CONFLICT','配置已变更，请刷新',409);
   const changed=await db.tenantApplication.updateMany({where:{tenantId,applicationKey:key,configVersion:input.version},data:{config,configVersion:{increment:1}}});
   if(!changed.count)fail('CONFIG_CONFLICT','配置已变更，请刷新',409);
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'config.update',details:{before:before.config,after:config,version:input.version+1,...(s.delegated?{targetAdminId:s.id}:{})}}});
   return{version:input.version+1,applicationKey:key};
  });
 }
}
