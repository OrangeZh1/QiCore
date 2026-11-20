import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,statSync,chmodSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeApplicationLifecycle} from '../dist/lifecycle/native-applications.js';
import {BackupArchive} from '../dist/backups/archive.mjs';
import {fixture} from './fixtures/native-release.mjs';

async function setup(t){
 const root=mkdtempSync(join(tmpdir(),'qicore-app-lifecycle-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});const f=fixture(root);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 new BackupArchive({root:f.state.config.backupRoot,keyRoot:f.state.config.backupKeyRoot}).init();mkdirSync(f.state.config.dataRoot);writeFileSync(join(f.state.config.dataRoot,'retained.txt'),'customer data');
 const descriptor={format:'qicore-application-v1',key:'fixture',packageKey:'app_fixture',version:'1.0.0',name:'Fixture',pendingTasks:[]};
 let archive=f.release('app_fixture','1.0.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify(descriptor)});const calls={downloads:0,migrations:0,starts:0,stops:0,backups:0};
 f.client.machine=async(path,body)=>{
  if(path.endsWith('/access'))return {accessToken:'fixture_token.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.equal(path,'updates/lifecycle/plan');const now=Date.now();return {signedPlan:f.envelope({protocol:'license-api-v2',capability:'native-lifecycle-v1',operation:body.operation,key_id:'receipt',planId:'plan_fixture',licenseId:'license-test',licenseRevision:f.client.status().receipt.revision,instanceId:f.client.identity().instanceId,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+60000).toISOString(),productId:'frm_fixture',domain:'127.0.0.1',packageKey:body.packageKey,installed:body.installed,release:archive.release})};
 };
 f.client.transport=async()=>{calls.downloads++;return new Response(archive.archive,{headers:{'content-length':String(archive.archive.length)}})};
 let running=true;const host={stop:async()=>{calls.stops++;running=false},start:async()=>{calls.starts++;running=true},running:()=>running,health:async()=>{}};
 class Harness extends NativeApplicationLifecycle{runtime(){return {platform:'linux',arch:'x64',node:'24.0.0'}}async migrations(_r,_p,execute){if(execute)calls.migrations++}async backup(id){calls.backups++;return {id:'backup-'+id,sha256:'a'.repeat(64),verified:true}}async impact(){return{tenants:2,pending:0,descriptor}}}
 const engine=new Harness(f.state,host,f.client),request=operation=>({requestId:randomUUID(),packageKey:'app_fixture',operation,targetVersion:'1.0.0',manifestSha256:archive.release.artifact.manifestSha256});
 return {...f,root,engine,host,calls,archive,request,descriptor,serveArchive(next){archive=next}};
}

test('signed application installation, exact repair, expired-license uninstall and reinstall retain data and request identity',async t=>{
 const f=await setup(t),install=f.request('install');
 const other=f.release('app_other','1.3.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify({...f.descriptor,key:'other-app',packageKey:'app_other',version:'1.3.0'})});await f.install(other);
 const otherBefore=structuredClone(f.state.active('app_other')),otherCode=join(f.state.path('app_other',otherBefore.current),'server/main.mjs');
 const result=await f.engine.execute(install.requestId,install);assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(f.state.active('app_fixture').current.version,'1.0.0');assert.equal(f.calls.migrations,1);assert.equal(f.calls.downloads,1);
 await f.engine.execute(install.requestId,install);assert.equal(f.calls.downloads,1);await assert.rejects(f.engine.execute(install.requestId,{...install,manifestSha256:'b'.repeat(64)}),/REQUEST_ID_REUSED/);
 const path=f.state.path('app_fixture',f.state.active('app_fixture').current);writeFileSync(join(path,'server/main.mjs'),'local changes');const preview=await f.engine.preview('app_fixture','repair');assert.equal(preview.integrity[0].kind,'modified');
 const repair=f.request('repair'),repaired=await f.engine.execute(repair.requestId,repair);assert.equal(repaired.status,'succeeded',JSON.stringify(repaired));assert.equal(f.calls.migrations,1);assert.equal(f.calls.backups,1);assert.equal(existsSync(join(f.state.component('app_fixture').root,'repair-evidence-'+repair.requestId)),false);assert.equal(f.state.component('app_fixture').read('recovery-archive-'+repair.requestId+'.json').status,'removed');
 const componentStatus=f.client.componentStatus;f.client.componentStatus=()=>{throw Error('expired')};const uninstall=f.request('uninstall'),removed=await f.engine.execute(uninstall.requestId,uninstall);assert.equal(removed.status,'succeeded',JSON.stringify(removed));assert.equal(f.state.active('app_fixture'),null);assert.equal(existsSync(f.state.directory('app_fixture')),false);assert.equal(f.calls.migrations,1);f.client.componentStatus=componentStatus;
 const reinstall=f.request('install');assert.equal((await f.engine.execute(reinstall.requestId,reinstall)).status,'succeeded');assert.equal(readFileSync(join(f.state.config.dataRoot,'retained.txt'),'utf8'),'customer data');
 assert.deepEqual(f.state.active('app_other'),otherBefore);assert.equal(readFileSync(otherCode,'utf8'),'export const healthy=true;');
});

test('strict controller umask keeps application code readable and private state restricted',async t=>{
 if(process.platform==='win32'){t.skip('POSIX permission check runs on Linux');return}
 const f=await setup(t);chmodSync(f.root,0o755);chmodSync(f.state.config.root,0o755);const input=f.request('install'),previousMask=process.umask(0o077);
 let result;try{result=await f.engine.execute(input.requestId,input)}finally{process.umask(previousMask)}
 assert.equal(result.status,'succeeded',JSON.stringify(result));const dir=f.state.directory('app_fixture');assert.equal(statSync(dir).mode&0o777,0o755);assert.equal(statSync(join(dir,'releases')).mode&0o777,0o755);
 assert.equal(statSync(f.state.component('app_fixture').root).mode&0o777,0o700);assert.equal(statSync(join(dir,'current.json')).mode&0o777,0o600);
 if(process.getuid?.()===0&&process.env.QICORE_TEST_RUNTIME_UID){
  const path=join(f.state.path('app_fixture',f.state.active('app_fixture').current),'application.json');
  const probe=spawnSync(process.execPath,['-e',"const fs=require('node:fs');fs.readFileSync(process.argv[1]);try{fs.readFileSync(process.argv[2]);process.exit(2)}catch(e){if(e.code!=='EACCES')throw e}",path,join(dir,'current.json')],{uid:Number(process.env.QICORE_TEST_RUNTIME_UID),gid:Number(process.env.QICORE_TEST_RUNTIME_GID||process.env.QICORE_TEST_RUNTIME_UID),encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr);
 }
});

test('application archive path references block retirement until explicit recovery resolution',async t=>{
 for(const operation of ['repair','uninstall']){
  const f=await setup(t),install=f.request('install');await f.engine.execute(install.requestId,install);
  const request=f.request(operation),store=f.state.component('app_fixture'),archive=join(store.root,(operation==='repair'?'repair-evidence-':'uninstalled-code-')+request.requestId);store.write('recovery-references.json',[archive]);
  const result=await f.engine.execute(request.requestId,request);assert.equal(result.code,'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED');assert.ok(existsSync(archive));const downloads=f.calls.downloads;
  store.write('recovery-references.json',[]);assert.equal((await f.engine.recover(request.requestId,true)).status,'succeeded');assert.equal(existsSync(archive),false);assert.equal(f.calls.downloads,downloads);if(operation==='uninstall')assert.deepEqual(store.read('managed.json'),[]);
 }
});

test('application controller shutdown after backup does not migrate and recovery uses the existing task',async t=>{
 const f=await setup(t),request=f.request('install');let closing=false;f.host.assertOpen=()=>{if(closing)throw Error('RUNTIME_HOST_CLOSING')};const backup=f.engine.backup.bind(f.engine);f.engine.backup=async(...args)=>{const receipt=await backup(...args);closing=true;return receipt};
 const result=await f.engine.execute(request.requestId,request);assert.equal(result.status,'running');assert.equal(result.code,'UPDATE_INTERRUPTED');assert.equal(result.step,'BACKUP');assert.equal(f.calls.migrations,0);
 closing=false;assert.equal((await f.engine.recover(request.requestId)).status,'rolled_back');assert.equal(f.calls.migrations,0);assert.equal(f.calls.downloads,1);
});

test('unknown files and pending work block removal, and failed new application health verifies rollback',async t=>{
 const f=await setup(t),install=f.request('install');await f.engine.execute(install.requestId,install);const path=f.state.path('app_fixture',f.state.active('app_fixture').current);writeFileSync(join(path,'customer.txt'),'unknown');
 await assert.rejects(f.engine.preview('app_fixture','repair'),/UNDECLARED_RELEASE_FILE/);await assert.rejects(f.engine.preview('app_fixture','uninstall'),/UNDECLARED_RELEASE_FILE/);assert.equal(readFileSync(join(path,'customer.txt'),'utf8'),'unknown');rmSync(join(path,'customer.txt'));
 f.engine.impact=async()=>({tenants:2,pending:1,descriptor:f.descriptor});const uninstall=f.request('uninstall'),result=await f.engine.execute(uninstall.requestId,uninstall);assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(result.code,'APPLICATION_TASKS_PENDING');assert.ok(f.state.active('app_fixture'));
 const next=await setup(t);next.host.health=async key=>{if(key==='app_fixture')throw Error('HEALTH_CHECK_FAILED')};const input=next.request('install'),failed=await next.engine.execute(input.requestId,input);assert.equal(failed.status,'rolled_back',JSON.stringify(failed));assert.equal(next.state.active('app_fixture'),null);assert.equal(existsSync(next.state.directory('app_fixture')),false);assert.ok(next.host.running());
});

test('migration uncertainty preserves recovery evidence and healthy closeout resumes without reinstalling',async t=>{
 const f=await setup(t);f.engine.migrations=async(_r,_p,execute)=>{if(execute)throw Error('MIGRATION_TEST_INTERRUPTED')};const input=f.request('install'),result=await f.engine.execute(input.requestId,input);assert.equal(result.status,'recovery_required');assert.equal(result.code,'MIGRATION_RECOVERY_REQUIRED');assert.equal(f.host.running(),false);assert.ok(result.backup);await assert.rejects(f.engine.execute(randomUUID(),f.request('install')));
 const next=await setup(t),request=next.request('install');next.host.health=async key=>{if(key==='app_fixture')writeFileSync(join(next.state.directory(key),'unexplained.txt'),'preserve')};const healthy=await next.engine.execute(request.requestId,request);assert.equal(healthy.code,'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED');assert.equal(next.state.active('app_fixture').taskId,request.requestId);const before={...next.calls};rmSync(join(next.state.directory('app_fixture'),'unexplained.txt'));next.host.health=async()=>{};assert.equal((await next.engine.recover(request.requestId,true)).status,'succeeded');assert.equal(next.calls.downloads,before.downloads);assert.equal(next.calls.migrations,before.migrations);
});

test('work arriving during drain blocks uninstall before code removal and restarts the original runtime',async t=>{
 const f=await setup(t),install=f.request('install');await f.engine.execute(install.requestId,install);
 const before=structuredClone(f.state.active('app_fixture')),stops=f.calls.stops;
 f.engine.impact=async()=>({tenants:2,pending:f.calls.stops>stops?1:0,descriptor:f.descriptor});
 const request=f.request('uninstall'),result=await f.engine.execute(request.requestId,request);
 assert.equal(result.status,'rolled_back',JSON.stringify(result));assert.equal(result.failureCode,'APPLICATION_TASKS_PENDING');
 assert.deepEqual(f.state.active('app_fixture'),before);assert.ok(existsSync(f.state.directory('app_fixture')));assert.equal(f.host.running(),true);
});

test('uninstalled and health-rolled-back applications retain ownership of their identities',async t=>{
 const f=await setup(t),install=f.request('install');assert.equal((await f.engine.execute(install.requestId,install)).status,'succeeded');
 const uninstall=f.request('uninstall');assert.equal((await f.engine.execute(uninstall.requestId,uninstall)).status,'succeeded');
 const history=f.state.component('app_fixture').read('active.json');
 // Another package cannot reuse the uninstalled application's business identity.
 const receipt=f.client.status().receipt;f.client.acceptReceipt(f.envelope({...receipt,revision:2,entitlements:[...receipt.entitlements,{packageKey:'app_other',type:'app',useExpiresAt:null,updatesExpiresAt:null,channel:'stable'}]}));
 const other=f.release('app_other','1.0.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify({...f.descriptor,packageKey:'app_other'})});
 f.serveArchive(other);
 const blocked={...f.request('install'),packageKey:'app_other',manifestSha256:other.release.artifact.manifestSha256},before={...f.calls},result=await f.engine.execute(blocked.requestId,blocked);
 assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(result.code,'APPLICATION_IDENTITY_CONFLICT');
 assert.equal(f.calls.migrations,before.migrations);assert.equal(f.calls.stops,before.stops);
 assert.deepEqual(f.state.component('app_fixture').read('active.json'),history);
 assert.equal(readFileSync(join(f.state.config.dataRoot,'retained.txt'),'utf8'),'customer data');

 const failed=await setup(t);failed.host.health=async key=>{if(key==='app_fixture')throw Error('HEALTH_CHECK_FAILED')};
 const request=failed.request('install');assert.equal((await failed.engine.execute(request.requestId,request)).status,'rolled_back');
 assert.equal(failed.state.component('app_fixture').read('application.json').key,'fixture');
 // Changing a package's business key after failed health is also rejected before migration.
 const changed=failed.release('app_fixture','1.0.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify({...failed.descriptor,key:'changed-identity'})});
 failed.serveArchive(changed);
 const retry={...failed.request('install'),manifestSha256:changed.release.artifact.manifestSha256},attempts={...failed.calls},rejected=await failed.engine.execute(retry.requestId,retry);
 assert.equal(rejected.status,'blocked',JSON.stringify(rejected));assert.equal(rejected.code,'APPLICATION_IDENTITY_CHANGED');
 assert.equal(failed.calls.migrations,attempts.migrations);assert.equal(failed.calls.stops,attempts.stops);
});

test('an incomplete declared application frontend is rejected before stopping services or migrating',async t=>{
 const f=await setup(t),descriptor={...f.descriptor,web:{h5:{directory:'web/h5'}}};
 const incomplete=f.release('app_fixture','1.0.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify(descriptor),'web/h5/h5-routes.json':'{}'});
 f.serveArchive(incomplete);const request=f.request('install'),result=await f.engine.execute(request.requestId,request);
 assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(result.code,'APPLICATION_LAYOUT_INCOMPLETE');
 assert.equal(f.calls.stops,0);assert.equal(f.calls.backups,0);assert.equal(f.calls.migrations,0);
 assert.equal(f.state.active('app_fixture'),null);assert.equal(f.host.running(),true);
});
