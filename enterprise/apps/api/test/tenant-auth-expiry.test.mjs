import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindStandaloneEnterprise} from '../src/core/standalone-edition.mjs';
import {AdminAuth,passwordHash} from '../src/core/admin-auth.mjs';
import {TenantApplications,bindApplicationLicensing} from '../src/applications/service.mjs';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';
import {TenantSiteSettings} from '../src/core/tenant-site-settings.mjs';
import {TenantMaterials} from '../src/core/tenant-materials.mjs';

const key='expiry-fixture';
setApplicationDefinitions([{key,name:'Expiry fixture',permissions:['overview.read','settings.read','materials.read','consumers.read'],overview:{},consumers:{},consoleRoutes:[{path:'/tenant/fixture',group:'workbench',permission:'overview.read'}]}]);
const past=()=>new Date(Date.now()-60000),future=()=>new Date(Date.now()+3600000);
const grants=['tenant:settings.read','tenant:materials.read','tenant:consumers.read',...['overview.read','settings.read','materials.read','consumers.read'].map(p=>key+':'+p)];
function fixture(){
 const tenant={id:'site',standaloneSlot:1,name:'Expired site',enabled:true,expiresAt:past(),ownerAdminId:'owner'};
 const account={id:'owner',username:'owner',roleId:'owner-role',nickname:'Owner',enabled:true,version:1,allowMultipleSessions:true,role:{portal:'tenant',enabled:true,version:1,permissions:grants},scopes:[{tenantId:'site',enabled:true}]};
 const operator={id:'platform',enabled:true,role:{portal:'admin',enabled:true,permissions:['accounts.write','tenants.read']}};
 const parent={portal:'admin',expiresAt:future(),admin:operator},binding={tenantId:'site',applicationKey:key,enabled:true,expiresAt:null,activeSlot:1};
 const delegation={tokenHash:'delegation',tenantId:'site',targetAdminId:'owner',expiresAt:future(),parent};
 const state={session:true,delegation:true,licensed:true,attempts:0},records=new Map(),redisCalls=[];
 const db={
  $transaction:fn=>fn(db),$queryRaw:async()=>[],
  adminAccount:{findUnique:async()=>structuredClone(account)},
  adminSession:{create:async({data})=>{records.set(data.tokenHash,{...data,admin:structuredClone(account)});return data},deleteMany:async()=>records.clear(),findUnique:async({where})=>state.session&&records.get(where.tokenHash)?{...records.get(where.tokenHash),admin:structuredClone(account)}:null,findFirst:async()=>state.session?{}:null},
  adminDelegation:{findUnique:async({where})=>state.delegation&&where.tokenHash===delegation.tokenHash?delegation:null},
  adminTenantScope:{findUnique:async()=>({enabled:true,admin:structuredClone(account)})},
  tenant:{findUnique:async({where})=>where.id===tenant.id?structuredClone(tenant):null,findMany:async({where}={})=>!where||where.id.in.includes(tenant.id)?[structuredClone(tenant)]:[]},
  tenantApplication:{findMany:async()=>[structuredClone(binding)],findUnique:async()=>structuredClone(binding),findFirst:async()=>null},
  audit:{create:async()=>{}},
 };
 const auth=new AdminAuth(db,{eval:async()=>{redisCalls.push('count');return ++state.attempts},del:async()=>{state.attempts=0;redisCalls.push('clear')}},{origin:'https://console.test'});auth.csrfKey=Buffer.alloc(32);
 const apps=new TenantApplications(db);
 bindApplicationLicensing(db,{allowed:()=>state.licensed,assert(){if(!state.licensed)throw Object.assign(Error('license denied'),{code:'APPLICATION_LICENSE_UNAVAILABLE'})}});
 const normal={id:'owner',_admin:true,role:'tenant',tokenHash:'normal',tenantIds:['site'],permissions:grants};
 const delegated={...normal,tokenHash:'delegation',tenantId:'site',delegated:true};
 return{db,auth,apps,normal,delegated,account,tenant,operator,parent,delegation,binding,state,redisCalls};
}

