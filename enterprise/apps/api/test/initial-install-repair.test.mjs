import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture} from './fixtures/native-release.mjs';
import {initialBootstrapConfig} from '../dist/lifecycle/bootstrap-delivery.js';
import {reconcileInitialInstall} from '../dist/lifecycle/initial-install-repair.js';
import {StateStore} from '../dist/license/store.js';

function setup(t){
 const root=mkdtempSync(join(tmpdir(),'qicore-reinstall-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{initial:true,version:'0.1.8'}),bootstrap=join(root,'bundle/bootstrap'),file=join(root,'private-config/bootstrap.json');mkdirSync(bootstrap,{recursive:true});
 const candidate=initialBootstrapConfig({product:f.product,privateRoot:join(root,'private'),backupRoot:join(root,'backups'),archive:'qicore-0.1.8-linux-x64.zip',adminOrigin:'https://customer.example',adminPort:3500,apiPort:3501},bootstrap,file,{uid:process.getuid?.()||1000,gid:process.getgid?.()||1000});
 const old=structuredClone(candidate);old.archive=join(root,'bundle/incoming/qicore-0.1.4-linux-x64.zip');old.native.product.version='0.1.4';
 new StateStore(dirname(file)).write('bootstrap.json',old);new StateStore(dirname(old.nativeConfigFile)).write('native.json',{...old.native,migrationUrl:'mysql://fixture:fixture-only@127.0.0.1/fresh'});
 const control=new StateStore(old.controlRoot);control.write('request.json',{id:'previous-failed-attempt',status:'failed',code:'INSTALL_FAILED',hash:'preserve'});
 mkdirSync(join(old.native.stateRoot,old.native.frameworkKey),{recursive:true});new StateStore(old.native.licenseStateRoot).write('identity.json',{fixture:'preserve-identity'});
 const before=readFileSync(file,'utf8'),nativeBefore=readFileSync(old.nativeConfigFile,'utf8'),requestBefore=readFileSync(join(old.controlRoot,'request.json'),'utf8');
 return {root,file,old,candidate,before,nativeBefore,requestBefore,control,component:join(old.native.stateRoot,old.native.frameworkKey)};
}
const emptyDatabase=async()=>{};

test('empty failed first install repairs both source versions and a missing code directory without changing credentials, identity or failure evidence',async t=>{
 const f=setup(t);let checked=0;const database=async url=>{checked++;assert.match(url,/fixture-only/)};
 const preview=await reconcileInitialInstall(f.file,f.candidate,database,false);assert.equal(preview.changed,true);assert.equal(existsSync(f.old.native.root),false);assert.equal(readFileSync(f.file,'utf8'),f.before);
 const result=await reconcileInitialInstall(f.file,f.candidate,database);assert.equal(result.changed,true);assert.equal(checked,2);assert.equal(statSync(f.old.native.root).mode&0o777,0o755);
 const updated=JSON.parse(readFileSync(f.file)),native=JSON.parse(readFileSync(f.old.nativeConfigFile));assert.equal(updated.archive,f.candidate.archive);assert.equal(native.product.version,'0.1.8');assert.deepEqual(updated.native,nativeWithoutUrl(native));assert.equal(native.migrationUrl,JSON.parse(f.nativeBefore).migrationUrl);
 assert.equal(readFileSync(join(f.old.controlRoot,'request.json'),'utf8'),f.requestBefore);assert.deepEqual(JSON.parse(readFileSync(join(f.old.native.licenseStateRoot,'identity.json'))),{fixture:'preserve-identity'});assert.deepEqual(readdirSync(f.component),[]);
 const journal=JSON.parse(readFileSync(result.backupJournal));assert.equal(journal.status,'complete');assert.equal(journal.changes[0].before,f.before);assert.equal(journal.changes[1].before,f.nativeBefore);assert.equal(statSync(result.backupJournal).mode&0o777,0o600);
 assert.equal((await reconcileInitialInstall(f.file,f.candidate,database)).changed,false);assert.equal(readFileSync(result.backupJournal,'utf8'),JSON.stringify(journal));
});
function nativeWithoutUrl(native){const {migrationUrl,...value}=native;return value}

test('installed, nonempty, running and recovery states are never reset by the repair',async t=>{
 for(const seed of [
  f=>new StateStore(f.old.native.dataRoot).write('customer-upload.json',{keep:true}),
  f=>new StateStore(f.component).write('installation.json',{status:'recovery_required',phase:'migration'}),
  f=>new StateStore(f.component).write('active.json',{health:'passed'}),
  f=>writeFileSync(f.old.native.environmentFile,'preserve'),
  f=>f.control.write('request.json',{status:'running'}),
  f=>f.control.write('bootstrap-transition.json',{status:'switched'}),
 ]){const f=setup(t);seed(f);await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/INSTALL_REPAIR_RECOVERY_REQUIRED/);assert.equal(readFileSync(f.file,'utf8'),f.before);assert.equal(existsSync(f.old.native.root),false);}
 const f=setup(t);await assert.rejects(reconcileInitialInstall(f.file,f.candidate,async()=>{throw Error('INSTALL_DATABASE_NOT_EMPTY')}),/INSTALL_DATABASE_NOT_EMPTY/);assert.equal(readFileSync(f.file,'utf8'),f.before);
});

test('repair rejects changed trust, downgrade, unrelated code roots and symbolic links before writing',async t=>{
 for(const [change,error] of [
  [c=>c.native.product.receiptPublicKey='changed','INSTALL_SOURCE_IDENTITY_CHANGED'],
  [c=>c.native.product.version='0.1.3','INSTALL_SOURCE_DOWNGRADE_REJECTED'],
  [c=>c.native.root=join(c.native.root,'other'),'INSTALL_SOURCE_LAYOUT_CHANGED'],
 ]){const f=setup(t),candidate=structuredClone(f.candidate);change(candidate);await assert.rejects(reconcileInitialInstall(f.file,candidate,emptyDatabase),new RegExp(error));assert.equal(readFileSync(f.file,'utf8'),f.before);}
 if(process.platform!=='win32'){const f=setup(t);mkdirSync(join(f.root,'unrelated'));symlinkSync(join(f.root,'unrelated'),f.old.native.root);await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/NATIVE_PATH_UNSAFE/);assert.equal(readFileSync(f.file,'utf8'),f.before);}
});

