import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,hash,zip,initialRelease} from './fixtures/native-release.mjs';
import {verifyNativeRelease,verifyNativeInitialRelease,checkNativePlan,nativeFileChanges,assertNativeCompatibility} from '../dist/license/native-updates.js';
import {nativeArchiveFromCatalog,nativeArchiveManifestSchema} from '../dist/license/native-release.js';
import {downloadNativeArchive,extractNativeArchive,verifyNativeTree} from '../dist/lifecycle/native-files.js';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';
import {UpdateEngine} from '../dist/lifecycle/update-engine.js';
import {createNativeUpdaterServer} from '../dist/lifecycle/native-updater.js';

function setup(t){const root=mkdtempSync(join(tmpdir(),'qicore-native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,...fixture(root)}}
function fixtureEnvironment(t,mode){
 const previous=process.env.NODE_ENV;
 process.env.NODE_ENV=mode;
 t.after(()=>{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous});
}
test('complete signed metadata rejects forged runtime and wrong role',t=>{
 const f=setup(t),r=f.release().release;assert.equal(verifyNativeRelease(f.product,r).version,'2.0.0');
 for(const mutate of [r=>r.manifest.entrypoint='server/other.mjs',r=>r.manifest.runtime.major=22,r=>r.artifact.packageKey='app_other',r=>r.manifest.frameworkRange='>=1',r=>r.artifact.signatureEnvelope.signature='a'.repeat(86),r=>r.artifact.downloadUrl='https://evil.example/file']){const changed=structuredClone(r);mutate(changed);assert.throws(()=>verifyNativeRelease(f.product,changed))}
 assert.throws(()=>verifyNativeRelease({...f.product,archiveReleaseKeys:{framework:{...f.product.archiveReleaseKeys.framework,role:'component_update'}}},r));
 assert.throws(()=>verifyNativeRelease({...f.product,archiveReleaseKeys:{}},r),/RELEASE_TRUST_REQUIRED/);
});
test('first-install evidence is limited to the host framework and cannot substitute an online plan',async t=>{
 const f=setup(t),initial=initialRelease(f.release('frm_fixture','1.0.0','0.0.0').release);
 assert.equal(verifyNativeInitialRelease(f.product,initial).version,'1.0.0');
 for(const release of [f.release('app_fixture','1.0.0','0.0.0').release,f.release().release])assert.throws(()=>verifyNativeInitialRelease(f.product,initialRelease(release)),/INITIAL_RELEASE_REQUIRED/);
 const next=initialRelease(f.release('frm_fixture','2.0.0','0.0.0').release);
 f.client.machine=async()=>({signedPlan:f.envelope(f.plan(next))});
 await assert.rejects(checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'1.0.0'}],'frm_fixture'));
});
test('signed scoped plans bind source snapshot, domain, revision, identity and target; no release is a verified empty result',async t=>{
 const f=setup(t),r=f.release().release;let raw=f.plan(r);f.client.machine=async(path,payload)=>{assert.equal(path,'updates/plan');assert.deepEqual(payload.targetPackageKeys,['frm_fixture']);assert.equal(payload.capability,'native-full-v2');return{signedPlan:f.envelope(raw),steps:[]}};
 assert.equal((await checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'1.0.0'}],'frm_fixture')).release.version,'2.0.0');
 for(const mutate of [p=>p.nativeContext.domain='wrong.example',p=>p.nativeContext.installed[0].version='0.0.0',p=>p.nativeContext.targetPackageKeys=['app_fixture'],p=>p.licenseRevision=2,p=>p.instanceId='a'.repeat(64),p=>p.validUntil=new Date(0).toISOString(),p=>p.steps.push(p.steps[0])]){raw=f.plan(r);mutate(raw);await assert.rejects(checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'1.0.0'}],'frm_fixture'))}
 raw=f.plan(null);assert.equal((await checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'1.0.0'}],'frm_fixture')).release,null);
 await assert.rejects(checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'0.0.0'}],'frm_fixture'),/NATIVE_INSTALLATION_REQUIRED/);
});
test('full ZIP extraction validates signed bytes and all files before a candidate becomes usable',async t=>{
 const f=setup(t),r=f.release(),archive=join(f.root,'release.zip'),candidate=join(f.root,'candidate');writeFileSync(archive,r.archive);
 await extractNativeArchive(archive,candidate,r.release);await verifyNativeTree(candidate,nativeArchiveFromCatalog(r.release.manifest));assert.equal(existsSync(join(candidate,'release-manifest.json')),false);
 writeFileSync(join(candidate,'server/main.mjs'),'locally edited');await assert.rejects(verifyNativeTree(candidate,nativeArchiveFromCatalog(r.release.manifest)),/LOCAL_RELEASE_MODIFIED/);
});
test('ZIP traversal, duplicate names, links, undeclared files, missing entries and wrong file digest are rejected',async t=>{
 const f=setup(t),r=f.release();let n=0;
 for(const change of [e=>e.push({path:'../escape',data:'bad'}),e=>e.push(e[0]),e=>{e[0]={...e[0],mode:0o120777}},e=>e.push({path:'unknown.txt',data:'bad'}),e=>e.shift(),e=>{e[0].data='x'.repeat(Buffer.byteLength(e[0].data))},e=>e.push({path:'SERVER/main.mjs',data:'bad'})]){
   const entries=structuredClone(r.entries);change(entries);const bytes=zip(entries),release=structuredClone(r.release);release.artifact.sha256=hash(bytes);release.artifact.size=String(bytes.length);const path=join(f.root,'bad'+n+'.zip');writeFileSync(path,bytes);
   await assert.rejects(extractNativeArchive(path,join(f.root,'bad'+n++),release));
 }
 for(const path of ['.env','uploads/a','storage/a','server/../../a','server/a.map','server/AUX.js','C:/a','server\\a','server/a.'])assert.equal(nativeArchiveManifestSchema.safeParse({...nativeArchiveFromCatalog(r.release.manifest),files:[{path,size:0,sha256:hash('')}],entrypoint:path}).success,false);
});
test('short lived download grants stay in headers, forbid redirect, enforce size/digest and never persist tokens',async t=>{
 const f=setup(t),r=f.release(),path=join(f.root,'download.zip');const token='opaque_token.'+'a'.repeat(43);
 f.client.machine=async(route,body)=>{assert.match(route,/\/access$/);assert.equal(body.planId,'plan_test');return{accessToken:token,expiresAt:new Date(Date.now()+50000).toISOString()}};
 await downloadNativeArchive(f.client,r.release,'plan_test',path,async(url,init)=>{assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer '+token);assert.equal(url.origin,'https://license.example');return new Response(r.archive,{headers:{'content-length':String(r.archive.length)}})});assert.equal(hash(readFileSync(path)),r.release.artifact.sha256);
 await assert.rejects(downloadNativeArchive(f.client,r.release,'plan_test',join(f.root,'wrong.zip'),async()=>new Response('bad',{headers:{'content-length':'3'}})),/DOWNLOAD_RESPONSE_INVALID/);
});
test('file differences and bidirectional compatibility never pull a dependent component along',t=>{
 const f=setup(t),current=f.release('frm_fixture','1.0.0','0.0.0',{'server/main.mjs':'old','old.txt':'old'}),next=f.release('frm_fixture','1.1.0','1.0.0',{'server/main.mjs':'new','new.txt':'new'}),app=f.release('app_fixture','1.0.0','0.0.0');
 assert.deepEqual(nativeFileChanges(nativeArchiveFromCatalog(current.release.manifest),nativeArchiveFromCatalog(next.release.manifest)).map(f=>f.kind),['added','deleted','modified']);
 assert.doesNotThrow(()=>assertNativeCompatibility([nativeArchiveFromCatalog(current.release.manifest),nativeArchiveFromCatalog(app.release.manifest)],nativeArchiveFromCatalog(next.release.manifest),'linux','x64','24.0.0'));
 assert.throws(()=>assertNativeCompatibility([nativeArchiveFromCatalog(app.release.manifest)],nativeArchiveFromCatalog(f.release().release.manifest),'linux','x64','24.0.0'),/COMPONENT_DEPENDENCY_CONFLICT/);
});
test('native disk switch, health receipt, current-only retention, local modification and unchanged other app',async t=>{
 const f=setup(t),old=f.release('frm_fixture','1.0.0','0.0.0'),app=f.release('app_fixture','1.0.0','0.0.0'),next=f.release('frm_fixture','1.1.0');old.release=initialRelease(old.release);await f.install(old);await f.install(app);
 const appBefore=f.state.active('app_fixture'),id=randomUUID(),request={packageKey:'frm_fixture',targetVersion:'1.1.0',manifestSha256:next.release.artifact.manifestSha256};
 f.client.machine=async()=>({signedPlan:f.envelope(f.plan(next.release,f.state.installed()))});
 const calls=[],host={stop:async()=>calls.push('stop'),start:async()=>calls.push('start'),health:async()=>calls.push('health')};
 const effects=new NativeEffects(f.state,host,f.client,'frm_fixture',id,request);
 // Use the real ZIP extractor, directory promotion and NativeEffects switching/cleanup. External database/runtime are explicit test doubles.
 effects.pull=async target=>{const store=f.state.component('frm_fixture'),archive=join(f.root,'task.zip'),candidate=join(f.state.directory('frm_fixture'),'candidate-'+id);writeFileSync(archive,next.archive);await extractNativeArchive(archive,candidate,next.release);store.write('managed.json',[...store.read('managed.json'),target]);const {renameSync}=await import('node:fs');renameSync(candidate,f.state.path('frm_fixture',target))};
 effects.compatibility=async()=>{for(const c of f.state.installed())await f.state.verifyCurrent(c.packageKey)};effects.maintenance=async()=>{};effects.backup=async()=>({id:'backup-'+id,sha256:'a'.repeat(64),verified:true});effects.migrate=async()=>calls.push('migrate');
 const engine=new UpdateEngine(f.state.component('frm_fixture'),effects);assert.equal((await engine.execute(id,request)).status,'succeeded');assert.equal((await engine.execute(id,request)).status,'succeeded');
 assert.equal(f.state.active('frm_fixture').current.version,'1.1.0');assert.equal(f.state.active('frm_fixture').previous,null);assert.equal(existsSync(f.state.path('frm_fixture',f.state.slot(old.release))),false);assert.deepEqual(f.state.active('app_fixture'),appBefore);assert.equal(calls.filter(c=>c==='migrate').length,1);
 await assert.rejects(engine.execute(id,{...request,targetVersion:'1.2.0'}),/REQUEST_ID_REUSED/);
 writeFileSync(join(f.state.path('frm_fixture',f.state.active('frm_fixture').current),'local.txt'),'preserve me');await assert.rejects(effects.inventory(),/UNDECLARED_RELEASE_FILE/);assert.equal(readFileSync(join(f.state.path('frm_fixture',f.state.active('frm_fixture').current),'local.txt'),'utf8'),'preserve me');
});
test('production rejects split-component checks and execution without creating an update task',async t=>{
 fixtureEnvironment(t,'production');
 const f=setup(t);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 const before=f.state.active('frm_fixture'),server=createNativeUpdaterServer(f.state,f.client,{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const [path,body] of [['/check',{packageKey:'frm_fixture'}],['/execute',{packageKey:'frm_fixture',requestId:randomUUID(),targetVersion:'2.0.0',manifestSha256:'a'.repeat(64)}]]){
  const response=await fetch(origin+path,{method:'POST',body:JSON.stringify(body)});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'STANDALONE_WHOLE_PRODUCT_UPDATER_REQUIRED');
 }
 assert.deepEqual(f.state.tasks(),[]);assert.deepEqual(f.state.active('frm_fixture'),before);
});
test('legacy native executor persists request identity before authorization; failed authorization cannot accept another body under same ID',async t=>{
 fixtureEnvironment(t,'test');
 const f=setup(t);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));const id=randomUUID(),input={requestId:id,packageKey:'frm_fixture',targetVersion:'2.0.0',manifestSha256:'a'.repeat(64)};
 const server=createNativeUpdaterServer(f.state,f.client,{},()=>({authorize:async()=>{throw Error('UPDATE_NOT_ELIGIBLE')}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port;
 const post=body=>fetch(url+'/execute',{method:'POST',body:JSON.stringify(body)});assert.equal((await post(input)).status,202);assert.equal((await post(input)).status,200);assert.equal((await post({...input,manifestSha256:'b'.repeat(64)})).status,409);
 assert.equal((await post({...input,requestId:randomUUID(),packageKey:'app_unknown'})).status,409);assert.equal(existsSync(join(f.state.config.stateRoot,'app_unknown')),false);
 assert.equal(f.state.tasks()[0].request.manifestSha256,input.manifestSha256);assert.equal(f.state.tasks()[0].status,'blocked');
});

test('application updates reject an incomplete frontend before database checks or service interruption',async t=>{
 const f=setup(t);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 const descriptor={format:'qicore-application-v1',key:'fixture',packageKey:'app_fixture',version:'1.0.0',name:'Fixture',pendingTasks:[]};
 await f.install(f.release('app_fixture','1.0.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify(descriptor)}));
 const before=structuredClone(f.state.active('app_fixture'));
 const next=f.release('app_fixture','1.1.0','1.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify({...descriptor,version:'1.1.0',web:{h5:{directory:'web/h5'}}})});
 f.client.machine=async path=>path.endsWith('/access')?{accessToken:'fixture_token.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()}:{signedPlan:f.envelope(f.plan(next.release,f.state.installed(),'app_fixture'))};
 f.client.transport=async()=>new Response(next.archive,{headers:{'content-length':String(next.archive.length)}});
 const calls=[],host={stop:async()=>calls.push('stop'),start:async()=>calls.push('start'),health:async()=>calls.push('health')},id=randomUUID();
 const request={packageKey:'app_fixture',targetVersion:'1.1.0',manifestSha256:next.release.artifact.manifestSha256};
 const effects=new NativeEffects(f.state,host,f.client,'app_fixture',id,request);
 effects.runtime=()=>({platform:'linux',arch:'x64',node:'24.0.0'});
 effects.database=()=>{throw Error('DATABASE_CHECK_SHOULD_NOT_RUN')};
 effects.maintenance=async()=>{};effects.backup=async()=>{calls.push('backup');throw Error('UNEXPECTED_BACKUP')};effects.migrate=async()=>calls.push('migrate');
 const task=await new UpdateEngine(f.state.component('app_fixture'),effects).execute(id,request);
 assert.equal(task.status,'blocked',JSON.stringify(task));assert.equal(task.code,'APPLICATION_LAYOUT_INCOMPLETE');
 assert.deepEqual(calls,[]);assert.deepEqual(f.state.active('app_fixture'),before);
});


test('unavailable application releases remain a business rejection instead of a network error',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-app-plan-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root);f.client.transport=async()=>Response.json({message:'No compatible full application release is available for this operation'},{status:409});
 await assert.rejects(f.client.machine('updates/lifecycle/plan',{}),/APPLICATION_RELEASE_UNAVAILABLE/);
 const {UpdateService}=await import('../dist/lifecycle/update-service.js');
 const before=process.env.UPDATER_SOCKET;process.env.UPDATER_SOCKET='fixture.sock';t.after(()=>{if(before===undefined)delete process.env.UPDATER_SOCKET;else process.env.UPDATER_SOCKET=before});
 const service=new UpdateService({client:{product:{appKey:'frm_fixture'}},assertComponentAllowed(){}},async()=>{throw Error('APPLICATION_RELEASE_UNAVAILABLE')});
 await assert.rejects(service.applicationOperation({packageKey:'app_fixture',operation:'install'}),error=>error.code==='APPLICATION_OPERATION_REJECTED'&&error.message.includes('完整应用安装包'));
});

test('scoped dependency 409 remains a blocked update with actionable copy and no runtime mutation',async t=>{
 fixtureEnvironment(t,'test');
 const f=setup(t);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));const before=structuredClone(f.state.active('frm_fixture'));let networkFailure=false;
 f.client.transport=async()=>{if(networkFailure)throw Error('offline');return Response.json({code:'SCOPED_UPDATE_DEPENDENCY_CONFLICT',message:'This component requires a joint update; check all updates.'},{status:409})};
 await assert.rejects(f.client.machine('updates/plan',{}),/^Error: SCOPED_UPDATE_DEPENDENCY_CONFLICT$/);
 networkFailure=true;await assert.rejects(f.client.machine('updates/plan',{}),/^Error: LICENSE_NETWORK_ERROR$/);networkFailure=false;
 const calls=[],host={stop:async()=>calls.push('stop'),start:async()=>calls.push('start'),health:async()=>calls.push('health')},server=createNativeUpdaterServer(f.state,f.client,host);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));const url='http://127.0.0.1:'+server.address().port;
 const post=(path,body)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const check=await(await post('/check',{packageKey:'frm_fixture'})).json();assert.equal(check.state,'unavailable');assert.equal(check.code,'SCOPED_UPDATE_DEPENDENCY_CONFLICT');assert.equal(check.latestVersion,null);assert.match(check.description,/先更新相关应用到兼容版本/);assert.doesNotMatch(check.description,/网络/);
 const request={requestId:randomUUID(),packageKey:'frm_fixture',targetVersion:'1.1.0',manifestSha256:'a'.repeat(64)};assert.equal((await post('/execute',request)).status,202);await server.waitForUpdates();
 const task=f.state.tasks().find(item=>item.id===request.requestId);assert.equal(task.status,'blocked');assert.equal(task.step,'AUTHORIZE');assert.equal(task.code,'SCOPED_UPDATE_DEPENDENCY_CONFLICT');assert.equal(task.backup,undefined);assert.deepEqual(calls,[]);assert.deepEqual(f.state.active('frm_fixture'),before);
});

test('a signed 0.1.1 to 0.1.2 plan requires the exact installed source version',async t=>{
 const f=setup(t),release=f.release('frm_fixture','0.1.2','0.1.1').release;
 f.client.machine=async(_path,body)=>{const plan=f.plan(release,body.installed);plan.steps[0].fromVersion=body.installed[0].version;return {signedPlan:f.envelope(plan)}};
 assert.equal((await checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'0.1.1'}],'frm_fixture')).release.version,'0.1.2');
 await assert.rejects(checkNativePlan(f.client,[{packageKey:'frm_fixture',version:'0.1.0'}],'frm_fixture'),/UPDATE_PLAN_MISMATCH/);
});


test('native plugin manifests bind either a framework or a versioned parent application',async t=>{
 const {nativeReleaseManifestSchema}=await import('../dist/license/native-release.js'),f=setup(t),base=f.release('app_fixture').release.manifest;
 const plugin={...base,type:'plugin',packageKey:'plg_fixture',artifactPackageType:'plugin_update',parentApp:null};
 assert.equal(nativeReleaseManifestSchema.safeParse(plugin).success,true);
 const standalone={...plugin,framework:null,frameworkRange:'*',parentApp:'app_standalone',dependencies:[{packageKey:'app_standalone',range:'^1.0.0'}]};
 assert.equal(nativeReleaseManifestSchema.safeParse(standalone).success,true);
 assert.equal(nativeReleaseManifestSchema.safeParse({...standalone,dependencies:[]}).success,false);
 assert.equal(nativeReleaseManifestSchema.safeParse({...standalone,parentApp:null}).success,false);
});
