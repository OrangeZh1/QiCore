import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {fixture,hash} from './fixtures/native-release.mjs';
import {testMysqlClient,testDatabaseAccount} from './fixtures/mysql-tools.mjs';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';
import {UpdateEngine} from '../dist/lifecycle/update-engine.js';
import {extractNativeArchive} from '../dist/lifecycle/native-files.js';
import {deployFrameworkMigrations} from '../dist/lifecycle/framework-migrations.js';
import {nativeBuildMigrationSources} from '../../../scripts/native-build-target.mjs';

assert.equal(process.platform,'linux');
for(const key of ['NATIVE_BASELINE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','TEST_DATABASE_URL','TEST_RESTORE_ROOT_CONFIG'])assert.ok(process.env[key],key+' required');
const json=async path=>JSON.parse(await readFile(path,'utf8'));

test('real 0.1.2 to 0.1.5 database migration history survives the packaged 0.1.6 update',{timeout:300000},async t=>{
 const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),baseline=resolve(process.env.NATIVE_BASELINE_PACKAGE_DIR),update=resolve(process.env.NATIVE_UPDATE_PACKAGE_DIR);
 const old=await json(join(repo,'config/release-baselines/qicore-0.1.2.json')),published=await json(join(repo,'config/release-baselines/qicore-0.1.5.json')),before=await json(join(baseline,'release-manifest.json')),after=await json(join(update,'release-manifest.json')),report=await json(join(update,'package-report.json'));
 assert.equal(before.version,'0.1.5');assert.equal(after.version,'0.1.6');assert.deepEqual(after.migrations.slice(0,published.migrations.length),published.migrations);assert.equal(after.migrations.length,published.migrations.length);assert.equal(after.migrations.at(-1).id,'20261028000007_query_indexes');assert.match(old.baselineSourceRef,/^[a-f0-9]{40}$/);
 const root=await mkdtemp(join(tmpdir(),'qicore-framework-history-')),url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');const database='qicore_history_'+randomUUID().replaceAll('-','').slice(0,16);url.pathname='/'+database;
 const sql=statement=>{const result=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:statement,encoding:'utf8'});assert.equal(result.status,0,'isolated database statement failed')};
 sql('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+database+'`.* TO '+testDatabaseAccount()+';');
 const db=new PrismaClient({datasources:{db:{url:url.href}}});t.after(async()=>{await db.$disconnect();sql('DROP DATABASE `'+database+'`; REVOKE ALL PRIVILEGES ON `'+database+'`.* FROM '+testDatabaseAccount()+';');assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})});
 const payload={'server/main.mjs':'export const fixture=true'},initial=join(root,'initial-database');
 for(const file of old.prismaFiles){const result=spawnSync('git',['show',old.baselineSourceRef+':'+file.path],{cwd:repo,maxBuffer:2*1024*1024});assert.equal(result.status,0);assert.equal(result.stdout.length,file.size);assert.equal(hash(result.stdout),file.sha256);payload[file.path]=result.stdout;await mkdir(dirname(join(initial,file.path)),{recursive:true});await writeFile(join(initial,file.path),result.stdout)}
 // Only the existing verified CLI dependencies are shared. The 0.1.2 Prisma
 // tree is separate and applied to an empty disposable database, not faked rows.
 await symlink(join(baseline,'runtime/node_modules'),join(initial,'node_modules'),'dir');deployFrameworkMigrations(initial,url.href);
 const prismaHistory=()=>db.$queryRawUnsafe('SELECT id,migration_name,checksum,started_at,finished_at,rolled_back_at,applied_steps_count FROM _prisma_migrations ORDER BY migration_name,id');
 const initialHistory=await prismaHistory();assert.equal(initialHistory.length,4);
 const fixtureRoot=join(root,'state-fixture');await mkdir(fixtureRoot);const f=fixture(fixtureRoot,{frameworkKey:old.packageKey});f.state.config.migrationUrl=url.href;const source=f.release(old.packageKey,'0.1.2','0.0.0',payload);await f.install(source);
 // This check isolates the actual migration/receipt engine. Full runtime,
 // backup, drain, restart and closeout run in native-existing-upgrade.check.mjs.
 class Effects extends NativeEffects{
  constructor(release,archive,id){super(f.state,{assertOpen(){},async start(){},async stop(){},async health(){}},f.client,old.packageKey,id);this.candidateRelease=release;this.archive=archive}
  runtime(){return {platform:process.platform,arch:process.arch,node:process.versions.node}}
  assertGrant(){}
  async authorize(){const release=this.candidateRelease;this.store.write('release-'+release.artifact.manifestSha256+'.json',release);return {from:f.state.active(this.key).current,to:f.state.slot(release),planId:'isolated-migration-history',rollbackCompatible:true,migrations:release.migrations,releaseNotes:release.releaseNotes}}
  async pull(slot){this.store.write('managed.json',[...this.store.read('managed.json'),slot]);await extractNativeArchive(this.archive,f.state.path(this.key,slot),this.candidateRelease)}
  async compatibility(target){await this.validateCandidate(target)}
  async maintenance(){}
  async backup(id){return {id:'backup-'+id,sha256:'0'.repeat(64),verified:true}}
 }
 let upgradePayload={};for(const file of before.files){const bytes=await readFile(join(baseline,'runtime',file.path));assert.equal(bytes.length,file.size);assert.equal(hash(bytes),file.sha256);upgradePayload[file.path]=bytes}
 for(const {migration,sourcePath} of nativeBuildMigrationSources({fromVersion:'0.1.5',baseline:published}))upgradePayload[migration.path]=upgradePayload[sourcePath];
 const upgraded=f.release(old.packageKey,'0.1.5','0.1.2',upgradePayload,{entrypoint:before.entrypoint,migrations:published.migrations}),upgradedArchive=join(root,'upgraded-015.zip');await writeFile(upgradedArchive,upgraded.archive);upgradePayload=null;
 const firstId=randomUUID(),first=await new UpdateEngine(f.state.component(old.packageKey),new Effects(upgraded.release,upgradedArchive,firstId)).execute(firstId);assert.equal(first.status,'succeeded',JSON.stringify(first));
 const migrated=await prismaHistory();assert.equal(migrated.length,7);assert.deepEqual(migrated.filter(row=>initialHistory.some(before=>before.id===row.id)),initialHistory);
 const nativeHistory=()=>db.$queryRawUnsafe('SELECT migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',old.packageKey);
 const journal=await nativeHistory();assert.deepEqual(journal.map(row=>({id:row.migration_id,sha256:row.sha256,finished:!!row.finished})),published.migrations.map(m=>({id:m.id,sha256:m.sha256,finished:true})));
 const targetArchive=join(update,report.archive),target=f.signArchive(after,await readFile(targetArchive)),secondId=randomUUID(),second=await new UpdateEngine(f.state.component(old.packageKey),new Effects(target,targetArchive,secondId)).execute(secondId);assert.equal(second.status,'succeeded',JSON.stringify(second));
 const finalPrisma=await prismaHistory(),finalNative=await nativeHistory();assert.deepEqual(finalPrisma,migrated);assert.equal(finalPrisma.length,migrated.length);assert.equal(finalPrisma.at(-1).migration_name,'007_query_indexes');assert.equal(finalPrisma.at(-1).checksum,after.migrations.at(-1).sha256);assert.ok(finalPrisma.at(-1).finished_at);assert.deepEqual(finalNative,journal);assert.deepEqual(finalNative.map(row=>({id:row.migration_id,sha256:row.sha256,finished:!!row.finished})),after.migrations.map(m=>({id:m.id,sha256:m.sha256,finished:true})));const index=await db.$queryRawUnsafe("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Session' AND INDEX_NAME='Session_expiresAt_idx'");assert.equal(index.length,1);assert.equal(f.state.active(old.packageKey).current.version,'0.1.6');assert.equal(f.state.active(old.packageKey).previous,null);
 await writeFile(join(update,'upgraded-history-report.json'),JSON.stringify({status:'passed',baseline:'real isolated Prisma 0.1.2 then NativeEffects 0.1.5 upgrade',versions:['0.1.2','0.1.5','0.1.6'],initialPrismaMigrations:4,upgradedPrismaMigrations:finalPrisma.length,nativeMigrations:finalNative.length,historicalPrismaRowsPreserved:true,historicalNativeRowsPreserved:true,addedIndexMigration:null,preservedIndexMigration:'007_query_indexes',manuallyInsertedMigrationRows:false,fullRuntimeAndBackup:'covered separately by native-existing-upgrade.check.mjs',productionAccess:false},null,2)+'\n');
});
