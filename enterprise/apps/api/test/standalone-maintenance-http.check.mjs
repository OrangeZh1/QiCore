import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {PrismaClient} from '@prisma/client'
import {localBackupBinding,assertImportBinding} from '../dist/backups/standalone-binding.mjs'

const api=new URL(process.env.QA_API_ORIGIN),origin=new URL(process.env.QA_ADMIN_ORIGIN),target=new URL(process.env.DATABASE_URL)
if(process.env.QA_DISPOSABLE!=='1'||![api,origin,target].every(u=>['localhost','127.0.0.1','[::1]'].includes(u.hostname))||!/^\/(qc_fixture_|qicore_qa_)[\w]+$/.test(target.pathname))throw Error('需要回环隔离验收实例')
const db=new PrismaClient(),ownerCredentials=JSON.parse(await readFile(process.env.QA_OWNER_CREDENTIALS,'utf8'))
let owner,staff
async function request(path,method='GET',actor=owner,body,status=200){
 const r=await fetch(api.origin+'/api/v1/admin/'+path,{method,headers:{origin:origin.origin,'x-console-portal':'tenant',
  ...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
 const json=await r.json();assert.equal(r.status,status,method+' '+path+' '+(json.error?.code||''));return{data:json.data,response:r}
}
async function login({username,password}){
 const {response,data}=await request('auth/login','POST',null,{username,password,portal:'tenant'})
 return{cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).find(v=>v.startsWith('qicore_enterprise_session=')),csrf:data.csrfToken,id:data.id}
}
try{
 owner=await login(ownerCredentials)
 const tenant=await db.tenant.findUniqueOrThrow({where:{standaloneSlot:1}})
 assert.equal(owner.id,tenant.ownerAdminId)
 const fresh=await db.adminSession.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(owner.cookie.split('=')[1]).digest('hex')}})
 assert.equal(fresh.adminId,owner.id)
 const base='tenants/'+tenant.id+'/',unique=randomUUID().slice(0,8)
 const permissions=['tenant:audit.read','tenant:environment.read','tenant:cache.read','tenant:backups.read','tenant:tasks.read','tenant:accounts.read','tenant:accounts.write','tenant:roles.read','tenant:roles.write']
 const {data:listing}=await request(base+'roles?page=1&pageSize=20')
 assert.ok(listing.catalog.find(p=>p.key==='tenant:backups.restore')?.grantable)
 const {data:role}=await request(base+'roles','POST',owner,{name:'维护验收-'+unique,permissions,enabled:true,requestId:randomUUID()})
 const credentials={username:'qaops'+unique,password:randomBytes(18).toString('hex')}
 await request(base+'administrators','POST',owner,{...credentials,nickname:'隔离维护人员',enabled:true,roleId:role.id,phone:'',allowMultipleSessions:true,requestId:randomUUID()})
 staff=await login(credentials)
 for(const path of ['system-logs?page=1&pageSize=10','environment','scheduled-tasks?page=1&pageSize=10','system-cache','backups?page=1&pageSize=10'])await request(path,'GET',staff)
 await request('system-logs/export','GET',staff,undefined,403)
 await request('environment/check','POST',staff,{target:'database'},403)
 await request('system-cache/clear','POST',staff,{},403)
 await request('backups/restore','POST',staff,{confirm:'验收拒绝',token:'invalid'},403)
 const schedule={name:'隔离只读检测 '+unique,command:'system:check',params:'',rule:'0 0 1 1 *',enabled:false,remark:'',requestId:randomUUID()}
 await request('scheduled-tasks','POST',staff,schedule,403)

 const delegated=[...permissions,'tenant:environment.check','tenant:tasks.write','tenant:tasks.execute','tenant:tasks.delete']
 const {data:updated}=await request(base+'roles/'+role.id,'PUT',owner,{name:role.name,permissions:delegated,enabled:true,version:role.version})
 await request('environment','GET',staff,undefined,401)
 staff=await login(credentials)
 const {data:catalog}=await request(base+'roles?page=1&pageSize=20','GET',staff)
 assert.equal(catalog.catalog.find(p=>p.key==='tenant:tasks.execute').grantable,false)
 await request(base+'roles','POST',staff,{name:'非法转授-'+unique,permissions:['tenant:tasks.read','tenant:tasks.execute'],enabled:true,requestId:randomUUID()},403)
 await request(base+'administrators','POST',staff,{...credentials,username:'qaforbid'+unique,nickname:'不可创建',enabled:true,roleId:role.id,phone:'',allowMultipleSessions:true,requestId:randomUUID()},403)
 await request('environment/check','POST',staff,{target:'database'})
 const {data:task}=await request('scheduled-tasks','POST',staff,schedule)
 assert.equal(task.enterpriseId,tenant.id)
 await request('scheduled-tasks/'+task.id+'/run','POST',staff,{version:task.version})
 const {data:done}=await request('scheduled-tasks/'+task.id,'GET',staff)
 assert.equal(done.lastStatus,'success')
 await request('scheduled-tasks/'+task.id+'/run','POST',staff,{version:task.version},409)
 await request('scheduled-tasks/'+task.id,'DELETE',staff,{version:done.version})
 assert.ok(await db.audit.count({where:{tenantId:tenant.id,scope:'tenant',actor:staff.id,action:'task.execute'}}))
 await request(base+'roles/'+role.id,'PUT',owner,{name:role.name,permissions:[],enabled:true,version:updated.version})
 await request('environment','GET',staff,undefined,401)
 staff=await login(credentials);await request('environment','GET',staff,undefined,403)

 // Exercise the importer's identity gate against the actual disposable DB. No importer is launched.
 const bound=localBackupBinding(tenant.id)
 await assertImportBinding(db,bound,bound)
 for(const untrusted of [null,{...bound,enterpriseId:'foreign'},{...bound,instanceTag:'0'.repeat(64)}]){
  await assert.rejects(assertImportBinding(db,untrusted,bound),{code:'BACKUP_SCOPE_UNVERIFIED'})
 }
 console.log('PASS 企业维护授权授予、撤销、禁止转授、只读及分项操作、真实只读计划任务，以及恢复执行端的企业/实例匹配')
}finally{
 if(staff)await request('auth/logout','POST',staff,{}).catch(()=>{})
 if(owner)await request('auth/logout','POST',owner,{}).catch(()=>{})
 await db.$disconnect()
}
