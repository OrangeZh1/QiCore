import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PrismaClient} from '@prisma/client';
import {developmentDatabase} from '../../../scripts/development/database.mjs';
import {BackupArchive,migrationFingerprint} from '../dist/backups/archive.mjs';
import {BackupService} from '../dist/backups/service.mjs';
import {initializeNativeBackups} from '../dist/lifecycle/native-installation.js';
import {backupNativeDatabase} from '../dist/lifecycle/native-effects.js';
import {command} from '../../../scripts/development/processes.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),state=await mkdtemp(join(tmpdir(),'qicore-update-backup-'));
let database,db,passed=false;
try{
 database=await developmentDatabase({root,state,mysqlPort:33830,redisPort:33831,log(){}});
 db=new PrismaClient({datasources:{db:{url:database.databaseUrl}}});
 await db.$executeRawUnsafe('CREATE TABLE _qa_backup_probe (id INT PRIMARY KEY, value VARCHAR(64)) ENGINE=InnoDB');
 await db.$executeRawUnsafe("INSERT INTO _qa_backup_probe VALUES(1,'preserved-by-backup')");
 const tool=async name=>(await command(process.platform==='win32'?'where.exe':'which',[name])).trim().split(/\r?\n/)[0];
 const binary=await tool('mysqldump'),backupConfig={backupRoot:join(state,'backups'),backupKeyRoot:join(state,'backup-keys'),mysqldump:binary,runtimeUid:process.getuid?.()||1,runtimeGid:process.getgid?.()||1};initializeNativeBackups(backupConfig);const archive=new BackupArchive({root:backupConfig.backupRoot,keyRoot:backupConfig.backupKeyRoot,binary,readOnlyKey:true});
 const audit=[],service=new BackupService({audit:{upsert:async value=>audit.push(value)}},()=> '0.1.0',{url:database.databaseUrl,archive});service.init();assert.equal(service.ready,true,service.setupMessage);
 const session={id:'fixture',_admin:true,role:'root',permissions:['backups.read','backups.create'],nickname:'隔离验收'};
 const manual=await service.create(session,{requestId:randomUUID()});const record=await archive.jobs.get(manual.id);assert.equal(record.status,'completed',JSON.stringify(record));assert.equal(record.verification,'passed');
 const automated=await backupNativeDatabase({config:{backupRoot:archive.root,backupKeyRoot:archive.keyRoot,mysqldump:binary,migrationUrl:database.databaseUrl,runtimeUid:process.getuid?.()||1,runtimeGid:process.getgid?.()||1}},randomUUID(),'0.1.0');assert.equal(automated.verified,true);
 const listing=await service.list(session,{});assert.equal(listing.total,2);assert.ok(listing.items.every(item=>item.verification==='passed'));assert.equal(audit.length,1);
 const fingerprint=await migrationFingerprint(db);await db.$executeRawUnsafe('DELETE FROM _qa_backup_probe');
 await archive.importDatabase(manual.id,database.databaseUrl,await tool('mysql'),fingerprint);
 assert.equal((await db.$queryRawUnsafe('SELECT value FROM _qa_backup_probe WHERE id=1'))[0].value,'preserved-by-backup');
 await archive.verify(automated.id);await service.close();
 const report={at:new Date().toISOString(),platform:process.platform,emptyInstallInitialization:'passed',readOnlyRuntimeKey:true,manualBackup:'passed',automaticBackup:'passed',encryptedIntegrity:'passed',list:'passed',isolatedRestore:'passed',productionDatabaseAccess:false};
 if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));passed=true;
}catch(error){console.error(error);console.error('Retained isolated diagnostics: '+state);process.exitCode=1}
finally{await db?.$disconnect();await database?.close();if(passed){assert.ok(resolve(state).startsWith(resolve(tmpdir())+sep+'qicore-update-backup-'));await rm(state,{recursive:true,force:true})}}
