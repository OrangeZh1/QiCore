import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {fork} from 'node:child_process';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';
import {testMysqlClient} from './fixtures/mysql-tools.mjs';
import {assertSafeMigrationSql} from '../dist/lifecycle/migration-safety.js';
import {applicationMigrations} from '../dist/lifecycle/application-migrations.js';
import {ScheduledTasks} from '../dist/core/scheduled-tasks.mjs';
import {Wallet} from '../dist/core/wallet.mjs';
import {BackupArchive,migrationFingerprint} from '../dist/backups/archive.mjs';
import {BackupService} from '../dist/backups/service.mjs';
import {bindStandaloneEnterprise} from '../dist/core/standalone-edition.mjs';
import {Restoration} from '../dist/backups/restoration.mjs';

const integration={skip:!process.env.TEST_DATABASE_URL},hash=value=>createHash('sha256').update(value).digest('hex');
async function temporary(t){const root=await mkdtemp(join(tmpdir(),'qicore-reliability-'));t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})});return root}

test('migration tokenizer preserves literals, quoted identifiers and statement boundaries',()=>{
 const sql="-- header\nCREATE TABLE `odd;table` (`id` INT, `marker` VARCHAR(100) DEFAULT 'a/*keep*/b;--keep#', `quote` VARCHAR(100) DEFAULT 'it''s; safe', `escaped` VARCHAR(100) DEFAULT 'it\\'s; safe'); # tail\n/*comment*/ ALTER TABLE `odd;table` ADD `delete` VARCHAR(20) DEFAULT 'DROP; UPDATE';";
 const statements=assertSafeMigrationSql(sql);assert.equal(statements.length,2);
 for(const value of ["'a/*keep*/b;--keep#'","'it''s; safe'","'it\\'s; safe'"])assert.ok(statements[0].includes(value));
 assert.ok(statements[1].includes("DEFAULT 'DROP; UPDATE'"));
 for(const sql of ["CREATE TABLE T (v TEXT DEFAULT 'unfinished);",'CREATE TABLE T (id INT); /* unfinished','CREATE TABLE T(id INT); DELETE FROM Tenant;','/*!80000 DROP TABLE Tenant */','ALTER TABLE Tenant DROP COLUMN name;'])assert.throws(()=>assertSafeMigrationSql(sql),/MANUAL_UPGRADE_REQUIRED/);
 assert.equal(assertSafeMigrationSql("CREATE TABLE T(v TEXT COMMENT '/*! literal */');").length,1);
});

test('historical migration bytes match the deployed release baseline on every platform',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.3.json',import.meta.url),'utf8'));
 for(const file of baseline.prismaFiles.filter(file=>file.path.endsWith('/migration.sql'))){const bytes=await readFile(new URL('../../../'+file.path,import.meta.url));assert.equal(hash(bytes),file.sha256,file.path);assert.equal(bytes.length,file.size,file.path)}
});

test('application migration preserves defaults, replays once and stops after partial DDL failure',integration,async t=>{
 const {db,url}=await isolatedDatabase(t),root=await temporary(t);
 const sql="CREATE TABLE ReviewLiteral (id INT PRIMARY KEY, marker VARCHAR(100) DEFAULT 'a/*keep*/b;--keep#');";await writeFile(join(root,'literal.sql'),sql);
 const release={manifest:{packageKey:'review_fixture'},migrations:[{id:'20261028000000_literal',path:'literal.sql',order:1,sha256:hash(sql)}]};
 await applicationMigrations(url,release,root,true);await db.$executeRawUnsafe('INSERT INTO ReviewLiteral (id) VALUES (1)');
 assert.equal((await db.$queryRawUnsafe('SELECT marker FROM ReviewLiteral'))[0].marker,'a/*keep*/b;--keep#');
 await applicationMigrations(url,release,root,true);assert.equal((await db.$queryRawUnsafe('SELECT COUNT(*) AS total FROM _qicore_migrations'))[0].total,1n);
 const failing='CREATE TABLE ReviewPartial (id INT); CREATE TABLE ReviewPartial (id INT);';await writeFile(join(root,'failing.sql'),failing);
 release.migrations.push({id:'20261028000001_partial',path:'failing.sql',order:2,sha256:hash(failing)});
 await assert.rejects(applicationMigrations(url,release,root,true));assert.equal(Boolean((await db.$queryRawUnsafe("SELECT finished FROM _qicore_migrations WHERE migration_id='20261028000001_partial'"))[0].finished),false);
 await assert.rejects(applicationMigrations(url,release,root,true),/MIGRATION_HISTORY_MISMATCH/);
});

