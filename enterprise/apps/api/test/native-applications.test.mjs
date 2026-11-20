import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {loadNativeApplications,createNativeRuntimes} from '../dist/applications/native-catalog.js';
import {nativeMaintenance,maintenanceReadAllowed} from '../dist/lifecycle/native-maintenance.mjs';
import {checkNativeOperation} from '../dist/license/native-updates.js';
import {fixture} from './fixtures/native-release.mjs';

test('two separate enterprise installations can reuse a route, but a second primary is rejected before code runs',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-multi-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const base={version:'1.0.0',manifestSha256:'a'.repeat(64),path:root,type:'framework',entrypoint:'main.mjs'},components={frm_fixture:base};
 for(const key of ['first-app','second-app']){
  const directory=join(root,key),packageKey='app_'+key.replaceAll('-','_');mkdirSync(directory);
  writeFileSync(join(directory,'application.json'),JSON.stringify({format:'qicore-application-v1',key,packageKey,version:'1.0.0',name:key,pendingTasks:[],web:{admin:{entrypoint:'web/admin/server/index.mjs',publicDir:'web/admin/public',routes:[{path:'/tenant/orders',label:key,permission:'orders.read',group:'transactions',icon:'i-lucide-receipt-text'}]}}}));
  writeFileSync(join(directory,'entry.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(directory,'executed'))},'loaded');export const format='qicore-application-v1',version='1.0.0';export const definition={key:'${key}',name:'${key}',licensePackageKey:'${packageKey}',permissions:['orders.read'],defaultConfig:()=>({}),validateConfig:v=>v};export function createRuntime(){return{key:'${key}',consumerPaths:['orders'],connect(){},initialize(){},tick(){},admin(){return '${key}'},consumer(){return '${key}'},health(){return true},close(){}}}`);
  components[packageKey]={...base,path:directory,type:'app',entrypoint:'entry.mjs'};
 }
 await assert.rejects(loadNativeApplications(JSON.stringify(components),'frm_fixture'),/STANDALONE_MULTIPLE_APPLICATIONS/);
 const scoped=[];
 for(const key of ['first-app','second-app']){
  const packageKey='app_'+key.replaceAll('-','_'),part=components[packageKey];
  assert.equal(existsSync(join(part.path,'executed')),false,'conflicting inventory must not evaluate this entry');
  const isolated=await loadNativeApplications(JSON.stringify({frm_fixture:base,[packageKey]:part}),'frm_fixture');
  assert.equal(isolated.applications.length,1);
  const [runtime]=createNativeRuntimes(isolated.applications,{storage:{forApplication(owner){scoped.push(owner);return Object.freeze({key:owner})}}});
  assert.equal(runtime.key,key);assert.equal(runtime.consumer(),key);assert.equal(await runtime.health(),true);
  assert.equal(isolated.applications[0].definition.consoleRoutes[0].path,'/admin/orders');
  assert.equal(isolated.applications[0].descriptor.web.admin.routes[0].path,'/tenant/orders','persisted descriptor is unchanged');
  assert.equal(existsSync(join(part.path,'executed')),true);await runtime.close();
  assert.throws(()=>createNativeRuntimes(isolated.applications,{storage:{}}),/APPLICATION_STORAGE_CONTRACT_INVALID/);
 }
 assert.deepEqual(scoped,['first-app','second-app']);
});

test('after-sales capability maps only the declaring application order route without changing archive metadata',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-order-capability-'));t.after(()=>{assert.equal(resolve(root,'..'),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})});
 const routes=[{path:'/tenant/orders',label:'订单管理',permission:'orders.read',group:'transactions',icon:'i-lucide-receipt-text'},{path:'/tenant/example-settings',label:'设置',permission:'settings.read',group:'settings',icon:'i-lucide-settings'}];
 for(const [index,afterSalesPage] of [undefined,'/tenant/orders','/tenant/site','/tenant/another-app-orders','/tenant/example-settings',null].entries()){
  const directory=join(root,String(index));mkdirSync(directory);
  const descriptor={format:'qicore-application-v1',key:'fixture',packageKey:'app_fixture',version:'0.1.2',name:'Fixture',pendingTasks:[],web:{admin:{entrypoint:'web/admin/server/index.mjs',publicDir:'web/admin/public',routes}}};
  writeFileSync(join(directory,'application.json'),JSON.stringify(descriptor));
  const definition={key:'fixture',name:'Fixture',licensePackageKey:'app_fixture',permissions:['orders.read','settings.read'],...(afterSalesPage===undefined?{}:{afterSalesPage})};
  writeFileSync(join(directory,'entry.mjs'),`export const format='qicore-application-v1',version='0.1.2';export const definition={...${JSON.stringify(definition)},defaultConfig:()=>({}),validateConfig:v=>v};export function createRuntime(){return{}}`);
  const base={version:'0.1.2',manifestSha256:'a'.repeat(64),path:root,type:'framework',entrypoint:'main.mjs'},components={frm_fixture:base,app_fixture:{...base,path:directory,type:'app',entrypoint:'entry.mjs'}};
  if(afterSalesPage===undefined||afterSalesPage==='/tenant/orders'){
   const loaded=await loadNativeApplications(JSON.stringify(components),'frm_fixture');
   assert.equal(loaded.applications[0].definition.consoleRoutes[0].afterSales,afterSalesPage?true:undefined);
   assert.equal(loaded.applications[0].definition.consoleRoutes[0].path,'/admin/orders');
   assert.equal(loaded.applications[0].definition.afterSalesPage,afterSalesPage?'/admin/orders':undefined);
   assert.equal(loaded.applications[0].descriptor.web.admin.routes[0].path,'/tenant/orders');
   assert.equal(loaded.applications[0].definition.consoleRoutes[1].afterSales,undefined);
  }else await assert.rejects(loadNativeApplications(JSON.stringify(components),'frm_fixture'),/APPLICATION_AFTER_SALES_ROUTE_INVALID/);
  assert.ok(routes.every(route=>!Object.hasOwn(route,'afterSales')));
 }
});

