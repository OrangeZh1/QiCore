import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,hash,initialRelease} from './fixtures/native-release.mjs';
import {QICORE_FRAMEWORK_KEY,nativeArchiveFromCatalog} from '../dist/license/native-release.js';
import {verifyNativeRelease,verifyNativeInitialRelease,verifyNativeLocalRelease,verifyNativeStoredRelease,checkNativePlan,checkNativeOperation} from '../dist/license/native-updates.js';
import {downloadNativeArchive,extractNativeArchive,verifyNativeTree} from '../dist/lifecycle/native-files.js';
import {NativeLocalEffects} from '../dist/lifecycle/native-local-update.js';
import {UpdateEngine} from '../dist/lifecycle/update-engine.js';

function setup(t){const root=mkdtempSync(join(tmpdir(),'qicore-integrity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return{root,...fixture(root,{frameworkKey:QICORE_FRAMEWORK_KEY})}}
function plain(release){
 const result=structuredClone(release),a=result.artifact;
 delete a.signatureEnvelope;
 a.integrity={format:'qicore-release-integrity-v1',package_key:a.packageKey,package_type:a.packageType,from_version:a.fromVersion,version:a.version,archive_sha256:a.sha256,archive_size:a.size,release_manifest_sha256:a.manifestSha256};
 return result;
}
function offline(release,kind){const result=initialRelease(release);result.format=`qicore-${kind}-release-v2`;return result}

test('only the designated host framework accepts ordinary integrity metadata without release keys',t=>{
 const f=setup(t),r=plain(f.release().release),product={...f.product,archiveReleaseKeys:{}};
 assert.deepEqual(verifyNativeRelease(product,r),r);
 assert.throws(()=>verifyNativeRelease({...product,appKey:'frm_other'},r),/RELEASE_IDENTITY_MISMATCH/);
 for(const candidate of [f.release('app_fixture').release,f.release('frm_other').release])assert.throws(()=>verifyNativeRelease(product,plain(candidate)));
 const plugin=plain(f.release('app_fixture').release);plugin.manifest.type='plugin';plugin.manifest.artifactPackageType='plugin_update';plugin.artifact.packageType='plugin_update';plugin.artifact.integrity.package_type='plugin_update';
 assert.throws(()=>verifyNativeRelease(product,plugin));
});

test('ordinary metadata binds every catalog, artifact and migration identity and rejects mixed or malformed evidence',t=>{
 const f=setup(t),r=plain(f.release().release);
 for(const mutate of [
  r=>r.version='3.0.0',r=>r.manifest.version='3.0.0',r=>r.manifest.artifactFromVersion='0.9.0',r=>r.manifest.artifactSha256='0'.repeat(64),
  r=>r.manifest.files[0].sha256='0'.repeat(64),r=>r.manifest.releaseManifestSha256='0'.repeat(64),r=>r.manifest.entrypoint='server/other.mjs',
  r=>r.manifest.type='app',r=>r.manifest.packageKey='frm_other',r=>r.artifact.packageKey='frm_other',r=>r.artifact.packageType='app_update',
  r=>r.artifact.version='3.0.0',r=>r.artifact.fromVersion='0.9.0',r=>r.artifact.size='1',r=>r.artifact.sha256='0'.repeat(64),r=>r.artifact.manifestSha256='0'.repeat(64),
  r=>r.artifact.integrity.archive_sha256='0'.repeat(64),r=>r.artifact.integrity.archive_size='1',r=>r.artifact.integrity.release_manifest_sha256='0'.repeat(64),
  r=>r.artifact.integrity.from_version='0.9.0',r=>r.artifact.integrity.version='3.0.0',r=>r.artifact.integrity.package_key='frm_other',
  r=>r.artifact.integrity.archive_size=123,r=>r.artifact.integrity.archive_size='01',r=>r.artifact.integrity.archive_size='2147483649',
  r=>r.artifact.integrity.signature='pretend',r=>r.artifact.integrity.algorithm='none',r=>r.artifact.integrity.key_id='none',r=>r.artifact.integrity.payload='pretend',
  r=>r.artifact.signatureEnvelope=f.release().release.artifact.signatureEnvelope,r=>delete r.artifact.integrity,
  r=>r.artifact.downloadUrl='https://evil.example/file',r=>r.migrations=[{id:'20261101000000_test',order:0,kind:'database',path:'migrations/20261101000000_test.sql',sha256:hash('sql'),transactional:false,reversible:true}],
 ]){const changed=structuredClone(r);mutate(changed);assert.throws(()=>verifyNativeRelease(f.product,changed),mutate.toString())}
 const sql='ALTER TABLE fixture ADD value INT;',migration={id:'20261101000000_test',order:0,kind:'database',path:'migrations/20261101000000_test.sql',sha256:hash(sql),transactional:false,reversible:true};
 const migrated=plain(f.release(undefined,'2.0.0','1.0.0',{'server/main.mjs':'export{}',[migration.path]:sql},{migrations:[migration]}).release);
 assert.equal(verifyNativeRelease(f.product,migrated).migrations.length,1);migrated.migrations=[];
 assert.throws(()=>verifyNativeRelease(f.product,migrated),/RELEASE_IDENTITY_MISMATCH/);
});

test('explicit initial/local v2 records are plain; v1 records always require their valid signature',t=>{
 const f=setup(t),signed=f.release(undefined,'1.0.0','0.0.0').release,initial=offline(plain(signed),'initial'),local=offline(plain(f.release().release),'local');
 assert.equal(verifyNativeInitialRelease(f.product,initial).format,'qicore-initial-release-v2');
 assert.equal(verifyNativeLocalRelease(f.product,local).format,'qicore-local-release-v2');
 for(const r of [initial,local]){assert.deepEqual(verifyNativeStoredRelease(f.product,r),r);assert.throws(()=>verifyNativeRelease(f.product,r))}
 assert.throws(()=>verifyNativeInitialRelease(f.product,{...initial,format:'qicore-initial-release-v1'}));
 assert.throws(()=>verifyNativeLocalRelease(f.product,{...local,format:'qicore-local-release-v1'}));
 assert.throws(()=>verifyNativeInitialRelease(f.product,{...initialRelease(signed),format:'qicore-initial-release-v2'}));
 assert.throws(()=>verifyNativeLocalRelease(f.product,offline(plain(signed),'local')),/LOCAL_UPDATE_VERSION_INVALID/);
 assert.throws(()=>verifyNativeInitialRelease(f.product,offline(plain(f.release().release),'initial')),/INITIAL_RELEASE_REQUIRED/);
 const historical=[signed,initialRelease(signed),{...initialRelease(f.release().release),format:'qicore-local-release-v1'}];
 for(const r of historical){
  assert.deepEqual(verifyNativeStoredRelease(f.product,r),r);
  const broken=structuredClone(r);broken.artifact.signatureEnvelope.signature=Buffer.alloc(64).toString('base64url');
  assert.throws(()=>verifyNativeStoredRelease(f.product,broken),/RELEASE_SIGNATURE_INVALID/);
  delete broken.artifact.signatureEnvelope;assert.throws(()=>verifyNativeStoredRelease(f.product,broken));
 }
});

test('v3 capability still requires a signed scoped authorization plan and accepts valid historical signed releases',async t=>{
 const f=setup(t),installed=[{packageKey:QICORE_FRAMEWORK_KEY,version:'1.0.0'}];let plan=f.plan(plain(f.release().release)),response;
 f.client.machine=async(route,body)=>{assert.equal(route,'updates/plan');assert.equal(body.capability,'native-full-v3');return response??{signedPlan:f.envelope(plan)}};
 assert.equal((await checkNativePlan(f.client,installed,QICORE_FRAMEWORK_KEY)).release.version,'2.0.0');
 response={signedPlan:{...f.envelope(plan),signature:'a'.repeat(86)},steps:plan.steps};await assert.rejects(checkNativePlan(f.client,installed,QICORE_FRAMEWORK_KEY));response=undefined;
 for(const mutate of [p=>p.nativeContext.capability='native-full-v1',p=>p.nativeContext.capability='native-full-v2',p=>p.nativeContext.productId='frm_other',p=>p.nativeContext.domain='wrong.example',p=>p.nativeContext.installed=[],p=>p.licenseRevision=2]){
  plan=f.plan(plain(f.release().release));mutate(plan);await assert.rejects(checkNativePlan(f.client,installed,QICORE_FRAMEWORK_KEY));
 }
 plan=f.plan(f.release().release);assert.ok((await checkNativePlan(f.client,installed,QICORE_FRAMEWORK_KEY)).release.artifact.signatureEnvelope);
});

test('other applications remain signed under lifecycle v2 and cannot use the framework integrity branch',async t=>{
 const f=setup(t),installed=[{packageKey:QICORE_FRAMEWORK_KEY,version:'1.0.0'}],release=f.release('app_fixture','1.0.0','0.0.0').release;
 const {protocol,key_id,planId,licenseId,licenseRevision,instanceId,generatedAt,validUntil}=f.plan(null);
 const plan={protocol,key_id,planId,licenseId,licenseRevision,instanceId,generatedAt,validUntil,capability:'native-lifecycle-v2',operation:'install',productId:QICORE_FRAMEWORK_KEY,domain:f.client.domain,packageKey:'app_fixture',installed,release};
 f.client.machine=async(route,body)=>{assert.equal(route,'updates/lifecycle/plan');assert.equal(body.capability,'native-lifecycle-v2');return{signedPlan:f.envelope(plan)}};
 assert.ok((await checkNativeOperation(f.client,installed,'app_fixture','install')).release.artifact.signatureEnvelope);
 plan.release=plain(release);await assert.rejects(checkNativeOperation(f.client,installed,'app_fixture','install'));
});

test('plain archives retain HTTPS download grants, archive size/hash and extracted file checks',async t=>{
 const f=setup(t),candidate=f.release(),release=plain(candidate.release),archive=join(f.root,'download.zip');
 f.client.machine=async()=>({accessToken:'fixture_token.'+'a'.repeat(43),expiresAt:new Date(Date.now()+50000).toISOString()});
 const transport=async(url,options)=>{assert.equal(url.protocol,'https:');assert.equal(options.redirect,'error');assert.match(options.headers.authorization,/^Bearer /);return new Response(candidate.archive,{headers:{'content-length':String(candidate.archive.length)}})};
 await downloadNativeArchive(f.client,release,'plan_fixture',archive,transport);
 await extractNativeArchive(archive,join(f.root,'candidate'),release);assert.equal(readFileSync(join(f.root,'candidate/server/main.mjs'),'utf8'),candidate.files['server/main.mjs']);
 writeFileSync(join(f.root,'candidate/server/main.mjs'),'changed');await assert.rejects(verifyNativeTree(join(f.root,'candidate'),nativeArchiveFromCatalog(release.manifest)),/LOCAL_RELEASE_MODIFIED/);
 const corrupt=Buffer.from(candidate.archive);corrupt[50]^=1;writeFileSync(archive,corrupt);await assert.rejects(extractNativeArchive(archive,join(f.root,'corrupt'),release),/ARCHIVE_DIGEST_MISMATCH/);
 await assert.rejects(downloadNativeArchive(f.client,release,'plan_fixture',join(f.root,'corrupt.zip'),async()=>new Response(corrupt,{headers:{'content-length':String(corrupt.length)}})),/ARCHIVE_DIGEST_MISMATCH/);
});

test('plain initial and local slots persist health receipts and current-only cleanup without archive release keys',async t=>{
 const f=setup(t),key=QICORE_FRAMEWORK_KEY,before=f.release(key,'1.0.0','0.0.0');before.release=offline(plain(before.release),'initial');
 f.product.archiveReleaseKeys={};await f.install(before);const old=f.state.active(key).current;
 const candidate=f.release(key,'1.1.0'),release=offline(plain(candidate.release),'local'),archive=join(f.root,'local.zip');writeFileSync(archive,candidate.archive);
 const host={stop:async()=>{},start:async()=>{},health:async()=>{}},id=randomUUID(),effects=new NativeLocalEffects(f.state,host,f.client,key,id,release,archive);
 effects.compatibility=async()=>{};effects.maintenance=async()=>{};effects.backup=async()=>({id:'backup-'+id,sha256:'a'.repeat(64),verified:true});effects.migrate=async()=>{};
 const task=await new UpdateEngine(f.state.component(key),effects).execute(id,{packageKey:key,targetVersion:release.version,manifestSha256:release.artifact.manifestSha256});
 assert.equal(task.status,'succeeded',JSON.stringify(task));const active=await f.state.verifyCurrent(key);
 assert.equal(active.current.version,'1.1.0');assert.equal(active.previous,null);assert.equal(existsSync(f.state.path(key,old)),false);
 assert.deepEqual(f.state.release(key,active.current),release);
});

test('plain local updates preserve license gates and roll back to verified historical signed slots after failed readiness',async t=>{
 const f=setup(t),key=QICORE_FRAMEWORK_KEY,before=f.release(key,'1.0.0','0.0.0');before.release=initialRelease(before.release);await f.install(before);
 const old=structuredClone(f.state.active(key).current),candidate=f.release(key,'1.1.0'),release=offline(plain(candidate.release),'local'),archive=join(f.root,'local.zip');writeFileSync(archive,candidate.archive);
 const host={stop:async()=>{},start:async()=>{},health:async(_key,_version,digest)=>{if(digest===release.artifact.manifestSha256)throw Error('NEW_RUNTIME_NOT_READY')}};
 const id=randomUUID(),effects=new NativeLocalEffects(f.state,host,f.client,key,id,release,archive);
 effects.compatibility=async()=>{};effects.maintenance=async()=>{};effects.backup=async()=>({id:'backup-'+id,sha256:'a'.repeat(64),verified:true});effects.migrate=async()=>{};
 const task=await new UpdateEngine(f.state.component(key),effects).execute(id,{packageKey:key,targetVersion:release.version,manifestSha256:release.artifact.manifestSha256});
 assert.equal(task.status,'rolled_back',JSON.stringify(task));assert.deepEqual(f.state.active(key).current,old);await f.state.verifyCurrent(key);
 assert.equal(f.state.release(key,old).format,'qicore-initial-release-v1');
 f.client.componentStatus=()=>({state:'locked',updatesEligible:false});await assert.rejects(effects.authorize(),/UPDATE_NOT_ELIGIBLE/);
});
