import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {historicalBytes} from './fixtures/historical-source.mjs';
import {fixture,hash} from './fixtures/native-release.mjs';
import {nativeArchiveFromCatalog} from '../dist/license/native-release.js';
import {nativeBuildOptions,assertNativeBuildTarget,nativeBuildBaseline,nativeBuildMigrationSources,materializeNativeBuildMigrations} from '../../../scripts/native-build-target.mjs';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';
import {frameworkMigrationSources} from '../dist/lifecycle/framework-migrations.js';
import {assertSafeMigrationSql} from '../dist/lifecycle/migration-safety.js';
import {prepareNativeCandidate,prepareNativeUpdateCandidate,releaseFromPublished} from '../../../scripts/customer-delivery.mjs';

function historicalPrismaFile(baseline,path){
 const expected=baseline.prismaFiles.find(file=>file.path===path);assert.ok(expected);assert.match(baseline.baselineSourceRef,/^[a-f0-9]{40}$/);
 const bytes=historicalBytes(path,expected.sha256);
 assert.equal(bytes.length,expected.size);assert.equal(hash(bytes),expected.sha256);return bytes;
}

test('online build binds a newer explicit source version to the same product and unchanged Prisma tree',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-update-build-'));t.after(()=>rm(root,{recursive:true,force:true}));const f=fixture(root);
 const schema={'server/main.mjs':'runtime','apps/api/prisma/schema.prisma':'datasource fixture','apps/api/prisma/migrations/001/migration.sql':'CREATE TABLE fixture(id INT);'};
 const before=nativeArchiveFromCatalog(f.release('frm_fixture','0.1.0','0.0.0',schema).release.manifest),input={packageKey:'frm_fixture',targetVersion:'0.1.1',fromVersion:'0.1.0',files:before.files,baseline:before};
 assert.doesNotThrow(()=>assertNativeBuildTarget(input));assert.doesNotThrow(()=>assertNativeBuildTarget({...input,targetVersion:'0.1.2'}));assert.throws(()=>assertNativeBuildTarget({...input,targetVersion:'0.1.0'}),/UPDATE_VERSION_NOT_NEWER/);assert.throws(()=>assertNativeBuildTarget({...input,baseline:undefined}),/UPDATE_BASELINE_REQUIRED/);
 assert.throws(()=>assertNativeBuildTarget({...input,baseline:{...before,version:'0.0.9'}}),/UPDATE_BASELINE_MISMATCH/);
 const changed=structuredClone(input);changed.files=changed.files.map(file=>file.path.endsWith('schema.prisma')?{...file,sha256:'a'.repeat(64)}:file);assert.throws(()=>assertNativeBuildTarget(changed),/UPDATE_DATABASE_PLAN_REQUIRED/);
 assert.deepEqual(nativeBuildOptions(['/tmp/out','--from-version','0.1.0','--baseline-manifest','/tmp/before.json']),{output:'/tmp/out',options:{fromVersion:'0.1.0',baselineManifest:'/tmp/before.json'}});
 for(const args of [['/tmp/out','--from-version','0.1.0'],['/tmp/out','--unknown','yes'],['/tmp/out','--from-version','0.0.0','--from-version','0.0.0']])assert.throws(()=>nativeBuildOptions(args));
});
test('online preparation emits exact ordinary upload fields without impersonating a first install or publication',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-update-prepare-'));t.after(()=>rm(root,{recursive:true,force:true}));const f=fixture(join(root,'fixture'),{frameworkKey:'frm_cdm43f43e7yhk5jd'});
 const product=f.product,candidate=f.release(product.appKey,'0.1.1','0.1.0');
 const input={archive:join(root,'runtime.zip'),manifest:join(root,'manifest.json'),product:join(root,'product.json'),releaseNotes:'修复：在线更新维护与数据库备份',output:join(root,'signed-update.json')};
 for(const [path,bytes] of [[input.archive,candidate.archive],[input.manifest,JSON.stringify(nativeArchiveFromCatalog(candidate.release.manifest))],[input.product,JSON.stringify(product)]])await writeFile(path,bytes);
 await assert.rejects(prepareNativeCandidate(input),/INITIAL_FRAMEWORK_RELEASE_REQUIRED/);
 assert.equal((await prepareNativeUpdateCandidate(input)).published,false);const value=JSON.parse(await readFile(input.output,'utf8'));assert.equal(value.initialRelease,undefined);assert.equal(value.localRelease.artifact.fromVersion,'0.1.0');assert.equal(value.sha256,hash(candidate.archive));assert.doesNotMatch(JSON.stringify(value),/PRIVATE KEY|publishedAt|releaseId|downloadUrl/);
 const row={id:'test_published_update',status:'PUBLISHED',channel:'STABLE',deliveryKind:'ARCHIVE',publishedAt:new Date().toISOString(),component:{packageKey:product.appKey},version:'0.1.1',artifactSha256:value.sha256,artifactSize:value.size,signature:JSON.stringify(value.localRelease.artifact.integrity),signatureKeyId:'',manifest:JSON.parse(value.fields.manifest),releaseNotes:value.fields.releaseNotes};assert.equal(releaseFromPublished(row,product).artifact.fromVersion,'0.1.0');
});

