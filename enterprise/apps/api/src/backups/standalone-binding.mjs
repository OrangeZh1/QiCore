import {createHmac} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fail} from '../core/errors.mjs'

// Stored outside MySQL, this private instance key survives ordinary program upgrades.
// The archive header authenticates both the instance tag and the DB's immutable enterprise ID.
export function localBackupBinding(enterpriseId,directory=process.env.ADMIN_STATE_PATH||'../../.local'){
 if(typeof enterpriseId!=='string'||!/^[\w-]{1,64}$/.test(enterpriseId))fail('BACKUP_SCOPE_UNVERIFIED','备份归属待核验',409)
 const key=readFileSync(resolve(directory,'admin-csrf.key'))
 if(key.length!==32)fail('BACKUP_SCOPE_UNVERIFIED','实例身份不可用',409)
 return{enterpriseId,instanceTag:createHmac('sha256',key).update('qicore:standalone-backup:v1:'+enterpriseId).digest('hex')}
}
export const sameBackupBinding=(a,b)=>!!a&&!!b&&typeof a.enterpriseId==='string'&&/^[\w-]{1,64}$/.test(a.enterpriseId)&&
 typeof a.instanceTag==='string'&&/^[a-f0-9]{64}$/.test(a.instanceTag)&&a.enterpriseId===b.enterpriseId&&a.instanceTag===b.instanceTag
export function assertBackupBinding(expected,actual){
 if(!sameBackupBinding(expected,actual))fail('BACKUP_SCOPE_UNVERIFIED','备份无法确认为当前站点及实例所有，请单独核验',409)
}
export async function readBackupBinding(db,directory=process.env.ADMIN_STATE_PATH,recovering=false){
 const columns=await db.$queryRaw`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Tenant' AND COLUMN_NAME='standaloneSlot'`
 if(!columns.length){
   if(recovering){
     const tables=await db.$queryRaw`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Tenant'`
     if(tables.length)fail('BACKUP_SCOPE_UNVERIFIED','数据库站点归属待核验',409)
   }
   return null
 }
 const rows=await db.$queryRaw`SELECT id, standaloneSlot FROM Tenant LIMIT 2`
 if(recovering&&!rows.length)return null
 if(rows.length!==1||Number(rows[0].standaloneSlot)!==1)fail('BACKUP_SCOPE_UNVERIFIED','数据库站点归属待核验',409)
 return localBackupBinding(rows[0].id,directory)
}

// Stored only in the authenticated pre-restore archive header; contains no database credentials.
export async function protectionTarget(db,parsed){
 const rows=await db.$queryRaw`SHOW VARIABLES WHERE Variable_name IN ('server_uuid','server_uid')`
 const server=rows.find(row=>row.Variable_name==='server_uuid')||rows.find(row=>row.Variable_name==='server_uid')
 if(!server?.Value)fail('BACKUP_SCOPE_UNVERIFIED','无法核验数据库服务器标识',409)
 return JSON.stringify([parsed.url.hostname,parsed.url.port||'3306',parsed.database,server.Value])
}

export async function assertImportBinding(db,authenticatedHeader,planBinding=null,directory=process.env.ADMIN_STATE_PATH){
 const target=await readBackupBinding(db,directory)
 assertBackupBinding(target,authenticatedHeader)
 if(planBinding)assertBackupBinding(planBinding,target)
}
