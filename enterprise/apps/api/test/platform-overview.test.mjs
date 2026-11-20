import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {PlatformOverview} from '../src/core/platform-overview.mjs'
import {SystemLogs} from '../src/core/system-logs.mjs'
import {assertEnterpriseRequest} from '../src/core/standalone-edition.mjs'
import {isolatedDatabase} from './fixtures/isolated-database.mjs'
import {singleEnterprise} from './fixtures/single-enterprise.mjs'

test('the platform aggregation stays closed and enterprise audit views exclude historical platform and foreign records',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t)
 const {id,session}=await singleEnterprise(db,{permissions:['tenant:audit.read','tenant:audit.export']})
 const row=(scope,tenantId,action)=>({id:randomUUID(),scope,tenantId,actor:scope==='tenant'&&tenantId===id?session.id:'archived-foreign-actor',action,details:{}})
 const records=[row('tenant',id,'task.create'),row('tenant',id,'cache.clear'),row('tenant','retired-foreign','cache.clear'),row('platform',id,'tenant.edit'),row('platform','__platform__','admin.login'),row('platform',id,'tenant.impersonation.start')]
 await db.audit.createMany({data:records})
 assert.throws(()=>assertEnterpriseRequest(id,{path:'/api/v1/admin/overview',method:'GET'}),{status:404})
 await assert.rejects(new PlatformOverview(db).view(session,{ready:true}),e=>e.code==='FORBIDDEN')
 const logs=new SystemLogs(db)
 const result=await logs.list(session,{page:1,pageSize:10})
 assert.equal(result.total,2)
 assert.deepEqual(new Set(result.items.map(r=>r.id)),new Set(records.slice(0,2).map(r=>r.id)))
 await logs.detail(session,records[0].id)
 for(const record of records.slice(2))await assert.rejects(logs.detail(session,record.id),{code:'NOT_FOUND'})
 const exported=await logs.export(session,{})
 assert.equal(exported.total,2)
 assert.ok(exported.content.includes(session.id))
 assert.ok(!exported.content.includes('archived-foreign-actor'))
 assert.equal(await db.tenant.count(),1)
})