test('a previous manual version-only edit can be completed but unrelated native settings still conflict',async t=>{
 const f=setup(t),saved=JSON.parse(f.nativeBefore);saved.product.version='0.1.8';new StateStore(dirname(f.old.nativeConfigFile)).write('native.json',saved);
 await reconcileInitialInstall(f.file,f.candidate,emptyDatabase);assert.equal(JSON.parse(readFileSync(f.file)).native.product.version,'0.1.8');
 const other=setup(t),changed=JSON.parse(other.nativeBefore);changed.runtimeUid+=1;new StateStore(dirname(other.old.nativeConfigFile)).write('native.json',changed);await assert.rejects(reconcileInitialInstall(other.file,other.candidate,emptyDatabase),/INSTALL_CONFIG_CHANGED/);assert.equal(readFileSync(other.file,'utf8'),other.before);
});

test('a pending deployment transaction is kept intact instead of being overwritten by source repair',async t=>{
 const f=setup(t);new StateStore(dirname(f.file)).write('deployment-sync.json',{status:'pending',changes:[]});await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/INSTALL_REPAIR_DEPLOYMENT_PENDING/);assert.equal(readFileSync(f.file,'utf8'),f.before);assert.equal(existsSync(f.old.native.root),false);
});

test('an interrupted two-file repair resumes its exact journal and refuses external edits or newly installed state',async t=>{
 for(const conflict of ['none','external','installed']){
  const f=setup(t),write=StateStore.prototype.write;StateStore.prototype.write=function(name,value){if(this.root===dirname(f.old.nativeConfigFile)&&name==='native.json')throw Error('SIMULATED_POWER_LOSS');return write.call(this,name,value)};
  try{await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/SIMULATED_POWER_LOSS/)}finally{StateStore.prototype.write=write}
  const journal=join(dirname(f.file),'initial-source-repair.json');assert.equal(JSON.parse(readFileSync(journal)).status,'pending');
  if(conflict==='external'){writeFileSync(f.old.nativeConfigFile,f.nativeBefore+' ');await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/INSTALL_REPAIR_CONFLICT/);assert.equal(readFileSync(f.old.nativeConfigFile,'utf8'),f.nativeBefore+' ');}
  else if(conflict==='installed'){new StateStore(f.component).write('installation.json',{status:'running'});await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/INSTALL_REPAIR_RECOVERY_REQUIRED/);assert.equal(JSON.parse(readFileSync(journal)).status,'pending');}
  else{assert.equal((await reconcileInitialInstall(f.file,f.candidate,emptyDatabase)).changed,true);assert.equal(JSON.parse(readFileSync(journal)).status,'complete');assert.equal(JSON.parse(readFileSync(f.old.nativeConfigFile)).product.version,'0.1.8');}
 }
});

