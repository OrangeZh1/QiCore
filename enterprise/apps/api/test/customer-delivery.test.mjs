import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yauzl from 'yauzl';
import {fixture,zip,hash} from './fixtures/native-release.mjs';
import {nativeArchiveFromCatalog} from '../dist/license/native-release.js';
import {verifyNativeInitialRelease,verifyNativeRelease,verifyNativeStoredRelease} from '../dist/license/native-updates.js';
import {downloadNativeArchive} from '../dist/lifecycle/native-files.js';
import {prepareNativeCandidate,prepareNativeUpdateCandidate,signNativeCandidate,releaseFromPublished,buildCustomerDelivery} from '../../../scripts/customer-delivery.mjs';

test('retired issuer CLI commands reject before reading an input file',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-retired-issuer-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const script=fileURLToPath(new URL('../../../scripts/customer-delivery.mjs',import.meta.url));
 for(const operation of ['sign','sign-update'])for(const args of [[],[join(root,'missing-input.json')]]){
  const result=spawnSync(process.execPath,[script,operation,...args],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/RELEASE_SIGNING_REMOVED/);assert.doesNotMatch(result.stderr,/ENOENT|missing-input\.json|PRIVATE KEY/);
 }
});

test('issuer prepares only the exact photo application with its framework binding and no signing inputs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-photo-delivery-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{frameworkKey:'frm_cdm43f43e7yhk5jd',applicationPackageKey:'app_kmqjjt72urnxp526'});
 const product={...f.product,archiveReleaseKeys:undefined},range='>=0.1.3 <=0.1.7';
 const candidate=f.release('app_kmqjjt72urnxp526','0.1.7','0.1.6',{'server/main.mjs':'export const ready=true'},
  {framework:{packageKey:product.appKey,range},frameworkRange:range});
 const manifest=nativeArchiveFromCatalog(candidate.release.manifest);
 const input={archive:join(root,'application.zip'),manifest:join(root,'manifest.json'),product:join(root,'product.json'),releaseNotes:'修复：订阅操作响应',output:join(root,'fields.json')};
 for(const [file,bytes] of [[input.archive,candidate.archive],[input.manifest,JSON.stringify(manifest)],[input.product,JSON.stringify(product)]])await writeFile(file,bytes);
 await assert.rejects(prepareNativeCandidate(input),/INITIAL_FRAMEWORK_RELEASE_REQUIRED/);
 for(const field of ['keyFile','keyId','signature','signatureEnvelope'])await assert.rejects(prepareNativeUpdateCandidate({...input,[field]:'unused'}),/RELEASE_SIGNING_INPUT_REMOVED/);
 const result=await prepareNativeUpdateCandidate(input),prepared=JSON.parse(await readFile(input.output,'utf8'));
 assert.equal(result.signed,false);assert.equal(result.published,false);assert.equal(prepared.sha256,hash(candidate.archive));
 assert.deepEqual(Object.keys(prepared.fields).sort(),['manifest','releaseManifest','releaseNotes']);
 assert.equal(prepared.localRelease.format,'qicore-local-release-v2');
 assert.equal(prepared.localRelease.artifact.integrity.format,'id-photo-release-integrity-v1');
 assert.equal(prepared.localRelease.artifact.integrity.framework_package_key,product.appKey);
 assert.equal(prepared.localRelease.manifest.type,'app');assert.equal(prepared.localRelease.manifest.frameworkRange,range);
 assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE KEY|signatureEnvelope|publishedAt|releaseId|downloadUrl/);
 assert.deepEqual(verifyNativeStoredRelease(product,prepared.localRelease),prepared.localRelease);
 const row={id:'release_fixture_photo_published',status:'PUBLISHED',channel:'STABLE',deliveryKind:'ARCHIVE',publishedAt:new Date().toISOString(),
  component:{packageKey:manifest.package_key},version:manifest.version,artifactSha256:prepared.sha256,artifactSize:prepared.size,
  signature:JSON.stringify(prepared.localRelease.artifact.integrity),signatureKeyId:'',manifest:JSON.parse(prepared.fields.manifest),releaseNotes:input.releaseNotes};
 assert.equal(releaseFromPublished(row,product).artifact.integrity.framework_package_key,product.appKey);
 for(const changes of [{framework_package_key:'frm_other'},{package_key:'app_other'},{package_type:'framework_update'},{version:'0.1.8'}]){
  assert.throws(()=>releaseFromPublished({...row,signature:JSON.stringify({...prepared.localRelease.artifact.integrity,...changes})},product));
 }
 const legacy={...row,signature:JSON.stringify(candidate.release.artifact.signatureEnvelope),signatureKeyId:'application'};
 assert.equal(releaseFromPublished(legacy,f.product).artifact.signatureEnvelope.key_id,'application');
 assert.throws(()=>releaseFromPublished({...legacy,signature:JSON.stringify({...candidate.release.artifact.signatureEnvelope,signature:'invalid'})},f.product));
 for(const changed of [{...manifest,package_key:'app_other'},{...manifest,framework:{...manifest.framework,packageKey:'frm_other'}}]){
  await writeFile(input.manifest,JSON.stringify(changed));
  await assert.rejects(prepareNativeUpdateCandidate({...input,output:join(root,'invalid.json')}),/ORDINARY_RELEASE_PRODUCT_REQUIRED/);
 }
 await writeFile(input.manifest,JSON.stringify({...manifest,version:'0.1.8'}));
 await assert.rejects(prepareNativeUpdateCandidate({...input,output:join(root,'version-mismatch.json')}));
 await writeFile(input.manifest,JSON.stringify(manifest));
 await writeFile(input.archive,zip(candidate.entries.map(entry=>entry.path==='server/main.mjs'?{...entry,data:'export const tampered=true'}:entry)));
 await assert.rejects(prepareNativeUpdateCandidate({...input,output:join(root,'tampered.json')}));
});

