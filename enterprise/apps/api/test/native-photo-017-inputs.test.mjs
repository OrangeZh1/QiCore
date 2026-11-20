import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {sign} from 'node:crypto';
import {fixture,zip,hash} from './fixtures/native-release.mjs';
import {photo017Inputs,PHOTO_KEY,FRAMEWORK_KEY,verifyPhoto017Archive,assertPhoto017Pair,readPhoto017Inputs,bindPhoto017Releases,readPhoto017Releases} from './fixtures/photo-017-inputs.mjs';
import {prepareNativeUpdateCandidate} from '../../../scripts/customer-delivery.mjs';
import {photo017Fetch,assertPhoto017Runtime,assertLegacyPhotoTransition,photoTransitionRequired} from './fixtures/native-photo-017-network.mjs';
import {LicenseClient} from '../dist/license/client.js';
import {canonicalJson} from '../dist/license/contracts.js';
import {nativeArchiveFromCatalog} from '../dist/license/native-release.js';
import {verifyNativeRelease,assertNativeCompatibility} from '../dist/license/native-updates.js';

async function sample(t){
 const root=await mkdtemp(join(tmpdir(),'photo-017-input-test-'));t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})});
 const f=fixture(root,{frameworkKey:FRAMEWORK_KEY,version:'0.1.6',applicationPackageKey:PHOTO_KEY});
 const build=version=>{
  const expected=photo017Inputs[version==='0.1.6'?'original':'compatible'],descriptor={format:'qicore-application-v1',key:'id-photo',packageKey:PHOTO_KEY,version,name:'隔离照片',pendingTasks:[]};
  const made=f.release(PHOTO_KEY,version,expected.from,{'application.json':JSON.stringify(descriptor),'entry.mjs':'export const version='+JSON.stringify(version)},
   {frameworkRange:expected.range,framework:{packageKey:FRAMEWORK_KEY,range:expected.range},entrypoint:'entry.mjs'});
  return{...made,expected:{...expected,sha256:hash(made.archive),manifestSha256:made.release.artifact.manifestSha256}};
 };
 const original=build('0.1.6'),compatible=build('0.1.7');
 const archive=join(root,'photo.zip'),manifest=join(root,'manifest.json'),product=join(root,'product.json'),output=join(root,'ordinary.json');
 await writeFile(archive,compatible.archive);await writeFile(manifest,compatible.entries.find(e=>e.path==='release-manifest.json').data);await writeFile(product,JSON.stringify(f.product));
 await prepareNativeUpdateCandidate({archive,manifest,product,releaseNotes:'隔离普通应用准备测试，不发布',output});const candidate=JSON.parse(await readFile(output,'utf8'));
 const {publishedAt,...old}=original.release,{releaseId,downloadUrl,...oldArtifact}=old.artifact,historical={...old,format:'qicore-local-release-v1',artifact:oldArtifact};
 const inputs={original:await verifyPhoto017Archive(original.archive,original.expected),compatible:await verifyPhoto017Archive(compatible.archive,compatible.expected)};
 const releases=bindPhoto017Releases(inputs,f.product,historical,candidate);
 return{root,f,original,compatible,inputs,historical,candidate,releases};
}
test('photo inputs pin the exact published and Linux CI artifacts and require explicit paths',async()=>{
 assert.equal(photo017Inputs.original.sha256,'360edc6c5e8bb19fdef22f7f950138e925bb172518c4728b4f988dcea30aadb8');
 assert.equal(photo017Inputs.compatible.sha256,'a673624f5bb81d9285f478d9529e109cffe0f40af0333f672f36fc361ee05e2b');
 await assert.rejects(readPhoto017Inputs({}),/QICORE_PHOTO_016_ZIP/);
 await assert.rejects(readPhoto017Releases({}, {}, {}),/QICORE_PHOTO_016_RELEASE/);
});
test('photo ZIP checking validates every file and allows the intentional 0.1.7 client change',async t=>{
 const s=await sample(t),old=await verifyPhoto017Archive(s.original.archive,s.original.expected),next=await verifyPhoto017Archive(s.compatible.archive,s.compatible.expected);
 assert.deepEqual(assertPhoto017Pair(old,next),{applicationMigrationCount:0,miniProgramByteIdentityRequired:false});
 const changed=structuredClone(next);changed.manifest.migrations=[{id:'changed'}];assert.throws(()=>assertPhoto017Pair(old,changed),/migration changes/);
 await assert.rejects(verifyPhoto017Archive(s.compatible.archive,s.original.expected),/archive digest/);
 await assert.rejects(verifyPhoto017Archive(s.compatible.archive,{...s.compatible.expected,version:'0.1.6'}));
 await assert.rejects(verifyPhoto017Archive(s.compatible.archive,{...s.compatible.expected,manifestSha256:'0'.repeat(64)}),/manifest digest/);
});
test('photo ZIP checking rejects extra paths, duplicate paths, symlinks and modified entries even with a matching outer digest',async t=>{
 const {compatible}=await sample(t);
 for(const entries of [[...compatible.entries,{path:'extra.txt',data:'extra'}],[...compatible.entries,compatible.entries[0]],compatible.entries.map((e,i)=>i===0?{...e,mode:0o120777}:e),compatible.entries.map(e=>e.path==='entry.mjs'?{...e,data:'modified'}:e)]){
  const bytes=zip(entries);await assert.rejects(verifyPhoto017Archive(bytes,{...compatible.expected,sha256:hash(bytes)}));
 }
});
test('the production preparer binds unsigned photo 0.1.7 to exact bytes without downgrading signed history',async t=>{
 const {f,releases,inputs,historical,candidate}=await sample(t);verifyNativeRelease(f.product,releases.original);verifyNativeRelease({...f.product,archiveReleaseKeys:{}},releases.compatible);
 assert.equal(releases.compatible.artifact.integrity.format,'id-photo-release-integrity-v1');assert.ok(!Object.hasOwn(releases.compatible.artifact,'signatureEnvelope'));
 for(const mutate of [v=>v.localRelease.artifact.integrity.version='0.1.8',v=>v.localRelease.artifact.integrity.framework_package_key='frm_other',v=>v.localRelease.artifact.integrity.archive_sha256='0'.repeat(64),v=>v.localRelease.manifest.parentApp=PHOTO_KEY,v=>v.localRelease.manifest.type='framework',v=>v.fields.releaseManifest+=' ',v=>v.size='1',v=>v.localRelease.artifact.signatureEnvelope=historical.artifact.signatureEnvelope]){
  const broken=structuredClone(candidate);mutate(broken);assert.throws(()=>bindPhoto017Releases(inputs,f.product,historical,broken));
 }
 const damaged=structuredClone(historical);damaged.artifact.signatureEnvelope.signature=Buffer.alloc(64).toString('base64url');assert.throws(()=>bindPhoto017Releases(inputs,f.product,damaged,candidate),/RELEASE_SIGNATURE_INVALID/);
 damaged.artifact.integrity=candidate.localRelease.artifact.integrity;assert.throws(()=>bindPhoto017Releases(inputs,f.product,damaged,candidate));
 const other=f.release('app_other','0.1.7','0.1.6').release;verifyNativeRelease(f.product,other);delete other.artifact.signatureEnvelope;assert.throws(()=>verifyNativeRelease(f.product,other));
 assert.throws(()=>verifyNativeRelease({...f.product,appKey:'frm_other'},releases.compatible),/RELEASE_IDENTITY_MISMATCH/);
});
test('actual compatibility contract rejects framework 0.1.7 with app 0.1.6 and accepts app-first order',async t=>{
 const {f,original,compatible}=await sample(t);
 const framework=version=>nativeArchiveFromCatalog(f.release(FRAMEWORK_KEY,version,'0.1.6',{'main.mjs':'fixture'},{entrypoint:'main.mjs'}).release.manifest);
 const before=framework('0.1.6'),after=framework('0.1.7'),old=nativeArchiveFromCatalog(original.release.manifest),next=nativeArchiveFromCatalog(compatible.release.manifest);
 assert.throws(()=>assertNativeCompatibility([before,old],after,'linux','x64','24.0.0'),/COMPONENT_DEPENDENCY_CONFLICT/);
 assert.doesNotThrow(()=>assertNativeCompatibility([before,old],next,'linux','x64','24.0.0'));
 assert.doesNotThrow(()=>assertNativeCompatibility([before,next],after,'linux','x64','24.0.0'));
});
test('photo network fixture verifies instance signatures and forwards incompatible signed plans to the real updater',async t=>{
 const {f,original,compatible,releases}=await sample(t),installed=[{packageKey:FRAMEWORK_KEY,version:'0.1.6'},{packageKey:PHOTO_KEY,version:'0.1.6'}];
 const release=f.release(FRAMEWORK_KEY,'0.1.7','0.1.6').release;
 const plans=Object.fromEntries(['native-full-v1','native-full-v2','native-full-v3'].map(capability=>[capability,f.envelope(f.plan(release,installed,FRAMEWORK_KEY,capability))]));
 const identity=f.client.identity(),network={instanceId:identity.instanceId,publicKey:identity.publicKey,receipt:f.envelope(f.client.status().receipt),applicationKey:PHOTO_KEY,installed,targetPackageKey:FRAMEWORK_KEY,targetIntegrityFormat:'qicore-release-integrity-v1',plans,releases:[{release:releases.compatible,archive:'fixture'}],lifecycleOperation:'repair',lifecyclePlans:{'native-lifecycle-v1':{fixture:'signed-old'},'native-lifecycle-v2':{fixture:'ordinary-new'}}};
 let localCalls=0;const handler=photo017Fetch(()=>network,async()=>{localCalls++;return new Response('local')},()=>compatible.archive);
 assert.equal(await(await handler('http://127.0.0.1/health')).text(),'local');assert.equal(localCalls,1);
 await assert.rejects(handler('https://api.weixin.qq.com/anything'),/TEST_EXTERNAL_NETWORK_BLOCKED/);
 const request=body=>{const envelope={instanceId:identity.instanceId,timestamp:String(Date.now()),nonce:'fixture-nonce',payload:body};
  // This key was generated by fixture() above; never load an installed instance identity.
  envelope.signature=sign(null,Buffer.from(`${envelope.instanceId}\n${envelope.timestamp}\n${envelope.nonce}\n${hash(canonicalJson(body))}`),identity.privateKey).toString('base64url');return{body:JSON.stringify(envelope)};
 };
 const payload={capability:'native-full-v2',installed,targetPackageKeys:[FRAMEWORK_KEY]};
 assert.deepEqual(await(await handler('https://license.example/api/v1/updates/plan',request(payload))).json(),{signedPlan:plans['native-full-v2']});
 const v1Frame=await handler('https://license.example/api/v1/updates/plan',request({...payload,capability:'native-full-v1'}));assert.equal(v1Frame.status,409);assert.equal((await v1Frame.json()).code,photoTransitionRequired);
 network.targetIntegrityFormat=null;assert.deepEqual(await(await handler('https://license.example/api/v1/updates/plan',request({...payload,capability:'native-full-v1'}))).json(),{signedPlan:plans['native-full-v1']});network.targetIntegrityFormat='qicore-release-integrity-v1';
 await assert.rejects(handler('https://license.example/api/v1/updates/plan',request({...payload,installed:[]})));
 const broken=JSON.parse(request(payload).body);broken.signature='a'.repeat(86);await assert.rejects(handler('https://license.example/api/v1/updates/plan',{body:JSON.stringify(broken)}));
 network.targetIntegrityFormat='id-photo-release-integrity-v1';network.targetPackageKey=PHOTO_KEY;
 network.plans=Object.fromEntries(['native-full-v1','native-full-v2','native-full-v3'].map(capability=>[capability,f.envelope(f.plan(releases.compatible,installed,PHOTO_KEY,capability))]));
 const photoPayload={...payload,targetPackageKeys:[PHOTO_KEY]};
 for(const capability of ['native-full-v1','native-full-v2']){const legacy=await handler('https://license.example/api/v1/updates/plan',request({...photoPayload,capability}));assert.equal(legacy.status,409);assert.equal((await legacy.json()).code,photoTransitionRequired)}
 assert.deepEqual(await(await handler('https://license.example/api/v1/updates/plan',request({...photoPayload,capability:'native-full-v3'}))).json(),{signedPlan:network.plans['native-full-v3']});
 const lifecycle={operation:'repair',packageKey:PHOTO_KEY,installed,capability:'native-lifecycle-v1'};
 const oldLifecycle=await handler('https://license.example/api/v1/updates/lifecycle/plan',request(lifecycle));assert.equal(oldLifecycle.status,409);assert.equal((await oldLifecycle.json()).code,photoTransitionRequired);
 assert.deepEqual(await(await handler('https://license.example/api/v1/updates/lifecycle/plan',request({...lifecycle,capability:'native-lifecycle-v2'}))).json(),{signedPlan:network.lifecyclePlans['native-lifecycle-v2']});
 network.targetIntegrityFormat=null;assert.deepEqual(await(await handler('https://license.example/api/v1/updates/lifecycle/plan',request(lifecycle))).json(),{signedPlan:network.lifecyclePlans['native-lifecycle-v1']});
 const download=await handler('https://license.example'+releases.compatible.artifact.downloadUrl,{headers:{authorization:'Bearer fixture_update.'+'a'.repeat(43)}});assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(compatible.archive));
 await assert.rejects(handler('https://license.example'+original.release.artifact.downloadUrl,{headers:{authorization:'Bearer fixture_update.'+'a'.repeat(43)}}),/pinned test artifacts/);
});
const legacyUnavailable=()=>({state:'unavailable',label:'检查未完成',description:'无法完成可信版本检查',currentVersion:'0.1.6',latestVersion:null,checkedAt:'2026-11-02T00:00:00.000Z',code:'LICENSE_NETWORK_ERROR',canCheck:true});
test('legacy refusal requires the actual v1 request and full producer response, not merely the generic client error',async t=>{
 const {f}=await sample(t),installed=[{packageKey:FRAMEWORK_KEY,version:'0.1.6'},{packageKey:PHOTO_KEY,version:'0.1.6'}],identity=f.client.identity(),events=[];
 const network={instanceId:identity.instanceId,publicKey:identity.publicKey,installed,targetPackageKey:PHOTO_KEY,targetIntegrityFormat:'id-photo-release-integrity-v1'};
 const handler=photo017Fetch(()=>network,()=>assert.fail('no real network'),undefined,event=>events.push(event));
 const client=new LicenseClient(f.client.store,f.product,f.client.domain,handler,true);
 await assert.rejects(client.machine('updates/plan',{capability:'native-full-v1',installed,targetPackageKeys:[PHOTO_KEY]}),{message:'LICENSE_NETWORK_ERROR'});
 assert.deepEqual(assertLegacyPhotoTransition(legacyUnavailable(),events,PHOTO_KEY),{requestCapability:'native-full-v1',responseStatus:409,responseCode:photoTransitionRequired,planIssued:false,legacyApiCode:'LICENSE_NETWORK_ERROR'});
 for(const event of events)assert.deepEqual(Object.keys(event).sort(),(event.phase==='request'?['exchangeId','endpoint','capability','packageKey','operation','phase']:['exchangeId','endpoint','capability','packageKey','operation','phase','status','code','planIssued']).sort());
 for(const mutate of [e=>e.pop(),e=>e[1].code='TRANSITION_REQUIRED',e=>e[1].status=200,e=>e[1].planIssued=true,e=>e[1].exchangeId='a'.repeat(36),e=>e[0].capability='native-full-v2',e=>e.push({...e[1],planIssued:true})]){const invalid=structuredClone(events);mutate(invalid);assert.throws(()=>assertLegacyPhotoTransition(legacyUnavailable(),invalid,PHOTO_KEY))}
 for(const change of [{code:'UPDATE_CHECK_FAILED'},{state:'available'},{latestVersion:'0.1.7'},{description:'unexpected network failure'}])assert.throws(()=>assertLegacyPhotoTransition({...legacyUnavailable(),...change},events,PHOTO_KEY));
});
test('transport failures, fixture assertions and failed evidence writes cannot masquerade as a legacy transition refusal',async t=>{
 const {f}=await sample(t),installed=[{packageKey:FRAMEWORK_KEY,version:'0.1.6'},{packageKey:PHOTO_KEY,version:'0.1.6'}],identity=f.client.identity();
 const network={instanceId:identity.instanceId,publicKey:identity.publicKey,installed,targetPackageKey:PHOTO_KEY,targetIntegrityFormat:'id-photo-release-integrity-v1'};
 const body={capability:'native-full-v1',installed,targetPackageKeys:[PHOTO_KEY]};
 for(const mode of ['network','fixture-read','fixture-assertion','evidence-write']){
  const events=[],record=event=>{if(mode==='evidence-write'&&event.phase==='response')throw Error('evidence unavailable');events.push(event)};
  const handler=mode==='network'?async()=>{throw Error('simulated network failure')}:photo017Fetch(()=>{if(mode==='fixture-read')throw Error('fixture unavailable');return mode==='fixture-assertion'?{...network,installed:[]}:network},()=>assert.fail('no real network'),undefined,record);
  const client=new LicenseClient(f.client.store,f.product,f.client.domain,handler,true);
  await assert.rejects(client.machine('updates/plan',body),{message:'LICENSE_NETWORK_ERROR'});
  assert.throws(()=>assertLegacyPhotoTransition(legacyUnavailable(),events,PHOTO_KEY),mode+' must not count as a producer refusal');
 }
});
test('fault injection only rejects the selected candidate, never a root controller or the restored old runtime',()=>{
 const before={QICORE_PRODUCT:JSON.stringify({version:'0.1.6'}),QICORE_COMPONENTS:JSON.stringify({[PHOTO_KEY]:{version:'0.1.6'}})};
 assert.doesNotThrow(()=>assertPhoto017Runtime({},{}));assert.doesNotThrow(()=>assertPhoto017Runtime({},before));
 for(const setup of [{failRuntimeVersion:'0.1.7'},{applicationKey:PHOTO_KEY,failApplicationVersion:'0.1.7'}]){
  assert.doesNotThrow(()=>assertPhoto017Runtime(setup,{}));assert.doesNotThrow(()=>assertPhoto017Runtime(setup,before));
 }
 assert.throws(()=>assertPhoto017Runtime({failRuntimeVersion:'0.1.7'},{...before,QICORE_PRODUCT:JSON.stringify({version:'0.1.7'})}),/TEST_CANDIDATE_RUNTIME_FAILURE/);
 assert.throws(()=>assertPhoto017Runtime({applicationKey:PHOTO_KEY,failApplicationVersion:'0.1.7'},{...before,QICORE_COMPONENTS:JSON.stringify({[PHOTO_KEY]:{version:'0.1.7'}})}),/TEST_CANDIDATE_APPLICATION_FAILURE/);
});