test('schema changes require the exact reviewed additive SQL plan and preserve baseline migrations',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.2.json',import.meta.url),'utf8'));
 const plan=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.3-database-plan.json',import.meta.url),'utf8'));
 const files=baseline.prismaFiles.filter(file=>!file.path.endsWith('/schema.prisma')),migrations=[];
 const targetBaseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.3.json',import.meta.url),'utf8')),schema=historicalPrismaFile(targetBaseline,'apps/api/prisma/schema.prisma');files.push({path:'apps/api/prisma/schema.prisma',size:schema.length,sha256:hash(schema)});
 for(const [order,m] of plan.migrations.entries()){
  const sql=await readFile(new URL('../../../'+m.sourcePath,import.meta.url));assert.equal(hash(sql),m.sha256);assertSafeMigrationSql(sql.toString());
  files.push({path:m.sourcePath,size:sql.length,sha256:m.sha256},{path:'migrations/'+m.id+'.sql',size:sql.length,sha256:m.sha256});migrations.push({id:m.id,path:'migrations/'+m.id+'.sql',sha256:m.sha256,order,kind:'database',transactional:false,reversible:true});
 }
 const input={packageKey:plan.packageKey,fromVersion:plan.fromVersion,targetVersion:plan.version,baseline,files,migrations,databasePlan:plan};assert.doesNotThrow(()=>assertNativeBuildTarget(input));
 const current=await readFile(new URL('../prisma/schema.prisma',import.meta.url));if(hash(current)!==plan.afterSchemaSha256)assert.throws(()=>assertNativeBuildTarget({...input,files:files.map(file=>file.path.endsWith('/schema.prisma')?{...file,size:current.length,sha256:hash(current)}:file)}),/UPDATE_DATABASE_PLAN_REQUIRED/,'new schema changes cannot reuse a historical release plan');
 assert.equal(frameworkMigrationSources(files,files,migrations).length,2,'a first-installed database can synchronize already-applied Prisma migrations into the native journal without rerunning DDL');
 assert.throws(()=>assertNativeBuildTarget({...input,databasePlan:undefined}),/UPDATE_DATABASE_PLAN_REQUIRED/);
 assert.throws(()=>assertNativeBuildTarget({...input,migrations:migrations.slice(1)}),/FRAMEWORK_MIGRATION_NOT_BOUND/);
 const changed=structuredClone(files);changed.find(file=>file.path.includes('/001_framework_initial/')).sha256='0'.repeat(64);
 assert.throws(()=>frameworkMigrationSources(baseline.prismaFiles,changed,migrations),/FRAMEWORK_MIGRATION_HISTORY_CHANGED/);
 for(const sql of ['DELETE FROM Tenant;','UPDATE Tenant SET name="x";','CREATE TABLE X (id INT); DELETE FROM Tenant;'])assert.throws(()=>assertSafeMigrationSql(sql),/MANUAL_UPGRADE_REQUIRED/);
});

