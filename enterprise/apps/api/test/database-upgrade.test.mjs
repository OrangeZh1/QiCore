import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,symlink,realpath,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';
import {Wallet} from '../src/core/wallet.mjs';

test('deployed database lineage upgrades through 011 while retained old wallet code still reads and writes', {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const {db,url,prisma}=await isolatedDatabase(t,{migrate:false}),root=await mkdtemp(join(tmpdir(),'qicore-upgrade-review-')),api=fileURLToPath(new URL('../',import.meta.url)),repo=process.env.TEST_SOURCE_REPO||resolve(api,'../..');
 const oldApi=join(root,'apps/api'),link=join(oldApi,'node_modules');t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(link,{recursive:true,force:true});await rm(root,{recursive:true,force:true})});
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.3.json',import.meta.url),'utf8')),ref=baseline.baselineSourceRef;
 assert.match(ref,/^[a-f0-9]{40}$/);
 let source;
 if(process.env.TEST_SOURCE_ARCHIVE){
  const receipt=JSON.parse(await readFile(process.env.TEST_SOURCE_ARCHIVE+'.json','utf8'));
  assert.equal(receipt.baselineSourceRef,ref);assert.match(receipt.sha256,/^[a-f0-9]{64}$/);
  source=await readFile(process.env.TEST_SOURCE_ARCHIVE);
  assert.equal(createHash('sha256').update(source).digest('hex'),receipt.sha256,'historical source archive checksum');
 }else{
  const archive=spawnSync('git',['-c','core.autocrlf=false','archive','--format=tar',ref,'apps/api/src','apps/api/prisma','apps/api/package.json','apps/api/tsconfig.json'],{cwd:repo,maxBuffer:8*1024*1024,windowsHide:true});assert.equal(archive.status,0,archive.stderr.toString());source=archive.stdout;
 }
 await writeFile(join(root,'source.tar'),source);
 const run=(file,args,cwd=oldApi,env=process.env)=>{const r=spawnSync(file,args,{cwd,env,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout};
 run('tar',['-xf',join(root,'source.tar'),'-C',root],root);await symlink(await realpath(join(api,'node_modules')),link,process.platform==='win32'?'junction':'dir');
 for(const file of baseline.prismaFiles){const bytes=await readFile(join(root,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path)}
 run(process.execPath,[join(link,'typescript/bin/tsc'),'--noEmitOnError']);await copyFile(join(oldApi,'src/package.json'),join(oldApi,'dist/package.json'));
 const env={...process.env,DATABASE_URL:url};run(process.execPath,[join(link,'prisma/build/index.js'),'migrate','deploy','--schema',join(oldApi,'prisma/schema.prisma')],oldApi,env);
 const history=()=>db.$queryRawUnsafe('SELECT id,migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name'),before=await history();assert.equal(before.length,6);
 const {Wallet:OldWallet}=await import(pathToFileURL(join(oldApi,'dist/core/wallet.mjs')).href),oldWallet=new OldWallet(db),scope={tenantId:'upgrade-review',applicationKey:'fixture',userId:'same-user'};
 const input=(key,amount,kind='gift',reference=key)=>({requestKey:key,kind,reference,amount,reason:'upgrade review',actor:'system'});
 await db.$executeRawUnsafe('CREATE TABLE ReviewUpgradeApp (id INT PRIMARY KEY, marker VARCHAR(64)) ENGINE=InnoDB');
 await oldWallet.apps.transaction(async tx=>{await tx.$executeRawUnsafe("INSERT INTO ReviewUpgradeApp VALUES(1,'retained')");await oldWallet.credit(tx,scope,'balance',input('old-before',1000))});
 prisma(['migrate','deploy']);const after=await history();assert.equal(after.length,11);assert.deepEqual(after.slice(7).map(row=>row.migration_name),['008_standalone_enterprise','009_standalone_service_benefits','010_enterprise_maintenance_scope','011_standalone_labels']);assert.deepEqual(after.slice(0,6),before);assert.equal(after[6].migration_name,'007_query_indexes');
 await oldWallet.apps.transaction(tx=>oldWallet.credit(tx,scope,'balance',input('old-after',250)));
 const debit=await oldWallet.apps.transaction(tx=>oldWallet.debit(tx,scope,'balance',input('old-spend',100,'spend'))),current=new Wallet(db);await current.apps.transaction(tx=>current.restore(tx,scope,'balance',input('new-return',50,'return',debit.id),debit.id));
 await assert.rejects(oldWallet.apps.transaction(async tx=>{await tx.$executeRawUnsafe("UPDATE ReviewUpgradeApp SET marker='must-rollback' WHERE id=1");await oldWallet.credit(tx,scope,'balance',input('rollback',10));throw Error('ROLLBACK_PROOF')}),/ROLLBACK_PROOF/);
 assert.equal((await db.$queryRawUnsafe('SELECT marker FROM ReviewUpgradeApp'))[0].marker,'retained');assert.equal((await oldWallet.summary(db,scope)).balance.amount,1200);assert.equal((await current.summary(db,scope)).balance.amount,1200);
 prisma(['migrate','deploy']);assert.deepEqual(await history(),after);
 t.diagnostic('reliability upgrade '+JSON.stringify({baselineSourceRef:ref,baselineVersion:baseline.version,beforeMigrations:before.length,afterMigrations:after.length,historyUnchanged:true,oldCodeWritesAfterUpgrade:true,sharedTransactionRollback:true,balance:1200,frameworkCodeRollbackDoesNotRestoreDatabase:true}));
});
