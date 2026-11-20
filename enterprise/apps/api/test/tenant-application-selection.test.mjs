import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {TenantApplications,bindApplicationLicensing} from '../dist/applications/service.mjs'
import {setApplicationDefinitions,applications} from '../dist/applications/catalog-state.mjs'
import {assertEnterpriseRequest} from '../dist/core/standalone-edition.mjs'
import {isolatedDatabase} from './fixtures/isolated-database.mjs'
import {singleEnterprise} from './fixtures/single-enterprise.mjs'

test('one enterprise retains application history; public switching is denied and trusted lifecycle changes preserve financial gates',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t),a='selection-alpha',b='selection-beta'
 let limitB=0,licensedB=true
 const definitions=[a,b].map(key=>({
  key,name:key,permissions:['overview.read','settings.read'],overview:()=>({}),defaultConfig:()=>({initial:key}),validateConfig:v=>v,
  consoleRoutes:[{path:'/tenant/workbench',label:'工作台',group:'workbench',permission:'overview.read',icon:'i-lucide-layout-dashboard'}],
  pendingTasks:[{table:'SelectionFixtureTask',statusColumn:'state',pendingStates:['pending'],tenantIdColumn:'tenantId',applicationKeyColumn:'applicationKey'}],
 }))
 setApplicationDefinitions(definitions)
 bindApplicationLicensing(db,{allowed:key=>key!==b||licensedB,assert(key){if(key===b&&!licensedB)throw Object.assign(Error('license'),{code:'APPLICATION_LICENSE_UNAVAILABLE'})},limit:key=>key===b?limitB:null})
 const grants=['tenant:settings.read',...definitions.flatMap(app=>app.permissions.map(p=>app.key+':'+p))]
 const {id,session}=await singleEnterprise(db,{id:'preserved-enterprise-id',permissions:grants})
 const apps=new TenantApplications(db),entry=()=>apps.entry(session,{tenantId:id})
 // Only the trusted lifecycle primitive may perform the transition. No HTTP operator can change this binding.
 const bind=key=>apps.transaction(tx=>apps.selectTenant(tx,id,key))
 assert.throws(()=>assertEnterpriseRequest(id,{path:'/api/v1/admin/tenants/'+id+'/applications/'+b,method:'PUT'}),{status:404})
 assert.throws(()=>assertEnterpriseRequest(id,{path:'/api/v1/admin/tenant-entry',method:'GET',query:{tenantId:'another'}}),{status:403})
 await db.$executeRawUnsafe('CREATE TABLE SelectionFixtureTask (id VARCHAR(36) PRIMARY KEY, tenantId VARCHAR(64), applicationKey VARCHAR(64), state VARCHAR(16))')
 const expiresAt=new Date(Date.now()+600000)
 const payment=async(key,state)=>db.paymentRecord.create({data:{id:randomUUID().replaceAll('-',''),tenantId:id,applicationKey:key,orderId:randomUUID(),userId:'user',provider:'wechat',revisionId:randomUUID(),payerCipher:'fixture',amount:100,currency:'CNY',state,expiresAt}})
 const publicPayment=await payment('system','CREATED')
 await db.session.create({data:{token:'d'.repeat(64),role:'user',tenantId:id,applicationKey:'system',userId:'user',expiresAt}})
 await assert.rejects(bind(a),{code:'APPLICATION_BUSY'})
 await db.paymentRecord.update({where:{id:publicPayment.id},data:{state:'CLOSED'}})
 await bind(a)
 assert.equal(await db.session.count(),0)
 await assert.rejects(apps.available(id,'system'),{code:'APPLICATION_NOT_OPEN'})
 const where={tenantId_applicationKey:{tenantId:id,applicationKey:a}}
 const original=await db.tenantApplication.update({where,data:{config:{retained:'private-alpha'},configVersion:7}})
 await db.tenantMiniAdSetting.create({data:{tenantId:id,applicationKey:a,appId:'wx1234567890abcdef',config:{retained:true}}})
 await db.session.create({data:{token:'e'.repeat(64),role:'user',tenantId:id,applicationKey:a,userId:'user',expiresAt}})
 assert.deepEqual((await entry()).tenant.consoleRoutes.map(r=>r.applicationKey),[a])
 await assert.rejects(bind(b),{code:'APPLICATION_TENANT_LIMIT'})
 assert.deepEqual(await db.tenantApplication.findUnique({where}),original)
 assert.equal(await db.session.count(),1)
 licensedB=false;await assert.rejects(bind(b),{code:'APPLICATION_LICENSE_UNAVAILABLE'});licensedB=true

 // Historical tasks from an unbound scope must not count toward this enterprise's outstanding work.
 await db.$executeRaw`INSERT INTO SelectionFixtureTask VALUES (${randomUUID()},'historical-foreign',${a},'pending')`
 const jobId=randomUUID()
 await db.$executeRaw`INSERT INTO SelectionFixtureTask VALUES (${jobId},${id},${a},'pending')`
 await assert.rejects(bind(null),{code:'APPLICATION_BUSY'})
 await db.$executeRaw`UPDATE SelectionFixtureTask SET state='done' WHERE id=${jobId}`
 const order=await payment(a,'CREATED')
 await assert.rejects(bind(null),{code:'APPLICATION_BUSY'})
 await db.paymentRecord.update({where:{id:order.id},data:{state:'PAID'}})
 await db.paymentNotice.create({data:{id:'late-notice',paymentId:order.id,kind:'payment',payloadHash:'a'.repeat(64),payloadCipher:'fixture',state:'PENDING'}})
 await assert.rejects(bind(null),{code:'APPLICATION_BUSY'});await db.paymentNotice.update({where:{id:'late-notice'},data:{state:'DONE'}})
 await db.paymentRefund.create({data:{id:'refund',paymentId:order.id,reason:'fixture',state:'PENDING'}})
 await assert.rejects(bind(null),{code:'APPLICATION_BUSY'});await db.paymentRefund.update({where:{id:'refund'},data:{state:'SUCCESS'}})
 await bind(null)
 assert.equal(await db.session.count(),0);assert.equal(await db.adminSession.count(),1)
 const retained=await db.tenantApplication.findUnique({where})
 assert.equal(retained.activeSlot,null);assert.equal(retained.enabled,false);assert.deepEqual(retained.config,original.config);assert.equal(retained.configVersion,7)
 assert.equal(await db.tenantMiniAdSetting.count(),1);await assert.rejects(apps.available(id,a),{code:'APPLICATION_NOT_OPEN'})
 const vacant=await entry();assert.ok(vacant.tenant);assert.equal(vacant.tenant.application,null);assert.ok(!vacant.permissions.some(p=>p.startsWith(a+':')))
 await bind(a);assert.deepEqual((await db.tenantApplication.findUnique({where})).config,original.config)
 limitB=1;await bind(b)
 assert.deepEqual((await entry()).tenant.consoleRoutes.map(r=>r.applicationKey),[b])
 await assert.rejects(apps.available(id,a),{code:'APPLICATION_NOT_OPEN'})
 await assert.rejects(apps.transaction(tx=>apps.prepareAssignment(tx,id,a)),{code:'APPLICATION_BINDING_LOCKED'})
 assert.equal(await db.tenantApplication.count({where:{tenantId:id,activeSlot:1}}),1)
 assert.equal((await apps.assignable()).items.find(app=>app.key===a).used,0)
 await db.tenant.update({where:{id},data:{enabled:false}});assert.equal((await apps.assignable()).items.find(app=>app.key===b).used,1);await db.tenant.update({where:{id},data:{enabled:true}})
 applications.delete(b)
 assert.equal((await entry()).tenant.application.state,'not-installed');await bind(null)
 assert.equal(await db.paymentRecord.count({where:{tenantId:id,applicationKey:a}}),1)
 assert.equal(await db.paymentRefund.count(),1);assert.equal(await db.paymentNotice.count(),1);assert.equal(await db.tenant.count(),1)
})
