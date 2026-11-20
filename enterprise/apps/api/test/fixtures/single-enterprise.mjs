import {randomUUID} from 'node:crypto'
import {bindStandaloneEnterprise} from '../../src/core/standalone-edition.mjs'

// A single persisted company, real owner scope and live session in the caller's disposable DB.
export async function singleEnterprise(db,{id=randomUUID(),permissions=['tenant:settings.read']}={}){
 const ownerId=randomUUID(),roleId=randomUUID(),tokenHash=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','')
 await db.$transaction(async tx=>{
  await tx.adminRole.create({data:{id:roleId,name:'企业负责人',portal:'tenant',systemCode:'tenant-admin',permissions}})
  await tx.adminAccount.create({data:{id:ownerId,username:'qa'+ownerId.slice(0,8),nickname:'验收负责人',passwordHash:'isolated-fixture-no-login',roleId}})
  await tx.tenant.create({data:{id,name:'验收企业',ownerAdminId:ownerId}})
  await tx.adminTenantScope.create({data:{tenantId:id,adminId:ownerId}})
  await tx.adminSession.create({data:{tokenHash,csrfHash:'b'.repeat(64),adminId:ownerId,portal:'tenant',expiresAt:new Date(Date.now()+3600000)}})
 })
 await bindStandaloneEnterprise(db)
 return{id,ownerId,session:{_admin:true,role:'tenant',id:ownerId,tenantId:id,tenantIds:[id],permissions,tokenHash}}
}
