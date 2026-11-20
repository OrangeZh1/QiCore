// Offline recovery only. Stop the API and updater before running this command.
import {existsSync} from 'node:fs';
import {hostname} from 'node:os';
import {PrismaClient} from '@prisma/client';
import {BackupService} from './service.mjs';
import {Restoration} from './restoration.mjs';
import {migrationFingerprint} from './archive.mjs';
const db=new PrismaClient();
try{
 if(process.argv.slice(2).join(' ')!=='--confirm-restore-protection')throw Error('CONFIRMATION_REQUIRED');
 const backups=new BackupService(db,()=>'' );backups.init();if(!backups.ready)throw Error('BACKUP_UNAVAILABLE');
 const restoration=new Restoration(backups),state=restoration.state(),owner=backups.archive.operation();
 if(!state||!['running','recovery_required'].includes(state.status)||owner?.kind!=='restore'||owner.taskId!==state.id||owner.host!==hostname())throw Error('RECOVERY_OWNER_MISMATCH');
 let running=true;try{process.kill(owner.pid,0)}catch(e){if(e.code==='ESRCH')running=false}if(running)throw Error('STOP_OWNER_PROCESS_FIRST');
 if(owner.childPid){try{process.kill(owner.childPid,0);throw Error('STOP_IMPORT_PROCESS_FIRST')}catch(e){if(e.code!=='ESRCH')throw e}}
 if(existsSync(backups.archive.store.path('backup.lock')))throw Error('BACKUP_PROCESS_OR_CLEANUP_PENDING');
 await restoration.config();
 // recorded import intent is durable before the first SQL byte is written.
 if(state.importStarted){
   if(!state.protectionId)throw Error('PROTECTION_BACKUP_MISSING');
   backups.archive.cleanupImportWork(state.backupId);backups.archive.cleanupImportWork(state.protectionId);
   await backups.archive.importDatabase(state.protectionId,restoration.url,restoration.binary,state.migrationHash,state.binding,state.id);
   await db.$connect();if(await migrationFingerprint(db)!==state.migrationHash)throw Error('RESTORED_SCHEMA_MISMATCH');
   await restoration.purgeAndAudit(state,'backup.restore.recovery');state.status='rolled_back';state.message='已通过离线恢复回到还原前数据，请重启服务并重新登录';
 }else{state.status='failed';state.message='中断发生在数据库导入前，现有数据未覆盖，请重启服务'}
 state.stage=state.status;state.finishedAt=new Date().toISOString();restoration.save(state);backups.archive.releaseOperation('restore',state.id);console.log(state.message);
}catch(e){console.error('恢复未完成：'+(/^[A-Z_]+$/.test(e.message)?e.message:'RECOVERY_FAILED')+'。保留恢复记录和备份，请勿直接清除维护锁。');process.exitCode=1}finally{await db.$disconnect()}