test('pending repair revalidates source identity and version before completing the second configuration write',async t=>{
 for(const [change,expected] of [[c=>c.native.product.receiptPublicKey='changed','INSTALL_SOURCE_IDENTITY_CHANGED'],[c=>c.native.product.version='0.1.3','INSTALL_SOURCE_DOWNGRADE_REJECTED']]){
  const f=setup(t),write=StateStore.prototype.write;StateStore.prototype.write=function(name,value){if(this.root===dirname(f.old.nativeConfigFile)&&name==='native.json')throw Error('SIMULATED_POWER_LOSS');return write.call(this,name,value)};
  try{await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/SIMULATED_POWER_LOSS/)}finally{StateStore.prototype.write=write}
  const before=readFileSync(f.file,'utf8'),candidate=structuredClone(f.candidate);change(candidate);await assert.rejects(reconcileInitialInstall(f.file,candidate,emptyDatabase),new RegExp(expected));assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(readFileSync(f.old.nativeConfigFile,'utf8'),f.nativeBefore);
 }
});

test('a damaged pending journal cannot change credentials, trust or move the archive outside its approved directory',async t=>{
 for(const tamper of [j=>{const value=JSON.parse(j.changes[1].after);value.migrationUrl='mysql://changed:changed@127.0.0.1/other';j.changes[1].after=JSON.stringify(value)},j=>{const value=JSON.parse(j.changes[0].after);value.archive='/tmp/unrelated.zip';j.changes[0].after=JSON.stringify(value)}]){
  const f=setup(t),write=StateStore.prototype.write;StateStore.prototype.write=function(name,value){if(this.root===dirname(f.file)&&name==='bootstrap.json')throw Error('SIMULATED_POWER_LOSS');return write.call(this,name,value)};
  try{await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/SIMULATED_POWER_LOSS/)}finally{StateStore.prototype.write=write}
  const journalFile=join(dirname(f.file),'initial-source-repair.json'),journal=JSON.parse(readFileSync(journalFile));tamper(journal);writeFileSync(journalFile,JSON.stringify(journal));const before=readFileSync(f.file,'utf8');await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/INSTALL_REPAIR_JOURNAL_INVALID/);assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(readFileSync(f.old.nativeConfigFile,'utf8'),f.nativeBefore);
 }
});

test('a manual edit between the two file writes is preserved and leaves the repair pending',async t=>{
 const f=setup(t),write=StateStore.prototype.write,edited=JSON.parse(f.nativeBefore);edited.migrationUrl='mysql://fixture:edited-fixture@127.0.0.1/fresh';const bytes=JSON.stringify(edited);
 StateStore.prototype.write=function(name,value){const result=write.call(this,name,value);if(this.root===dirname(f.file)&&name==='bootstrap.json')writeFileSync(f.old.nativeConfigFile,bytes);return result};
 try{await assert.rejects(reconcileInitialInstall(f.file,f.candidate,emptyDatabase),/INSTALL_REPAIR_CONFLICT/)}finally{StateStore.prototype.write=write}
 assert.equal(readFileSync(f.old.nativeConfigFile,'utf8'),bytes);assert.equal(JSON.parse(readFileSync(join(dirname(f.file),'initial-source-repair.json'))).status,'pending');
});
