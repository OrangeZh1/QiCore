import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {provisionEnterprise,bindStandaloneEnterprise,assertEnterpriseRequest} from '../dist/core/standalone-edition.mjs';
import {TenantManagement} from '../dist/core/tenant-management.js';
import {setApplicationDefinitions} from '../dist/applications/catalog-state.mjs';
import {bindApplicationLicensing,TenantApplications} from '../dist/applications/service.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';

test('the enterprise owner cannot create or choose a second company via the public API',()=>{
 const id=randomUUID(),other=randomUUID();
 assertEnterpriseRequest(id,{path:'/api/v1/admin/tenant-entry',method:'GET',query:{tenantId:id}});
 for(const [path,method,expected] of [['/api/v1/admin/tenants','POST',404],['/api/v1/admin/tenants/'+id,'PUT',404],['/api/v1/admin/tenants/'+other+'/roles','GET',403]]){
  assert.throws(()=>assertEnterpriseRequest(id,{path,method}),{status:expected});
 }
});

test('transaction retries yield to the lock holder without widening the four-attempt bound',async()=>{
 for(const create of [db=>new TenantManagement(db,()=>Buffer.alloc(32)),db=>new TenantApplications(db)]){
  let attempts=0,actionCalls=0,released=false;const deadlock=Object.assign(Error('fixture deadlock'),{code:'P2010',meta:{code:'1213'}});
  const releaseTimer=setTimeout(()=>{released=true},0);
  const action=async()=>{actionCalls++;return 'committed'};
  const service=create({$transaction:async fn=>{attempts++;assert.equal(fn,action);if(!released)throw deadlock;return fn()}});
  try{assert.equal(await service.transaction(action),'committed')}finally{clearTimeout(releaseTimer)}assert.equal(attempts,2);assert.equal(actionCalls,1);
  attempts=0;const exhausted=create({$transaction:async()=>{attempts++;throw deadlock}});
  await assert.rejects(exhausted.transaction(action),error=>error===deadlock);assert.equal(attempts,4);
  attempts=0;const invalid=Object.assign(Error('fixture invalid SQL'),{code:'P2010',meta:{code:'1054'}}),notRetryable=create({$transaction:async()=>{attempts++;throw invalid}});
  await assert.rejects(notRetryable.transaction(action),error=>error===invalid);assert.equal(attempts,1);
 }
});

test('concurrent first installation commits exactly one enterprise and preserves its identity and application quota',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t),appKey='single-install-fixture';
 const install=label=>db.$transaction(tx=>provisionEnterprise(tx,{username:'owner'+label,nickname:'Owner '+label,passwordHash:'fixture-verifier',permissions:['tenant:settings.read'],requestId:randomUUID()}),{isolationLevel:'Serializable'});
 const started=await Promise.allSettled([install('a'),install('b')]);
 const wins=started.filter(result=>result.status==='fulfilled');assert.equal(wins.length,1);
 const id=wins[0].value;assert.match(id,/^[a-f0-9-]{36}$/);assert.equal(await bindStandaloneEnterprise(db),id);
 const company=await db.tenant.findUniqueOrThrow({where:{standaloneSlot:1}});assert.equal(company.id,id);
 assert.equal(await db.adminAccount.count(),1,'losing installation rolls back its owner');
 assert.equal(await db.adminTenantScope.count({where:{tenantId:id,adminId:company.ownerAdminId}}),1);
 await assert.rejects(install('c'),/STANDALONE_INSTALL_TARGET_NOT_EMPTY/);
 await assert.rejects(db.tenant.create({data:{id:'another',name:'无效第二企业'}}),{code:'P2002'});
 assert.equal(await db.tenant.count(),1);assert.equal(await db.audit.count({where:{tenantId:id,action:'enterprise.bootstrap'}}),1);

 let limit=0,licensed=true;
 setApplicationDefinitions([{key:appKey,name:'Licensed test application',permissions:[],defaultConfig:()=>({retained:true}),validateConfig:v=>v}]);
 bindApplicationLicensing(db,{allowed:()=>licensed,assert:()=>{if(!licensed)throw Object.assign(Error('denied'),{code:'APPLICATION_LICENSE_UNAVAILABLE'})},limit:()=>limit});
 const apps=new TenantApplications(db),bind=()=>apps.transaction(tx=>apps.bindTenant(tx,id,appKey));
 await assert.rejects(bind(),{code:'APPLICATION_TENANT_LIMIT'});assert.equal(await db.tenantApplication.count(),0);
 limit=1;licensed=false;await assert.rejects(bind(),{code:'APPLICATION_LICENSE_UNAVAILABLE'});
 licensed=true;await bind();await bind();
 assert.equal(await db.tenantApplication.count({where:{tenantId:id,activeSlot:1}}),1);
 assert.deepEqual((await db.tenantApplication.findUniqueOrThrow({where:{tenantId_applicationKey:{tenantId:id,applicationKey:appKey}}})).config,{retained:true});
 assert.equal((await apps.assignable()).items.find(row=>row.key===appKey).used,1);
 assert.deepEqual(await db.tenant.findUniqueOrThrow({where:{id}}),company);
});