test('single-connection runtime supports durable scheduler claims, competing workers and request replay',integration,async t=>{
 const {db,url}=await isolatedDatabase(t),limited=new URL(url);limited.searchParams.set('connection_limit','1');limited.searchParams.set('pool_timeout','1');
 const client=new PrismaClient({datasources:{db:{url:limited.href}}}),permissions=['tasks.read','tasks.write'];
 await db.adminRole.create({data:{id:'review-role',name:'Review',portal:'admin',permissions}});
 await db.adminAccount.create({data:{id:'review-admin',username:'review-admin',nickname:'Review',passwordHash:'fixture',roleId:'review-role'}});
 await db.adminSession.create({data:{tokenHash:'a'.repeat(64),csrfHash:'b'.repeat(64),adminId:'review-admin',portal:'admin',expiresAt:new Date(Date.now()+600000)}});
 let release,entered;const gate=new Promise(r=>release=r),claimed=new Promise(r=>entered=r);let executions=0;
 const execute=async()=>{executions++;entered();await gate;return{cleared:1}},a=new ScheduledTasks(client,{},execute,{databaseUrl:limited.href}),b=new ScheduledTasks(client,{},execute,{databaseUrl:limited.href});
 t.after(async()=>{release();await a.close();await b.close();await client.$disconnect()});
 const s={id:'review-admin',_admin:true,role:'root',permissions,tokenHash:'a'.repeat(64)},input={requestId:randomUUID(),name:'Review',command:'sessions:cleanup',params:'--limit 10',rule:'0 0 * * *',enabled:true,remark:''};
 const created=await a.save(s,null,input);assert.equal((await a.save(s,null,input)).id,created.id);
 await db.scheduledTask.update({where:{id:created.id},data:{nextRunAt:new Date(0)}});
 const running=a.tick();await claimed;assert.equal((await db.scheduledTask.findUnique({where:{id:created.id}})).running,true,'claim is committed before command execution');
 assert.equal((await client.$queryRawUnsafe('SELECT 1 AS available'))[0].available,1n,'runtime pool stays available');
 await b.tick();assert.equal(executions,1);release();await running;
 assert.equal((await db.scheduledTask.findUnique({where:{id:created.id}})).lastStatus,'success');assert.equal(await db.audit.count({where:{action:'task.execute'}}),1);
 await db.scheduledTask.update({where:{id:created.id},data:{running:true}});await b.tick();assert.equal((await db.scheduledTask.findUnique({where:{id:created.id}})).lastStatus,'error');
 const lockDb=a.locks(),transaction=lockDb.$transaction.bind(lockDb);lockDb.$transaction=(fn,options)=>transaction(fn,{...options,timeout:100});a.execute=async()=>{await new Promise(r=>setTimeout(r,200));return{}};
 await db.scheduledTask.update({where:{id:created.id},data:{nextRunAt:new Date(0)}});await assert.rejects(a.tick(),{code:'P2028'});
 assert.equal((await db.$queryRawUnsafe("SELECT IS_USED_LOCK(LEFT(CONCAT('zjz:tasks:',SHA2(DATABASE(),224)),64)) AS owner"))[0].owner,null,'expired interactive transaction must not strand a session lock');
 t.diagnostic('reliability scheduler '+JSON.stringify({runtimeConnections:1,workers:2,executions,durableClaim:true,requestReplay:true,interruptedClaimRecovered:true,expiredLockConnectionReleased:true}));
});