async function zipText(bytes,name){
 const archive=await new Promise((ok,fail)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,value)=>error?fail(error):ok(value)));
 return new Promise((ok,fail)=>{archive.on('error',fail);archive.on('end',()=>ok(null));archive.on('entry',entry=>{if(entry.fileName!==name){archive.readEntry();return}archive.openReadStream(entry,(error,stream)=>{if(error){archive.close();fail(error);return}const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',fail);stream.on('end',()=>{archive.close();ok(Buffer.concat(chunks).toString('utf8'))})})});archive.readEntry()});
}

test('issuer prepares exact bytes and builds a complete first-install ZIP without publication or private keys',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-customer-delivery-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{initial:true,version:'0.1.0',frameworkKey:'frm_cdm43f43e7yhk5jd'});
 const product={...f.product,archiveReleaseKeys:undefined};
 const candidate=f.release(product.appKey,'0.1.0','0.0.0',{'server/main.mjs':'console.log("fixture")','config/license-product.json':JSON.stringify(product)});
 const input={archive:join(root,'runtime.zip'),manifest:join(root,'manifest.json'),product:join(root,'product.json'),releaseNotes:'隔离测试版本',output:join(root,'fields.json')};
 for(const [file,bytes] of [[input.archive,candidate.archive],[input.manifest,JSON.stringify(nativeArchiveFromCatalog(candidate.release.manifest))],[input.product,JSON.stringify(product)]])await writeFile(file,bytes);
 const result=await prepareNativeCandidate(input),prepared=JSON.parse(await readFile(input.output,'utf8'));assert.equal(result.published,false);assert.equal(prepared.sha256,hash(candidate.archive));assert.ok(!(await readFile(input.output,'utf8')).includes('PRIVATE KEY'));
 const initial=prepared.initialRelease;assert.equal(verifyNativeInitialRelease(product,initial).format,'qicore-initial-release-v2');assert.deepEqual(verifyNativeStoredRelease(product,initial),initial);
 assert.equal('publishedAt' in initial,false);assert.equal('releaseId' in initial.artifact,false);assert.equal('downloadUrl' in initial.artifact,false);
 assert.throws(()=>verifyNativeRelease(product,initial));
 let requested=false;await assert.rejects(downloadNativeArchive({product,machine:async()=>{requested=true}},initial,'plan_fixture',join(root,'not-downloaded.zip')));assert.equal(requested,false);
 for(const mutate of [r=>r.artifact.size='1',r=>r.manifest.files[0].sha256='0'.repeat(64),r=>r.artifact.integrity.archive_sha256='a'.repeat(64),r=>r.artifact.releaseId='invented_release',r=>r.publishedAt=new Date().toISOString(),r=>r.artifact.fromVersion='0.0.1']){
  const changed=structuredClone(initial);mutate(changed);assert.throws(()=>verifyNativeInitialRelease(product,changed));
 }
 assert.throws(()=>verifyNativeInitialRelease({...product,appKey:'frm_other'},initial),/INITIAL_RELEASE_REQUIRED/);
 await assert.rejects(signNativeCandidate({keyFile:join(root,'does-not-exist')}),/RELEASE_SIGNING_REMOVED/);
 await assert.rejects(prepareNativeCandidate({...input,keyFile:join(root,'does-not-exist')}),/RELEASE_SIGNING_INPUT_REMOVED/);
 assert.equal('signature' in prepared.fields,false);assert.equal('keyId' in prepared.fields,false);
 const row={id:'release_fixture_published',status:'PUBLISHED',channel:'STABLE',deliveryKind:'ARCHIVE',publishedAt:new Date().toISOString(),component:{packageKey:product.appKey},version:'0.1.0',artifactSha256:prepared.sha256,artifactSize:prepared.size,signature:JSON.stringify(prepared.initialRelease.artifact.integrity),signatureKeyId:'',manifest:JSON.parse(prepared.fields.manifest),releaseNotes:prepared.fields.releaseNotes};
 assert.equal(releaseFromPublished(row,product).artifact.releaseId,row.id);assert.deepEqual(releaseFromPublished(row,product).artifact.integrity,prepared.initialRelease.artifact.integrity);
 for(const signature of [undefined,null,'',' ','{bad','{}'])assert.throws(()=>releaseFromPublished({...row,signature},product));
 assert.throws(()=>releaseFromPublished({...row,signatureKeyId:'legacy'},product),/PUBLISHED_RELEASE_MISMATCH/);
 const legacy={...row,signature:JSON.stringify(candidate.release.artifact.signatureEnvelope),signatureKeyId:'framework'};assert.equal(releaseFromPublished(legacy,f.product).artifact.signatureEnvelope.key_id,'framework');
 assert.throws(()=>releaseFromPublished({...legacy,signature:JSON.stringify({...candidate.release.artifact.signatureEnvelope,signature:Buffer.alloc(64).toString('base64url')})},f.product),/SIGNATURE_INVALID/);
 assert.throws(()=>releaseFromPublished({...row,artifactSize:'1'},product),/RELEASE_IDENTITY_MISMATCH/);assert.throws(()=>releaseFromPublished({...row,status:'DRAFT'},product),/PUBLISHED_RELEASE_REQUIRED/);assert.throws(()=>releaseFromPublished({...row,artifactSha256:'0'.repeat(64)},product),/PUBLISHED_RELEASE_MISMATCH/);
 const files=[{path:'start.mjs',data:'// fixture launcher'},{path:'controller.mjs',data:'// fixture controller'}],manifest={format:'qicore-bootstrap-v1',product:'qicore',packageKey:product.appKey,updatePlanCapability:'native-full-v3',applicationLifecycleCapability:'native-lifecycle-v2',version:'0.1.0',initialReleaseFormat:initial.format,files:files.map(file=>({path:file.path,size:Buffer.byteLength(file.data),sha256:hash(file.data)}))},bootstrap=zip([...files,{path:'bootstrap-manifest.json',data:JSON.stringify(manifest)}]);
 const build={candidate:input.output,product:input.product,runtime:input.archive,bootstrap:join(root,'bootstrap.zip'),bootstrapReport:join(root,'bootstrap-report.json'),deployment:{adminOrigin:'https://customer.example'},output:join(root,'delivery'),guide:join(root,'INSTALL.md')};
 await writeFile(build.guide,'# 客户自助安装\n\n解压到指定空目录。\n');
 await writeFile(build.bootstrap,bootstrap);await writeFile(build.bootstrapReport,JSON.stringify({version:'0.1.0',sha256:hash(bootstrap)}));
 await assert.rejects(buildCustomerDelivery(build),/BOOTSTRAP_INITIAL_RELEASE_UNSUPPORTED/);
 await writeFile(build.bootstrapReport,JSON.stringify({version:'0.1.0',initialReleaseFormat:initial.format,sha256:hash(bootstrap)}));
 const receipt=await buildCustomerDelivery(build);assert.equal(receipt.qiLicensePublicationRequired,false);assert.equal(receipt.releaseFormat,initial.format);assert.equal(receipt.customerBuildRequired,false);assert.equal(receipt.sha256,hash(await readFile(join(build.output,receipt.archive))));assert.deepEqual((await readdir(build.output)).sort(),['INSTALL.md','SHA256SUMS.txt','delivery-report.json',receipt.archive].sort());
 assert.equal(await readFile(join(build.output,'INSTALL.md'),'utf8'),await readFile(build.guide,'utf8'));
 const bytes=await readFile(join(build.output,receipt.archive));assert.ok(bytes.includes(Buffer.from('incoming/release.json')));assert.ok(bytes.includes(Buffer.from('bootstrap/delivery.json')));assert.ok(!bytes.includes(Buffer.from('issuer.pem')));
 assert.equal(JSON.parse(await zipText(bytes,'bootstrap/delivery.json')).adminOrigin,undefined);
 assert.deepEqual(JSON.parse(await zipText(bytes,'deployment.json')),build.deployment);
 await assert.rejects(buildCustomerDelivery({...build,origin:'https://qicore.mcent.cn'}),/CUSTOMER_DELIVERY_ORIGIN_REMOVED/);
 const generic=await buildCustomerDelivery({...build,deployment:undefined,guide:undefined,output:join(root,'generic')}),genericBytes=await readFile(join(root,'generic',generic.archive));
 assert.equal(generic.deploymentMode,'baota-auto');assert.equal(generic.origin,null);assert.equal(await zipText(genericBytes,'deployment.json'),null);
 assert.equal(JSON.parse(await zipText(genericBytes,'bootstrap/delivery.json')).adminOrigin,undefined);
 assert.ok(!(await zipText(genericBytes,'INSTALL.md')).includes(build.deployment.adminOrigin));
 assert.ok(!(await zipText(genericBytes,'INSTALL.md')).includes('nginx.generated.conf'));
 assert.deepEqual(JSON.parse(await zipText(genericBytes,'deployment.example.json')),{adminOrigin:'https://your-domain.example',adminPort:3500,apiPort:3501,uiPort:3502});
 await writeFile(input.archive,Buffer.concat([candidate.archive,Buffer.from('tampered')]));await assert.rejects(buildCustomerDelivery({...build,output:join(root,'tampered')}),/ARCHIVE_DIGEST_MISMATCH/);
});
