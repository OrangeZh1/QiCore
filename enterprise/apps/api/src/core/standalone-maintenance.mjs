import {fail} from './errors.mjs'
import {activeTenantScope,tenantGrants} from './tenant-access.mjs'

const groups={
 audit:{read:'查看系统日志',export:'导出系统日志'},
 environment:{read:'查看运行环境',check:'执行环境检测'},
 tasks:{read:'查看计划任务',write:'配置计划任务',execute:'执行计划任务',delete:'删除计划任务'},
 cache:{read:'查看系统缓存',clear:'清理系统缓存'},
 backups:{read:'查看数据备份',create:'创建备份',verify:'校验备份',download:'下载备份',delete:'删除备份',restore:'还原数据库'},
}
export const maintenanceCatalog=Object.entries(groups).flatMap(([group,actions])=>Object.entries(actions).map(([action,label])=>({key:'tenant:'+group+'.'+action,group:'系统维护',label})))
export const maintenanceGrants=maintenanceCatalog.map(item=>item.key)
export const isMaintenanceGrant=key=>maintenanceGrants.includes(key)
export const ownerGrants=(accountId,owner,grants)=>typeof owner==='string'&&accountId===owner?[...new Set([...grants,...maintenanceGrants])]:grants
export const maintenanceAudit=s=>s.role==='tenant'?{scope:'tenant',tenantId:s.tenantId}:{scope:'platform',tenantId:'__platform__'}
const legacy={'audit.export':'audit.read','environment.read':'services.read','environment.check':'services.read','tasks.execute':'tasks.write','tasks.delete':'tasks.write','backups.verify':'backups.read'}
export function maintenanceAllows(s,key){
 if(!s?._admin||s.delegated)return false
 if(s.role==='root'){
  const perm=legacy[key]||key
  return s.permissions.includes(perm.split('.')[0]+'.read')&&s.permissions.includes(perm)
 }
 if(s.role!=='tenant'||!s.tenantId||s.tenantIds?.length!==1||s.tenantIds[0]!==s.tenantId)return false
 const group=key.split('.')[0]
 return s.permissions.includes('tenant:'+group+'.read')&&s.permissions.includes('tenant:'+key)
}
export function needMaintenance(s,key){
 if(!maintenanceAllows(s,key))fail('FORBIDDEN','没有该项系统维护权限',403)
}
export function commandGrants(s) {
 if(s.role!=='tenant')return s.permissions
 return [...s.permissions,...(maintenanceAllows(s,'cache.clear')?['cache.read','cache.clear']:[]),
  ...(maintenanceAllows(s,'environment.check')?['services.read']:[])]
}
export async function maintenanceActor(db,s,required){
 const tenant=await db.tenant.findUnique({where:{standaloneSlot:1},select:{id:true,ownerAdminId:true,enabled:true,expiresAt:true}})
 const a=await db.adminAccount.findUnique({where:{id:s.id},include:{role:true,scopes:{include:{permissionRole:true}}}})
 if(!tenant?.enabled||tenant.expiresAt&&tenant.expiresAt<=new Date()||tenant.id!==s.tenantId||!a?.enabled||a.deletedAt||!a.role.enabled||a.role.portal!=='tenant'||!a.scopes.some(x=>x.tenantId===tenant.id&&activeTenantScope(x)))fail('FORBIDDEN','维护授权已失效',403)
 if(s.tokenHash&&!await db.adminSession.findFirst({where:{adminId:a.id,tokenHash:s.tokenHash,portal:'tenant',expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','登录已失效',401)
 const actor={_admin:true,id:a.id,role:'tenant',tenantId:tenant.id,tenantIds:[tenant.id],permissions:ownerGrants(a.id,tenant.ownerAdminId,tenantGrants(a,tenant.id))}
 needMaintenance(actor,required)
 return actor
}

const routes=[
 ['system-logs','GET','audit.read'],['system-logs/export','GET','audit.export'],['system-logs/:id','GET','audit.read'],
 ['environment','GET','environment.read'],['environment/check','POST','environment.check'],
 ['system-cache','GET','cache.read'],['system-cache/clear','POST','cache.clear'],
 ['scheduled-tasks','GET','tasks.read'],['scheduled-tasks/preview','POST','tasks.read'],['scheduled-tasks/:id','GET','tasks.read'],
 ['scheduled-tasks','POST','tasks.write'],['scheduled-tasks/:id','PUT','tasks.write'],['scheduled-tasks/:id','DELETE','tasks.delete'],
 ['scheduled-tasks/:id/run','POST','tasks.execute'],
 ['backups','GET','backups.read'],['backups','POST','backups.create'],['backups/delete','POST','backups.delete'],
 ['backups/restore','POST','backups.restore'],['backups/restore/status','POST','backups.restore'],
 ['backups/:id/restore-preview','POST','backups.restore'],['backups/:id/verify','POST','backups.verify'],
 ['backups/:id/prepare-download','POST','backups.download'],['backups/:id/download','GET','backups.download'],
].map(([route,method,permission])=>({path:route.split('/'),method,permission}))
export function maintenanceRoute(path,method){
 return routes.find(r=>r.method===method&&r.path.length===path.length&&r.path.every((v,i)=>v===path[i]||v===':id'&&/^[\w-]{1,100}$/.test(path[i])))?.permission
}
