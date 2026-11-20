import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,unlinkSync,existsSync,renameSync,readdirSync,lstatSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StateStore} from '../dist/license/store.js';
import {UpdateEngine} from '../dist/lifecycle/update-engine.js';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';
import {createMaintenanceServer} from '../dist/lifecycle/maintenance-server.js';
import {BackupService} from '../dist/backups/service.mjs';
import {fixture} from './fixtures/native-release.mjs';
import {initializeNativeBackups} from '../dist/lifecycle/native-installation.js';
import {BackupArchive} from '../dist/backups/archive.mjs';

function directory(t){const root=mkdtempSync(join(tmpdir(),'qicore-update-maintenance-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root}
function engine(t){
 const store=new StateStore(directory(t)),from={version:'1.0.0',image:'native/frm_fixture@sha256:'+'a'.repeat(64)},to={version:'1.1.0',image:'native/frm_fixture@sha256:'+'b'.repeat(64)};
 store.write('active.json',{schema:'zjz-xcx-active-v1',current:from,previous:null,health:'passed',recoveryReferences:[]});
 const calls=[],id=randomUUID();let maintenance=false;
 const effects={authorize:async()=>({from,to,planId:'p',rollbackCompatible:true,migrations:[]}),backup:async()=>({id:'backup-'+id,sha256:'c'.repeat(64),verified:true}),maintenance:async value=>{maintenance=value;calls.push('maintenance:'+value)}};
 for(const key of ['inventory','prepareRecoveryImages','pull','compatibility','stop','migrate','switchTo','health','cleanup','abortPreparation'])effects[key]=async(...args)=>calls.push([key,...args]);
 return {store,from,to,id,calls,effects,get maintenance(){return maintenance},run:()=>new UpdateEngine(store,effects).execute(id)};
}
test('backup failure restores the paused original service without migration or database restore',async t=>{
 const f=engine(t);f.effects.backup=async()=>{throw Error('BACKUP_FAILED')};const result=await f.run();
 assert.equal(result.status,'rolled_back');assert.equal(f.maintenance,false);assert.equal(f.store.read('active.json').current.image,f.from.image);
 assert.ok(!f.calls.some(item=>item[0]==='migrate'));assert.ok(f.calls.some(item=>item[0]==='switchTo'&&item[1].image===f.from.image));
});
test('healthy committed code resumes business before cleanup; retry only rechecks health and closes out',async t=>{
 const f=engine(t);let fail=true;f.effects.cleanup=async()=>{f.calls.push(['cleanup']);if(fail)throw Error('RECOVERY_RELEASE_REFERENCED')};
 assert.equal((await f.run()).code,'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED');assert.equal(f.maintenance,false);assert.equal(f.store.read('active.json').previous,null);
 f.calls.length=0;f.effects.health=async()=>{throw Error('HEALTH_CHECK_FAILED')};
 await new UpdateEngine(f.store,f.effects).resumeCloseout(f.id);assert.deepEqual(f.calls,[]);
 f.effects.health=async()=>f.calls.push(['health']);fail=false;
 assert.equal((await new UpdateEngine(f.store,f.effects).resumeCloseout(f.id)).status,'succeeded');
 assert.deepEqual(f.calls.map(item=>Array.isArray(item)?item[0]:item),['health','maintenance:false','cleanup','inventory']);
});
test('migration interruption stays in maintenance and preserves both code targets for operator recovery',async t=>{
 const f=engine(t);f.effects.migrate=async()=>{throw Error('MIGRATION_FAILED')};
 const result=await f.run();assert.equal(result.code,'MIGRATION_RECOVERY_REQUIRED');assert.equal(f.maintenance,true);
 assert.equal(f.store.read('active.json').current.image,f.from.image);assert.ok(!f.calls.some(item=>item[0]==='cleanup'));
});
test('controller shutdown after backup leaves a recoverable checkpoint and does not begin migration',async t=>{
 const f=engine(t);let closing=true;f.effects.assertOpen=()=>{if(closing)throw Error('RUNTIME_HOST_CLOSING')};const interrupted=await f.run();assert.equal(interrupted.status,'running');assert.equal(interrupted.step,'BACKUP');assert.equal(interrupted.code,'UPDATE_INTERRUPTED');assert.ok(!f.calls.some(item=>item[0]==='migrate'));
 closing=false;f.calls.length=0;await new UpdateEngine(f.store,f.effects).recover();assert.equal(f.store.read('tasks.json')[0].status,'rolled_back');assert.ok(!f.calls.some(item=>item[0]==='migrate'||item[0]==='pull'));assert.equal(f.maintenance,false);
});
test('controller shutdown during rollback or committed closeout retains a checkpoint for the next controller',async t=>{
 for(const committed of [false,true]){
  const f=engine(t);let closing=false;
  f.effects.assertOpen=()=>{if(closing)throw Error('RUNTIME_HOST_CLOSING')};
  if(committed)f.effects.cleanup=async()=>{throw Error('RECOVERY_RELEASE_REFERENCED')};
  else{f.effects.backup=async()=>{throw Error('BACKUP_FAILED')};f.effects.switchTo=async()=>{closing=true;throw Error('RUNTIME_HOST_CLOSING')}}
  const result=await f.run();
  if(committed){closing=true;f.effects.health=async()=>{throw Error('RUNTIME_HOST_CLOSING')};await new UpdateEngine(f.store,f.effects).resumeCloseout(f.id)}
  else assert.equal(result.failureCode,'BACKUP_FAILED');
  assert.equal(f.store.read('tasks.json')[0].status,'running');assert.equal(f.store.read('tasks.json')[0].code,'UPDATE_INTERRUPTED');
  closing=false;f.effects.switchTo=async()=>{};f.effects.health=async()=>{};f.effects.cleanup=async()=>{};
  await new UpdateEngine(f.store,f.effects).recover();assert.equal(f.store.read('tasks.json')[0].status,committed?'succeeded':'rolled_back');
 }
});
test('current-only cleanup deletes only verified unreferenced code and records release of terminal audit references',async t=>{
 const root=directory(t),f=fixture(root),old=await f.install(f.release('frm_fixture','1.0.0','0.0.0')),store=f.state.component('frm_fixture');
 const oldPath=f.state.path('frm_fixture',old),history=join(store.root,'historical-code');mkdirSync(history);
 const archive=join(history,f.state.release('frm_fixture',old).artifact.manifestSha256);renameSync(oldPath,archive);
 store.write('active.json',null);const current=await f.install(f.release('frm_fixture','1.1.0','1.0.0'));
 store.write('archived-releases.json',{[old.image]:{path:archive,taskId:'old-task',status:'completed'}});
 store.write('tasks.json',[{id:'old-task',status:'succeeded',createdAt:'',target:{from:old,to:current}}]);
 store.write('recovery-references.json',[old.image]);const effects=new NativeEffects(f.state,{},f.client,'frm_fixture',randomUUID());
 // An aborted candidate must not retire historical recovery code before a new healthy receipt is committed.
 await effects.cleanup([current],[]);assert.ok(existsSync(archive));assert.equal(store.read('archived-releases.json')[old.image].status,'completed');
 store.write('active.json',{...f.state.active('frm_fixture'),taskId:effects.taskId});
 await assert.rejects(effects.cleanup([current],[]),/RECOVERY_RELEASE_REFERENCED/);assert.ok(existsSync(archive));
 store.write('recovery-references.json',[]);await effects.cleanup([current],[]);
 assert.equal(existsSync(history),false);assert.equal(store.read('archived-releases.json')[old.image].status,'removed');assert.equal(store.read('tasks.json').length,1);
 assert.deepEqual(readdirSync(join(f.state.directory('frm_fixture'),'releases')),[f.state.release('frm_fixture',current).artifact.manifestSha256]);
});
test('legacy successful repair archives are retired with their audit record, but explicit recovery references block removal',async t=>{
 const f=fixture(directory(t));const slot=await f.install(f.release('app_fixture','0.1.0','0.0.0')),store=f.state.component('app_fixture'),id=randomUUID(),archive=join(store.root,'repair-evidence-'+id),before=f.state.active('app_fixture');cpSync(f.state.path('app_fixture',slot),archive,{recursive:true});writeFileSync(join(archive,'server/main.mjs'),'legacy modified code');
 store.write('tasks.json',[{id,operation:'repair',status:'succeeded',step:'COMPLETE',createdAt:'',updatedAt:'',request:{packageKey:'app_fixture'},before}]);store.write('recovery-archive-'+id+'.json',{taskId:id,operation:'repair',path:archive,reason:'legacy repair evidence'});store.write('recovery-references.json',[slot.image]);
 const effects=new NativeEffects(f.state,{},f.client,'app_fixture',randomUUID());await assert.rejects(effects.retireApplicationArchives(),/RECOVERY_RELEASE_REFERENCED/);assert.ok(existsSync(archive));store.write('recovery-references.json',[]);await effects.retireApplicationArchives();assert.equal(existsSync(archive),false);const receipt=store.read('recovery-archive-'+id+'.json');assert.equal(receipt.status,'removed');assert.equal(receipt.reason,'legacy repair evidence');assert.match(receipt.integrity[0].actualSha256,/^[a-f0-9]{64}$/);assert.deepEqual(f.state.active('app_fixture'),before);await f.state.verifyCurrent('app_fixture');
});
test('legacy uninstall retirement verifies the exact archived code tree and preserves its durable audit',async t=>{
 const f=fixture(directory(t)),slot=await f.install(f.release('app_fixture','0.1.0','0.0.0')),store=f.state.component('app_fixture'),id=randomUUID(),archive=join(store.root,'uninstalled-code-'+id),before=f.state.active('app_fixture');
 renameSync(f.state.directory('app_fixture'),archive);store.write('active.json',{schema:'qicore-uninstalled-v1',taskId:id});
 store.write('tasks.json',[{id,operation:'uninstall',status:'succeeded',step:'COMPLETE',createdAt:'',updatedAt:'',request:{packageKey:'app_fixture'},before}]);store.write('recovery-archive-'+id+'.json',{taskId:id,operation:'uninstall',path:archive});
 const effects=new NativeEffects(f.state,{},f.client,'app_fixture',randomUUID());writeFileSync(join(archive,'unexplained.txt'),'preserve');await assert.rejects(effects.retireApplicationArchives(),/UNEXPLAINED_RECOVERY_ARCHIVE/);assert.ok(existsSync(archive));unlinkSync(join(archive,'unexplained.txt'));
 await effects.retireApplicationArchives();assert.equal(existsSync(archive),false);assert.equal(store.read('recovery-archive-'+id+'.json').status,'removed');assert.equal(store.read('active.json').codeRecovery,'released');assert.deepEqual(store.read('managed.json'),[]);assert.equal(store.read('tasks.json')[0].id,id);
});
test('maintenance release still works when the dump tool has become unavailable',async t=>{
 const f=fixture(directory(t)),id=randomUUID(),control=new StateStore(join(f.state.config.dataRoot,'control'));
 mkdirSync(f.state.config.backupRoot);control.write('maintenance.json',{taskId:id,at:new Date(Date.now()-1000).toISOString()});
 f.state.config.mysqldump='missing-dump-for-fixture';
 await new NativeEffects(f.state,{},f.client,'frm_fixture',id).maintenance(false);assert.equal(control.read('maintenance.json'),null);
 assert.equal(control.read('maintenance-history.json').length,1);
});
test('public maintenance remains reachable with both runtime children stopped and never exposes private journals',async t=>{
 const f=fixture(directory(t)),control=new StateStore(join(f.state.config.dataRoot,'control')),id=randomUUID();
 control.write('maintenance.json',{taskId:id,packageKey:'secret-key',at:new Date().toISOString()});
 let running=false;const server=createMaintenanceServer(f.state,{running:()=>running,acceptsHealth:value=>value.runtimeId==='qa-runtime'},async()=>Response.json({ready:true,mock:false,runtimeId:'qa-runtime'}));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>{server.close(ok);server.closeAllConnections()}));
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/public/maintenance';
 const first=await (await fetch(url)).json();assert.equal(first.data.state,'updating');assert.equal(first.data.estimatedSeconds,null);assert.ok(!JSON.stringify(first).includes(id));assert.ok(!JSON.stringify(first).includes('secret-key'));
 control.remove('maintenance.json');running=true;await new Promise(ok=>setTimeout(ok,1050));assert.equal((await (await fetch(url)).json()).data.serviceAvailable,true);
});
test('a delayed or cached healthy response cannot override maintenance that begins before the status response',async t=>{
 const f=fixture(directory(t)),control=new StateStore(join(f.state.config.dataRoot,'control')),id=randomUUID();let finish,started;const began=new Promise(resolve=>started=resolve);let probes=0;
 const server=createMaintenanceServer(f.state,{running:()=>true,acceptsHealth:()=>true},async()=>{probes++;started();return new Promise(resolve=>finish=()=>resolve(Response.json({ready:true,mock:false})))});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>{server.close(ok);server.closeAllConnections()}));const url='http://127.0.0.1:'+server.address().port+'/api/v1/public/maintenance';
 const first=fetch(url).then(response=>response.json());await began;control.write('maintenance.json',{taskId:id,at:new Date().toISOString()});finish();assert.equal((await first).data.state,'updating');
 control.remove('maintenance.json');assert.equal((await(await fetch(url)).json()).data.state,'ready');assert.equal(probes,1);
 f.state.component('frm_fixture').write('tasks.json',[{id,status:'recovery_required',createdAt:'',updatedAt:''}]);control.write('maintenance.json',{taskId:id,at:new Date().toISOString()});const second=await(await fetch(url)).json();assert.equal(second.data.state,'recovery_required');assert.equal(second.data.serviceAvailable,false);assert.equal(probes,1);
});
test('backup readiness exposes an actionable safe reason and can recover after configuration repair',async()=>{
 let denied=true;const archive={init(){if(denied)throw Object.assign(Error('secret path'),{code:'EACCES'})},checkCapability(){},list(){return []}};
 const service=new BackupService({},()=> '1.0.0',{url:'mysql://test:test@127.0.0.1/fixture',archive});service.init();
 assert.equal(service.ready,false);assert.equal(service.setupCode,'BACKUP_ACCESS_DENIED');assert.ok(!service.setupMessage.includes('secret'));
 denied=false;service.checkedAt=0;service.check();assert.equal(service.ready,true);
});
test('manual and updater backup readiness are independent and unknown controller capability is not promised',async t=>{
 const before=process.env.UPDATER_SOCKET;process.env.UPDATER_SOCKET='fixture-only';t.after(()=>{if(before===undefined)delete process.env.UPDATER_SOCKET;else process.env.UPDATER_SOCKET=before});
 let result={ready:false};const service=new BackupService({},()=> '1.0.0',{url:'mysql://test:test@127.0.0.1/fixture',archive:{init(){},checkCapability(){}},updater:async()=>result});service.init();
 const session={_admin:true,role:'root',permissions:['backups.read']};let value=await service.list(session,{});assert.equal(value.ready,true);assert.equal(value.automaticBeforeUpdate,false);
 result={ready:true};value=await service.list(session,{});assert.equal(value.automaticBeforeUpdate,true);
 service.updater=async()=>{throw Error('UPDATER_UNAVAILABLE')};value=await service.list(session,{});assert.equal(value.automaticBeforeUpdate,false);
});
test('controlled empty installation provisions a durable private key before read-only runtime initialization',t=>{
 const f=fixture(directory(t)),config=f.state.config;initializeNativeBackups(config);
 const file=join(config.backupKeyRoot,'backup.key'),key=readFileSync(file);assert.equal(key.length,32);
 const runtime=new BackupArchive({root:config.backupRoot,keyRoot:config.backupKeyRoot,binary:config.mysqldump,readOnlyKey:true});runtime.init();assert.deepEqual(runtime.key(),key);
 assert.equal(runtime.store.read('key-initialization.json').schema,'qicore-backup-key-v1');initializeNativeBackups(config);assert.deepEqual(readFileSync(file),key);
 if(process.platform!=='win32'){assert.equal(lstatSync(file).mode&0o777,0o600);if(process.getuid()===0)assert.equal(lstatSync(file).uid,config.runtimeUid)}
});
test('existing backups or initialization metadata with a lost key never generate a replacement',t=>{
 for(const kind of ['archive','record','initialized']){
  const f=fixture(directory(t)),config=f.state.config,file=join(config.backupKeyRoot,'backup.key');
  if(kind==='initialized'){initializeNativeBackups(config);unlinkSync(file)}
  else{mkdirSync(config.backupRoot);mkdirSync(config.backupKeyRoot);writeFileSync(join(config.backupRoot,'backup-'+randomUUID()+(kind==='archive'?'.zbackup':'.json')),kind==='record'?'{}':'encrypted evidence')}
  assert.throws(()=>initializeNativeBackups(config),/BACKUP_KEY_MISSING/);assert.equal(existsSync(file),false);
  const legacy=new BackupArchive({root:config.backupRoot,keyRoot:config.backupKeyRoot,binary:config.mysqldump});assert.throws(()=>legacy.init(),/BACKUP_KEY_MISSING/);assert.equal(existsSync(file),false);
 }
});
