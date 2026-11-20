import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/native-release.mjs';
import {verifyNativeLocalRelease,verifyNativeRelease,verifyNativeStoredRelease} from '../dist/license/native-updates.js';
import {NativeLocalEffects,localUpdateReplay} from '../dist/lifecycle/native-local-update.js';
const local=release=>{const {publishedAt,...value}=release,{releaseId,downloadUrl,...artifact}=value.artifact;return{...value,format:'qicore-local-release-v1',artifact}};

test('local task replay is bound to package, version and exact signed manifest',()=>{
 const request={packageKey:'app_fixture',targetVersion:'1.0.1',manifestSha256:'a'.repeat(64)},old={id:'task',packageKey:request.packageKey,status:'succeeded',request},state={tasks:()=>[old]};
 assert.equal(localUpdateReplay(state,'task',request),old);assert.equal(localUpdateReplay(state,'new',request),undefined);
 for(const changed of [{packageKey:'frm_fixture'},{targetVersion:'1.0.2'},{manifestSha256:'b'.repeat(64)}])assert.throws(()=>localUpdateReplay(state,'task',{...request,...changed}),/REQUEST_ID_REUSED/);
});

test('local update keeps issuer verification and rejects publication use, wrong base, tampering and unauthorized updates',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-local-update-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root);
 await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 const candidate=f.release(),release=local(candidate.release),archive=join(root,'candidate.zip');writeFileSync(archive,candidate.archive);
 assert.equal(verifyNativeLocalRelease(f.product,release).version,'2.0.0');assert.equal(verifyNativeStoredRelease(f.product,release).format,'qicore-local-release-v1');assert.throws(()=>verifyNativeRelease(f.product,release));
 assert.throws(()=>verifyNativeLocalRelease(f.product,{...release,version:'3.0.0'}));
 const altered=structuredClone(release);altered.artifact.signatureEnvelope.signature='a'.repeat(86);assert.throws(()=>verifyNativeLocalRelease(f.product,altered));
 f.client.transport=async()=>{throw Error('UNEXPECTED_NETWORK')};
 const effects=new NativeLocalEffects(f.state,{},f.client,'frm_fixture',randomUUID(),release,archive),target=await effects.authorize();
 assert.equal(target.planId.startsWith('local-'),true);await effects.pull(target.to);assert.equal(existsSync(f.state.path('frm_fixture',target.to)),true);
 const wrong=f.release('frm_fixture','3.0.0','2.0.0'),wrongArchive=join(root,'wrong.zip');writeFileSync(wrongArchive,wrong.archive);
 await assert.rejects(new NativeLocalEffects(f.state,{},f.client,'frm_fixture',randomUUID(),local(wrong.release),wrongArchive).authorize(),/LOCAL_UPDATE_BASE_CHANGED/);
 writeFileSync(archive,'changed');await assert.rejects(new NativeLocalEffects(f.state,{},f.client,'frm_fixture',randomUUID(),release,archive).authorize(),/LOCAL_ARCHIVE_CHANGED/);
 f.client.componentStatus=()=>({state:'locked',updatesEligible:false});await assert.rejects(effects.authorize(),/UPDATE_NOT_ELIGIBLE/);
});