test('enterprise login rate-limits failed attempts and retains the bound expired site for account authentication',async()=>{
 const c=fixture();await bindStandaloneEnterprise(c.db);c.account.passwordHash=await passwordHash('fixture-password');
 const input={portal:'tenant',username:'owner',password:'wrong'};
 for(let n=0;n<10;n++)await assert.rejects(c.auth.login(input,'127.0.0.1','https://console.test'),{code:'LOGIN_INVALID'});
 await assert.rejects(c.auth.login(input,'127.0.0.1','https://console.test'),{code:'LOGIN_LIMIT'});c.state.attempts=0;
 const signed=await c.auth.login({...input,password:'fixture-password'},'127.0.0.1','https://console.test');
 assert.equal(c.redisCalls.at(-1),'clear');assert.deepEqual(signed.info.tenantIds,['site']);
 const session=await c.auth.session(signed.cookie,'tenant');assert.deepEqual(session.tenantIds,['site']);
 const entry=await c.apps.entry(session);assert.equal(entry.access,'tenant-expired');assert.equal(entry.tenant.canEnter,false);assert.equal(entry.tenants[0].id,'site');
 await assert.rejects(c.apps.available('site',key,c.db,false,session),{code:'TENANT_EXPIRED'});
 // The standalone API cannot issue platform credentials.
 await assert.rejects(c.auth.login({...input,portal:'admin'},'127.0.0.1','https://console.test'),{code:'LOGIN_INVALID'});assert.equal(c.redisCalls.at(-1),'clear');
 for(const [target,field,value] of [[c.account,'enabled',false],[c.account,'deletedAt',new Date()],[c.account.role,'enabled',false]]){
  const previous=target[field];target[field]=value;await assert.rejects(c.auth.login({...input,password:'fixture-password'},'127.0.0.1','https://console.test'),{code:'LOGIN_INVALID'});await assert.rejects(c.auth.session(signed.cookie,'tenant'),{code:'UNAUTHENTICATED'});target[field]=previous;
 }
 c.state.session=false;await assert.rejects(c.auth.session(signed.cookie,'tenant'),{code:'UNAUTHENTICATED'});
 c.account.role.portal='admin';await assert.rejects(c.auth.login({...input,password:'fixture-password'},'127.0.0.1','https://console.test'),{code:'PORTAL_FORBIDDEN'});c.account.role.portal='tenant';
 c.account.scopes[0].enabled=false;await assert.rejects(c.auth.login({...input,password:'fixture-password'},'127.0.0.1','https://console.test'),{code:'TENANT_DISABLED'});c.account.scopes[0].enabled=true;
 c.tenant.enabled=false;await assert.rejects(c.auth.login({...input,password:'fixture-password'},'127.0.0.1','https://console.test'),{code:'TENANT_DISABLED'});
 await assert.rejects(c.auth.login({...input,password:'fixture-password'},'127.0.0.1','https://untrusted.test'),{code:'ORIGIN_REJECTED'});
});

test('expired tenants allow only validated platform delegation through entry, application and public management gates',async()=>{
 const c=fixture(),site=new TenantSiteSettings(c.db),materials=new TenantMaterials(c.db,null);
 const reads=s=>[
  ()=>c.apps.admin(s,'site',key,'settings.read'),
  ()=>c.apps.available('site',key,c.db,false,s),
  ()=>c.apps.featureContext(c.db,s,'site',key,'consumers','consumers.read'),
  ()=>site.authorize(c.db,s,'site','tenant:settings.read'),
  ()=>materials.authorize(s,'site','shared'),
  ()=>materials.authorize(s,'site',key),
 ];
 for(const read of reads(c.normal))await assert.rejects(read,error=>['TENANT_EXPIRED','TENANT_UNAVAILABLE'].includes(error.code));
 for(const read of reads(c.delegated))await read();
 const entry=await c.apps.entry(c.delegated);assert.equal(entry.access,'choose-application');assert.equal(entry.tenant.canEnter,true);assert.equal(entry.tenant.canViewOverview,true);assert.equal(entry.applications[0].state,'available');assert.equal(entry.tenant.consoleRoutes[0].path,'/admin/fixture');
 await assert.rejects(c.apps.available('site',key),{code:'TENANT_EXPIRED'},'consumer access has no expiry exemption');
 for(const read of reads({...c.normal,delegated:true,tenantId:'site'}))await assert.rejects(read,{code:'UNAUTHENTICATED'},'client-supplied delegation flags cannot grant access');
 c.state.delegation=false;for(const read of reads(c.delegated))await assert.rejects(read,{code:'UNAUTHENTICATED'});c.state.delegation=true;
 for(const [target,field,value] of [[c.parent,'expiresAt',past()],[c.parent,'portal','tenant'],[c.delegation,'expiresAt',past()],[c.operator,'enabled',false],[c.operator.role,'enabled',false],[c.operator.role,'permissions',[]],[c.account,'enabled',false],[c.account.role,'enabled',false],[c.account.scopes[0],'enabled',false],[c.tenant,'ownerAdminId','different'],[c.tenant,'enabled',false]]){
  const previous=target[field];target[field]=value;
  for(const read of [...reads(c.delegated),()=>c.apps.entry(c.delegated)])await assert.rejects(read,error=>['UNAUTHENTICATED','FORBIDDEN','TENANT_DISABLED'].includes(error.code),field+' remains enforced');
  target[field]=previous;
 }
 await assert.rejects(c.apps.admin({...c.delegated,tenantIds:['site','other']},'other',key,'settings.read'),{code:'FORBIDDEN'});
 c.state.licensed=false;assert.equal((await c.apps.entry(c.delegated)).applications[0].state,'license-unavailable');await assert.rejects(c.apps.admin(c.delegated,'site',key,'settings.read'),{code:'APPLICATION_LICENSE_UNAVAILABLE'});
 c.state.licensed=true;c.binding.expiresAt=past();assert.equal((await c.apps.entry(c.delegated)).applications[0].state,'expired');await assert.rejects(c.apps.admin(c.delegated,'site',key,'settings.read'),{code:'APPLICATION_UNAVAILABLE'});
 c.binding.expiresAt=null;c.binding.enabled=false;await assert.rejects(c.apps.admin(c.delegated,'site',key,'settings.read'),{code:'APPLICATION_UNAVAILABLE'});
 assert.equal((await c.apps.entry(c.delegated,{},false)).access,'system-unavailable');
});
