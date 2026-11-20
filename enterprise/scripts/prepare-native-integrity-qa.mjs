import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileHash,extractNativeArchive} from '../apps/api/dist/lifecycle/native-files.js';
import {verifyNativeInitialRelease} from '../apps/api/dist/license/native-updates.js';
import {verifyBootstrapInventory} from './bootstrap-inventory.mjs';
import {prepareNativeCandidate,prepareNativeUpdateCandidate} from './customer-delivery.mjs';

// A fixed historical artifact is an input, never silently rebuilt when expired.
assert.equal(process.platform,'linux');
for(const key of ['QICORE_016_ARTIFACT_DIR','NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR'])assert.ok(process.env[key],key+' required');
const historical=resolve(process.env.QICORE_016_ARTIFACT_DIR),baseline=resolve(process.env.NATIVE_BASELINE_PACKAGE_DIR);
const files={runtime:['qicore-0.1.6-linux-x64.zip','21a1b0b24109b513286793d547154055a9c9a432db2a54efec1ea1f98ccf3e84'],bootstrap:['qicore-bootstrap-0.1.6-linux-x64.zip','24c556acb92ea3532e8c50a464419cc6e7594ba04650df774aade8955f257bc9']};
for(const [name,digest] of Object.values(files))assert.equal(await fileHash(join(historical,'qicore-native',name)),digest,'Historical artifact unavailable or changed: '+name);
const metadata=new URL('../config/release-baselines/qicore-0.1.6-initial-release.json',import.meta.url);
assert.equal(await fileHash(metadata),'08108ab3e4db830bb07db16469d6b21b949a21ef742f18cea21df61959229dc4');
const product=JSON.parse(await readFile(new URL('../config/license-product.json',import.meta.url),'utf8'));
const release=verifyNativeInitialRelease({...product,version:'0.1.6'},JSON.parse(await readFile(metadata,'utf8')));
await mkdir(baseline);await cp(metadata,join(baseline,'initial-release.json'));
await cp(join(historical,'qicore-native',files.runtime[0]),join(baseline,files.runtime[0]));
await extractNativeArchive(join(baseline,files.runtime[0]),join(baseline,'runtime'),release);
await mkdir(join(baseline,'bootstrap'));
// Digest-pinned official ZIP; no source rebuild or test signatures replace its bytes.
const unzip=spawnSync('unzip',['-q',join(historical,'qicore-native',files.bootstrap[0]),'-d',join(baseline,'bootstrap')],{encoding:'utf8'});assert.equal(unzip.status,0,unzip.stderr);
await verifyBootstrapInventory(join(baseline,'bootstrap'));
const initialReport=JSON.parse(await readFile(join(process.env.NATIVE_PACKAGE_DIR,'package-report.json'),'utf8'));
const updateReport=JSON.parse(await readFile(join(process.env.NATIVE_UPDATE_PACKAGE_DIR,'package-report.json'),'utf8'));
assert.equal(initialReport.version,'0.1.7');assert.equal(updateReport.version,'0.1.7');assert.equal(updateReport.fromVersion,'0.1.6');
for(const [dir,report,prepare] of [[process.env.NATIVE_PACKAGE_DIR,initialReport,prepareNativeCandidate],[process.env.NATIVE_UPDATE_PACKAGE_DIR,updateReport,prepareNativeUpdateCandidate]]){
 await prepare({archive:join(dir,report.archive),manifest:join(dir,'release-manifest.json'),product:new URL('../config/license-product.json',import.meta.url),releaseNotes:'隔离 Linux 普通发行材料验收，未正式发布',output:join(dir,'integrity-candidate.json')});
}
await writeFile(join(baseline,'source-report.json'),JSON.stringify({format:'qicore-baseline-qa-input-v1',sourceCommit:'7bb193bfc2a2d8e2786d01b049de4646f1e064b9',artifactId:12897510406,runId:40869724432,version:'0.1.6',runtimeSha256:files.runtime[1],bootstrapSha256:files.bootstrap[1],releaseMetadataSha256:'08108ab3e4db830bb07db16469d6b21b949a21ef742f18cea21df61959229dc4',originalRuntimeBytes:true,originalBootstrapBytes:true,originalReleaseSignature:true,customerArchiveRecreated:false},null,2)+'\n');
