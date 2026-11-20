import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {maintenanceCatalog,maintenanceRoute,maintenanceAllows,maintenanceActor,needMaintenance,commandGrants} from '../src/core/standalone-maintenance.mjs'
import {localBackupBinding,assertBackupBinding,readBackupBinding} from '../src/backups/standalone-binding.mjs'
import {SystemCache} from '../src/core/system-cache.mjs'

const company='enterprise-one'
function staff(grants){return{_admin:true,id:'member',role:'tenant',tenantIds:[company],tenantId:company,permissions:grants}}
test('企业维护路径只接受既定动作，读权不包含导出、运行、清理、删除或恢复',()=>{
 const cases=[
  ['system-logs/export','GET','audit.export'],['environment/check','POST','environment.check'],
  ['scheduled-tasks/id/run','POST','tasks.execute'],['scheduled-tasks/id','DELETE','tasks.delete'],
  ['system-cache/clear','POST','cache.clear'],['backups/id/verify','POST','backups.verify'],
  ['backups/id/download','GET','backups.download'],['backups/restore','POST','backups.restore'],
 ]
 for(const [path,method,permission] of cases){
  assert.equal(maintenanceRoute(path.split('/'),method),permission)
  const read='tenant:'+permission.split('.')[0]+'.read'
  assert.throws(()=>needMaintenance(staff([read]),permission),{code:'FORBIDDEN'})
  assert.throws(()=>needMaintenance(staff(['tenant:'+permission]),permission),{code:'FORBIDDEN'})
  const assigned=staff([read,'tenant:'+permission]);needMaintenance(assigned,permission)
  assert.equal(maintenanceAllows({...assigned,delegated:true},permission),false)
 }
 assert.equal(maintenanceRoute(['updates','execute'],'POST'),undefined)
 assert.equal(maintenanceRoute(['tenants','other','login'],'POST'),undefined)
 assert.ok(!commandGrants(staff(['tenant:cache.read'])).includes('cache.clear'))
})
test('只有数据库登记的负责人获得初始维护授权；普通操作员受最新角色与会话限制',async()=>{
 const tenant={id:company,ownerAdminId:'owner',enabled:true},role={permissions:['tenant:cache.read'],enabled:true,tenantId:company}
 let valid=true
 const db={tenant:{findUnique:async()=>tenant},adminSession:{findFirst:async()=>valid?{}:null},adminAccount:{
  findUnique:async({where})=>({id:where.id,enabled:true,role:{enabled:true,portal:'tenant',permissions:[]},scopes:[{tenantId:company,enabled:true,permissionRoleId:'staff',permissionRole:role}]}),
 }}
 const user={...staff([]),tokenHash:'fixture'}
 await assert.rejects(maintenanceActor(db,user,'cache.clear'),{code:'FORBIDDEN'})
 role.permissions.push('tenant:cache.clear')
 const actor=await maintenanceActor(db,user,'cache.clear')
 assert.equal(actor.role,'tenant')
 assert.ok(commandGrants(actor).includes('cache.clear'))
 await assert.rejects(maintenanceActor(db,{...user,tenantId:'foreign'},'cache.clear'),{code:'FORBIDDEN'})
 valid=false;await assert.rejects(maintenanceActor(db,user,'cache.read'),{code:'UNAUTHENTICATED'});valid=true
 const owner=await maintenanceActor(db,{...user,id:'owner'},'backups.restore')
 assert.equal(owner.permissions.filter(p=>maintenanceCatalog.some(x=>x.key===p)).length,maintenanceCatalog.length)
 role.enabled=false;await assert.rejects(maintenanceActor(db,user,'cache.read'),{code:'FORBIDDEN'})
})
test('缓存清理仅操作可重建命名空间，日志属于执行人所在企业',async()=>{
 const k=[],audits=[]
 const db={audit:{create:async({data})=>audits.push(data),update:async()=>{}}}
 const redis={scan:async()=>['0',k],unlink:async(...keys)=>{assert.deepEqual(keys,[k[0]]);return 1}}
 const cache=new SystemCache(db,redis,'mysql://localhost/qc_fixture_cache')
 k.push(cache.prefix+'index','other:cache:user','consumer-session:token')
 await assert.rejects(cache.clear(staff(['tenant:cache.read'])),{code:'FORBIDDEN'})
 const result=await cache.clear(staff(['tenant:cache.read','tenant:cache.clear']))
 assert.equal(result.cleared,1);assert.equal(audits[0].tenantId,company);assert.equal(audits[0].scope,'tenant')
})
test('备份执行端核对源数据库及受认证头中的企业/实例，拒绝无归属、跨企业及同企业异实例',async()=>{
 const a=await mkdtemp(join(tmpdir(),'qicore-binding-a-')),b=await mkdtemp(join(tmpdir(),'qicore-binding-b-'))
 try{
  await writeFile(join(a,'admin-csrf.key'),Buffer.alloc(32,1));await writeFile(join(b,'admin-csrf.key'),Buffer.alloc(32,2))
  const fake={$queryRaw:async parts=>parts.join('').includes('information_schema')?[{COLUMN_NAME:'standaloneSlot'}]:[{id:company,standaloneSlot:1}]}
  const target=await readBackupBinding(fake,a)
  assertBackupBinding(target,localBackupBinding(company,a))
  for(const header of [undefined,{},localBackupBinding('another',a),localBackupBinding(company,b)])assert.throws(()=>assertBackupBinding(target,header),{code:'BACKUP_SCOPE_UNVERIFIED'})
  const broken={$queryRaw:async parts=>parts.join('').includes('information_schema')?[{}]:[{id:company,standaloneSlot:1},{id:'other',standaloneSlot:1}]}
  await assert.rejects(readBackupBinding(broken,a),{code:'BACKUP_SCOPE_UNVERIFIED'})
 }finally{await rm(a,{recursive:true,force:true});await rm(b,{recursive:true,force:true})}
})