test('encrypted shared-database backup restores app and ledger data, rejects corruption and recovers a failed import',integration,async t=>{
 const {db,url}=await isolatedDatabase(t),root=await temporary(t),wallet=new Wallet(db),scope={tenantId:'restore',applicationKey:'test-app',userId:'user'},mysql=testMysqlClient(),dump=process.env.BACKUP_MYSQLDUMP_PATH||join(dirname(mysql),process.platform==='win32'?'mysqldump.exe':'mysqldump');
 await writeFile(join(root,'admin-csrf.key'),randomBytes(32),{mode:0o600});
 await db.adminRole.create({data:{id:'restore-role',name:'企业备份恢复',portal:'tenant',permissions:['tenant:backups.read','tenant:backups.restore']}});
 await db.adminAccount.create({data:{id:'restore-admin',username:'restore-admin',nickname:'Restore',passwordHash:'fixture',roleId:'restore-role'}});
 await db.tenant.create({data:{id:scope.tenantId,name:'隔离恢复企业',ownerAdminId:'restore-admin'}});
 await db.adminTenantScope.create({data:{tenantId:scope.tenantId,adminId:'restore-admin'}});
 await bindStandaloneEnterprise(db);
 await db.$executeRawUnsafe('CREATE TABLE ReviewBusiness (id INT PRIMARY KEY, marker VARCHAR(64)) ENGINE=InnoDB');
 await db.$executeRawUnsafe("INSERT INTO ReviewBusiness VALUES(1,'before-backup')");
 const child=fork(new URL('./fixtures/database-crash-worker.mjs',import.meta.url),[],{env:{...process.env,QICORE_CRASH_TEST_URL:url},execArgv:[],windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let childError='';child.stderr.on('data',chunk=>childError+=chunk);t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')});
 const exited=new Promise(resolve=>child.once('exit',resolve));await new Promise((ok,bad)=>{child.once('message',message=>message?.written?ok():bad(Error('CRASH_PROBE_INVALID')));child.once('error',bad);child.once('exit',()=>bad(Error('CRASH_PROBE_EXITED '+childError)))});child.kill('SIGKILL');await exited;
 assert.equal(await db.walletAccount.count({where:{userId:'crash-probe'}}),0);assert.equal((await db.$queryRawUnsafe('SELECT COUNT(*) AS total FROM ReviewBusiness WHERE id=2'))[0].total,0n);
 await db.$executeRawUnsafe('CREATE TABLE _qicore_migrations (package_key VARCHAR(64), migration_id VARCHAR(128), sha256 CHAR(64), finished BOOLEAN, PRIMARY KEY(package_key,migration_id)) ENGINE=InnoDB');
 await db.$executeRawUnsafe('INSERT INTO _qicore_migrations VALUES(?,?,?,TRUE)','review_app','first','a'.repeat(64));
 const credit=(key,amount)=>wallet.apps.transaction(tx=>wallet.credit(tx,scope,'balance',{requestKey:key,kind:'gift',reference:key,amount,reason:'review',actor:'restore-admin'}));await credit('before',1000);
 const archive=new BackupArchive({root:join(root,'backups'),keyRoot:join(root,'keys'),instanceDirectory:root,binary:dump}),service=new BackupService(db,()=> '0.1.4',{url,archive});service.init();assert.equal(service.ready,true,service.setupMessage);t.after(()=>service.close());
 const backup=async()=>{const record=await archive.start({id:'backup-'+randomUUID(),source:'manual',actorId:'restore-admin',version:'0.1.4',url}).completion;assert.equal(record.status,'completed',JSON.stringify(record));assert.equal(record.verification,'passed');return record};
 const original=await backup(),fingerprint=await migrationFingerprint(db),path=archive.file(original.id,'.zbackup'),bytes=await readFile(path),corrupt=Buffer.from(bytes);corrupt[corrupt.length-20]^=1;await writeFile(path,corrupt);await assert.rejects(archive.verify(original.id),/BACKUP_VERIFY_FAILED/);await writeFile(path,bytes);await archive.verify(original.id);
 await credit('after',250);await db.$executeRawUnsafe("UPDATE ReviewBusiness SET marker='after-backup' WHERE id=1");
 const actor={id:'restore-admin',_admin:true,role:'tenant',tenantId:scope.tenantId,tenantIds:[scope.tenantId],permissions:['tenant:backups.read','tenant:backups.restore']},restore=new Restoration(service,{url,runtimeUrl:url,binary:mysql});
 const start=async()=>{const plan=await restore.preview(actor,original.id,{requestId:randomUUID()});await restore.start(actor,{token:plan.token,confirm:'确认还原数据库'});await restore.job};
 const started=performance.now();await start();assert.equal(restore.state().status,'completed');assert.equal((await wallet.summary(db,scope)).balance.amount,1000);assert.equal((await db.$queryRawUnsafe('SELECT marker FROM ReviewBusiness'))[0].marker,'before-backup');assert.equal(await migrationFingerprint(db),fingerprint);assert.equal(await db.session.count(),0);
 await credit('survive-failed-restore',400);await db.$executeRawUnsafe("UPDATE ReviewBusiness SET marker='protect-me' WHERE id=1");
 const realImport=archive.importDatabase.bind(archive);let injected=false;archive.importDatabase=async(id,...args)=>{if(id===original.id&&!injected){injected=true;await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
   try{await tx.$executeRawUnsafe('DELETE FROM Tenant')}finally{await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1')}
 });await db.$executeRawUnsafe("UPDATE ReviewBusiness SET marker='partially-imported' WHERE id=1");throw Error('BACKUP_IMPORT_FAILED')}return realImport(id,...args)};
 await start();assert.equal(restore.state().status,'rolled_back');assert.equal(restore.active,false);assert.equal((await wallet.summary(db,scope)).balance.amount,1400);assert.equal((await db.$queryRawUnsafe('SELECT marker FROM ReviewBusiness'))[0].marker,'protect-me');assert.ok(archive.protectedReason(archive.read(restore.state().protectionId)));
 const account=await wallet.account(db,scope,'balance'),lots=await db.walletLot.findMany({where:{accountId:account.id}}),entries=await db.walletEntry.findMany({where:{accountId:account.id}});assert.equal(lots.reduce((n,row)=>n+row.remaining,0n),account.amount);assert.equal(entries.reduce((n,row)=>n+row.delta,0n),account.amount);
 t.diagnostic('reliability restore '+JSON.stringify({encrypted:true,tamperRejected:true,killedProcessTransactionRolledBack:true,appAndFrameworkRestored:true,failedImportRecovered:true,finalBalance:String(account.amount),elapsedMs:Math.round(performance.now()-started),productionAccess:false}));
});