test('installed runtime loads only the controlled inventory and validates application identities and health contracts',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-app-runtime-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});
 const app=join(root,'app');mkdirSync(app);writeFileSync(join(app,'application.json'),JSON.stringify({format:'qicore-application-v1',key:'fixture',packageKey:'app_fixture',version:'1.0.0',name:'Fixture',pendingTasks:[]}));
 writeFileSync(join(app,'entry.mjs'),`export const format='qicore-application-v1',version='1.0.0';export const definition={key:'fixture',name:'Fixture',licensePackageKey:'app_fixture',permissions:['records.read'],defaultConfig:()=>({}),validateConfig:v=>v};export function createRuntime(){return{key:'fixture',consumerPaths:['records'],connect(){},async initialize(){},async tick(){},async admin(){},async consumer(){},async health(){return true},async close(){}}}`);
 const base={version:'1.0.0',manifestSha256:'a'.repeat(64),path:root,type:'framework',entrypoint:'main.mjs'},components={frm_fixture:base,app_fixture:{...base,path:app,type:'app',entrypoint:'entry.mjs'}};
 const result=await loadNativeApplications(JSON.stringify(components),'frm_fixture');assert.equal(result.applications[0].definition.source,'native');assert.equal(result.applications[0].definition.version,'1.0.0');
 const runtimes=createNativeRuntimes(result.applications,{});assert.equal(await runtimes[0].health(),true);
 await assert.rejects(loadNativeApplications(JSON.stringify({...components,app_other:{...components.app_fixture}}),'frm_fixture'),/APPLICATION_DESCRIPTOR_MISMATCH/);
 await assert.rejects(loadNativeApplications(JSON.stringify({...components,app_fixture:{...components.app_fixture,entrypoint:'../entry.mjs'}}),'frm_fixture'));
 assert.throws(()=>createNativeRuntimes([{...result.applications[0],createRuntime:()=>({...runtimes[0],legacyRoutes:true})}],{}),/APPLICATION_RUNTIME_INVALID/);
 assert.throws(()=>createNativeRuntimes([{...result.applications[0],createRuntime:()=>({...runtimes[0],health:undefined})}],{}),/APPLICATION_RUNTIME_INVALID/);
});

test('native lifecycle plans bind actual inventory, exact repair version, identity and signed release',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-app-plan-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root),installed=[{packageKey:'frm_fixture',version:'1.0.0'}],release=f.release('app_fixture','1.1.0','1.0.0').release;
 const now=Date.now(),plan={protocol:'license-api-v2',capability:'native-lifecycle-v1',operation:'install',key_id:'receipt',planId:'plan_fixture',licenseId:'license-test',licenseRevision:1,instanceId:f.client.identity().instanceId,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+60000).toISOString(),productId:'frm_fixture',domain:'127.0.0.1',packageKey:'app_fixture',installed,release};
 f.client.machine=async(path,body)=>{assert.equal(path,'updates/lifecycle/plan');assert.deepEqual(body.installed,plan.installed);return{signedPlan:f.envelope(plan)}};
 assert.equal((await checkNativeOperation(f.client,installed,'app_fixture','install')).release.version,'1.1.0');
 plan.operation='repair';await assert.rejects(checkNativeOperation(f.client,installed,'app_fixture','install'),/APPLICATION_PLAN_MISMATCH/);
 const current=[...installed,{packageKey:'app_fixture',version:'1.1.0'}];plan.installed=current;assert.equal((await checkNativeOperation(f.client,current,'app_fixture','repair')).release.version,'1.1.0');
 plan.release=f.release('app_fixture','1.2.0','1.1.0').release;await assert.rejects(checkNativeOperation(f.client,current,'app_fixture','repair'),/APPLICATION_PLAN_MISMATCH/);
 plan.operation='install';await assert.rejects(checkNativeOperation(f.client,current,'app_fixture','install'),/APPLICATION_OPERATION_INVALID/);
});

test('candidate maintenance keeps health and recovery readable but blocks business writes',t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-app-maintenance-')),file=join(root,'maintenance.json');t.after(()=>rmSync(root,{recursive:true,force:true}));assert.equal(nativeMaintenance(file),false);writeFileSync(file,'{}');assert.equal(nativeMaintenance(file),true);
 for(const [path,method] of [['/health','GET'],['/api/v1/admin/updates','GET'],['/api/v1/admin/updates/resume-closeout','POST']])assert.equal(maintenanceReadAllowed(path,method),true);
 for(const [path,method] of [['/api/v1/recharge/orders','POST'],['/api/v1/admin/updates/execute','POST'],['/api/v1/orders','GET'],['/api/v1/admin/auth/login','POST']])assert.equal(maintenanceReadAllowed(path,method),false);
});