async function deployedHistory(){
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.3.json',import.meta.url),'utf8'));
 const databasePlan=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.4-database-plan.json',import.meta.url),'utf8'));
 assert.equal(baseline.releaseManifestSha256,'d5055a0c090afc6e0d1ee1e22a12810103088babd804e0ca3551bb7e71b4a4f2');
 assert.deepEqual(baseline.migrations.map(m=>[m.id,m.order,m.sha256]),[['20261026000005_site_storage',0,'e05cd0971ad4369d0d2cc52a7759e7fa5c06479ee21e2e9438f46892538b8a8f'],['20261026000006_stored_images',1,'998bbaa2b98fb306b42aa513544bba2cb966374d52883caed9165786e6583fb3']]);
 // Historical release tests read verified historical bytes, never the evolving
 // working schema. Current migrations retain their separate checksum regression.
 const bytes=Object.fromEntries(baseline.prismaFiles.map(file=>[file.path,historicalPrismaFile(baseline,file.path)]));
 return {baseline,databasePlan,bytes};
}
test('an upgraded 0.1.3 baseline keeps exact native migration history and bytes without a new schema plan',async t=>{
 const {baseline,databasePlan,bytes}=await deployedHistory(),before=nativeBuildBaseline(baseline),options={fromVersion:'0.1.3',baseline,databasePlan};
 const root=await mkdtemp(join(tmpdir(),'qicore-migration-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [path,content] of Object.entries(bytes)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),content)}
 const migrations=await materializeNativeBuildMigrations(root,options);assert.deepEqual(migrations,baseline.migrations);
 for(const {migration,sourcePath} of nativeBuildMigrationSources(options))assert.deepEqual(await readFile(join(root,migration.path)),bytes[sourcePath]);
 const input={packageKey:baseline.packageKey,targetVersion:'0.1.4',fromVersion:'0.1.3',baseline,databasePlan,files:before.files,migrations};
 assert.doesNotThrow(()=>assertNativeBuildTarget(input));
 assert.throws(()=>assertNativeBuildTarget({...input,files:baseline.prismaFiles,migrations:[]}),/UPDATE_MIGRATION_HISTORY_CHANGED/,'the formerly shipped empty-history candidate must fail during packaging');
 for(const changes of [{order:9},{sha256:'0'.repeat(64)},{path:'migrations/changed.sql'},{transactional:true}])assert.throws(()=>assertNativeBuildTarget({...input,migrations:[{...migrations[0],...changes},migrations[1]]}),/UPDATE_MIGRATION_HISTORY_CHANGED/);
 assert.throws(()=>assertNativeBuildTarget({...input,files:before.files.filter(f=>f.path!==migrations[0].path)}),/UPDATE_MIGRATION_HISTORY_CHANGED/);
 const next={id:'20261028000007_fixture',sourcePath:'apps/api/prisma/migrations/007_fixture/migration.sql',sha256:'a'.repeat(64)},planned=nativeBuildMigrationSources({...options,databasePlan:{...databasePlan,migrations:[next]}});
 assert.equal(planned.at(-1).migration.order,2);assert.deepEqual(planned.slice(0,2).map(row=>row.migration),baseline.migrations);
 assert.throws(()=>nativeBuildMigrationSources({...options,databasePlan:{...databasePlan,migrations:[{...next,id:migrations[0].id}]}}),/UPDATE_DATABASE_PLAN_MISMATCH/);
 await writeFile(join(root,migrations[0].path),'changed');await assert.rejects(materializeNativeBuildMigrations(root,options),/UPDATE_MIGRATION_HISTORY_CHANGED/);
});

test('runtime rejects dropped history from a genuinely upgrade-shaped 0.1.3 receipt and executes no historical SQL for 0.1.4',async t=>{
 const {baseline,bytes}=await deployedHistory(),root=await mkdtemp(join(tmpdir(),'qicore-upgraded-baseline-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:baseline.packageKey}),payload={'server/main.mjs':'export const ready=true',...bytes};
 for(const {migration,sourcePath} of nativeBuildMigrationSources({fromVersion:'0.1.3',baseline}))payload[migration.path]=bytes[sourcePath];
 const before=f.release(baseline.packageKey,'0.1.3','0.1.2',payload,{migrations:baseline.migrations}),from=await f.install(before);
 assert.equal(before.release.artifact.fromVersion,'0.1.2');assert.deepEqual(before.release.migrations,baseline.migrations);
 async function stage(value){const slot=f.state.slot(value.release),store=f.state.component(baseline.packageKey);store.write('release-'+value.release.artifact.manifestSha256+'.json',value.release);const path=f.state.path(baseline.packageKey,slot);await mkdir(path,{recursive:true});for(const [name,data] of Object.entries(value.files)){await mkdir(dirname(join(path,name)),{recursive:true});await writeFile(join(path,name),data)}return slot}
 let databaseCalls=0;
 class Probe extends NativeEffects{runtime(){return{platform:'linux',arch:'x64',node:'24.0.0'}}assertGrant(){}database(){databaseCalls++;return{$queryRawUnsafe:async sql=>sql.includes('information_schema')?[{TABLE_NAME:'_qicore_migrations'}]:baseline.migrations.map(m=>({migration_id:m.id,sha256:m.sha256,finished:true})),$executeRawUnsafe:async()=>{throw Error('HISTORICAL_SQL_EXECUTED')},$disconnect:async()=>{}}}}
 const effects=new Probe(f.state,{assertOpen(){}},f.client,baseline.packageKey,'history-regression-task');
 const broken=f.release(baseline.packageKey,'0.1.4','0.1.3',{'server/main.mjs':'export const ready=true',...bytes});
 await assert.rejects(effects.validateCandidate({from,to:await stage(broken)}),/MIGRATION_HISTORY_CHANGED/);assert.equal(databaseCalls,0);
 const corrected=f.release(baseline.packageKey,'0.1.4','0.1.3',payload,{migrations:baseline.migrations}),target={from,to:await stage(corrected)};
 await effects.validateCandidate(target);assert.equal(databaseCalls,1);databaseCalls=0;await effects.migrate(target);assert.equal(databaseCalls,0,'no new ID means no database or DDL execution');
});


test('0.1.5 binds additive query indexes while preserving the complete deployed migration history',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.4.json',import.meta.url),'utf8'));
 const databasePlan=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.5-database-plan.json',import.meta.url),'utf8'));
 const target=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.5.json',import.meta.url),'utf8'));
 const files=[];
 for(const old of baseline.prismaFiles){const bytes=historicalPrismaFile(target,old.path);if(!old.path.endsWith('/schema.prisma'))assert.equal(hash(bytes),old.sha256,old.path);files.push({path:old.path,size:bytes.length,sha256:hash(bytes)})}
 const added=databasePlan.migrations[0],bytes=await readFile(new URL('../../../'+added.sourcePath,import.meta.url));assert.equal(added.id,'20261028000007_query_indexes');assert.equal(hash(bytes),added.sha256);assert.equal(assertSafeMigrationSql(bytes.toString()).length,11);files.push({path:added.sourcePath,size:bytes.length,sha256:hash(bytes)});
 const migrations=nativeBuildMigrationSources({fromVersion:'0.1.4',baseline,databasePlan}).map(({migration,sourcePath})=>{const source=files.find(file=>file.path===sourcePath);files.push({...source,path:migration.path});return migration});
 assert.deepEqual(migrations.slice(0,2),baseline.migrations);assert.equal(migrations[2].order,2);
 const input={packageKey:baseline.packageKey,targetVersion:'0.1.5',fromVersion:'0.1.4',baseline,files,migrations,databasePlan};assert.doesNotThrow(()=>assertNativeBuildTarget(input));assert.throws(()=>assertNativeBuildTarget({...input,databasePlan:{...databasePlan,migrations:[]}}),/UPDATE_DATABASE_PLAN_MISMATCH/);
});

test('0.1.6 preserves the complete published 0.1.5 database history without a new migration plan',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.5.json',import.meta.url),'utf8')),files=[];
 for(const old of baseline.prismaFiles){const bytes=historicalPrismaFile(baseline,old.path);assert.equal(hash(bytes),old.sha256,old.path);assert.equal(bytes.length,old.size);files.push({...old})}
 const migrations=nativeBuildMigrationSources({fromVersion:'0.1.5',baseline}).map(({migration,sourcePath})=>{const source=files.find(file=>file.path===sourcePath);files.push({...source,path:migration.path});return migration});
 assert.deepEqual(migrations,baseline.migrations);assert.equal(migrations.length,3);
 const input={packageKey:baseline.packageKey,targetVersion:'0.1.6',fromVersion:'0.1.5',baseline,files,migrations};
 assert.doesNotThrow(()=>assertNativeBuildTarget(input));assert.throws(()=>assertNativeBuildTarget({...input,migrations:migrations.slice(0,-1)}),/UPDATE_MIGRATION_HISTORY_CHANGED/);
});

test('0.1.7 binds the published 0.1.6 Prisma bytes and cumulative migration history',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.6.json',import.meta.url),'utf8')),files=[];
 for(const old of baseline.prismaFiles){const bytes=historicalPrismaFile(baseline,old.path);assert.equal(hash(bytes),old.sha256,old.path);assert.equal(bytes.length,old.size);files.push({...old})}
 const migrations=nativeBuildMigrationSources({fromVersion:'0.1.6',baseline}).map(({migration,sourcePath})=>{files.push({...files.find(file=>file.path===sourcePath),path:migration.path});return migration});
 assert.deepEqual(migrations,baseline.migrations);assert.equal(migrations.length,3);
 const input={packageKey:baseline.packageKey,targetVersion:'0.1.7',fromVersion:'0.1.6',baseline,files,migrations};
 assert.doesNotThrow(()=>assertNativeBuildTarget(input));assert.throws(()=>assertNativeBuildTarget({...input,migrations:migrations.slice(0,-1)}),/UPDATE_MIGRATION_HISTORY_CHANGED/);
});
