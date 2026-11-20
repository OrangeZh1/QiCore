import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalJson} from '../apps/api/dist/license/contracts.js';
import {verifyNativeStoredRelease,verifyNativeInitialRelease} from '../apps/api/dist/license/native-updates.js';
import {fileHash,noLinks} from '../apps/api/dist/lifecycle/native-files.js';
import {readPhoto017Inputs} from '../apps/api/test/fixtures/photo-017-inputs.mjs';
import {prepareNativeUpdateCandidate,buildCustomerDelivery} from './customer-delivery.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const historicalDigest='010d10691e1acfd4737aed8b2c5a38148068d047521b25f59e682e44b6073b07';
const inside=(root,path)=>{const p=relative(root,path);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)};
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const json=async file=>JSON.parse(await readFile(file,'utf8'));

// New framework packages are built by this run. Only the application ZIPs and
// historical signature are fixed inputs; no new release-signing key is used.
export async function preparePhotoIntegrityQa(env=process.env){
 const paths={};
 for(const key of ['QICORE_PHOTO_INPUT_DIR','NATIVE_PACKAGE_DIR','QICORE_CUSTOMER_OUTPUT_DIR','QICORE_DELIVERY_REPORT_DIR']){
  assert.ok(typeof env[key]==='string'&&isAbsolute(env[key])&&!/[\x00-\x1f\x7f]/.test(env[key]),key+' required');
  paths[key]=resolve(env[key]);noLinks(paths[key]);
 }
 const inputs=[paths.QICORE_PHOTO_INPUT_DIR,paths.NATIVE_PACKAGE_DIR],outputs=[paths.QICORE_CUSTOMER_OUTPUT_DIR,paths.QICORE_DELIVERY_REPORT_DIR];
 assert.ok(!outputs.some((p,i)=>inside(repo,p)||inputs.some(q=>inside(p,q)||inside(q,p))||outputs.some((q,j)=>i!==j&&(inside(p,q)||inside(q,p)))),'PHOTO_QA_PATHS_OVERLAP');
 for(const path of outputs){const info=await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e});assert.equal(info,null,'PHOTO_QA_OUTPUT_EXISTS')}
 const selected={
  QICORE_PHOTO_016_ZIP:join(paths.QICORE_PHOTO_INPUT_DIR,'id-photo-0.1.6-from-0.1.5.zip'),
  QICORE_PHOTO_017_ZIP:join(paths.QICORE_PHOTO_INPUT_DIR,'id-photo-0.1.7-from-0.1.6.zip'),
  QICORE_PHOTO_016_RELEASE:join(paths.QICORE_PHOTO_INPUT_DIR,'id-photo-0.1.6-local-release.json'),
 };
 for(const file of Object.values(selected)){noLinks(file);const info=await lstat(file);assert.ok(info.isFile()&&info.nlink===1,'PHOTO_QA_INPUT_INVALID')}
 assert.equal(await fileHash(selected.QICORE_PHOTO_016_RELEASE),historicalDigest,'HISTORICAL_PHOTO_RELEASE_CHANGED');
 const photos=await readPhoto017Inputs(selected),productPath=join(repo,'config/license-product.json'),product=await json(productPath);
 const historical=verifyNativeStoredRelease(product,await json(selected.QICORE_PHOTO_016_RELEASE));
 assert.equal(historical.format,'qicore-local-release-v1');assert.equal(historical.manifest.type,'app');
 assert.equal(historical.manifest.packageKey,photos.original.manifest.package_key);
 assert.equal(historical.artifact.sha256,photos.original.sha256);assert.equal(historical.artifact.size,String(photos.original.bytes.length));
 assert.equal(historical.artifact.manifestSha256,photos.original.manifestSha256);
 const initialPath=join(paths.NATIVE_PACKAGE_DIR,'integrity-candidate.json'),candidate=await json(initialPath);
 const initial=verifyNativeInitialRelease({...product,version:'0.1.7'},candidate.initialRelease),bootstrapReportPath=join(paths.NATIVE_PACKAGE_DIR,'bootstrap-report.json'),bootstrap=await json(bootstrapReportPath);
 assert.equal(initial.version,'0.1.7');assert.equal(bootstrap.updatePlanCapability,'native-full-v3');assert.equal(bootstrap.applicationLifecycleCapability,'native-lifecycle-v2');
 const runtimeArchive=join(paths.NATIVE_PACKAGE_DIR,'qicore-0.1.7-linux-'+initial.manifest.runtime.arch+'.zip');
 const bootstrapArchive=join(paths.NATIVE_PACKAGE_DIR,'qicore-bootstrap-0.1.7-linux-x64.zip');
 assert.equal(bootstrap.archive,'qicore-bootstrap-0.1.7-linux-x64.zip');noLinks(runtimeArchive);noLinks(bootstrapArchive);
 assert.equal(await fileHash(runtimeArchive),initial.artifact.sha256,'NEW_RUNTIME_CHANGED');
 assert.equal(await fileHash(bootstrapArchive),bootstrap.sha256,'NEW_BOOTSTRAP_CHANGED');
 const spec=await json(join(repo,'config/customer-closeout-0.1.7.json')),guide=join(repo,spec.guide);
 assert.equal(await fileHash(guide),spec.guideSha256,'CUSTOMER_GUIDE_CHANGED');
 await mkdir(paths.QICORE_DELIVERY_REPORT_DIR);
 const manifestFile=join(paths.QICORE_DELIVERY_REPORT_DIR,'photo-017-release-manifest.json');
 await writeFile(manifestFile,canonicalJson(photos.compatible.manifest)+'\n',{flag:'wx'});
 const photoCandidate=join(paths.QICORE_DELIVERY_REPORT_DIR,'photo-017-integrity-candidate.json');
 await prepareNativeUpdateCandidate({archive:selected.QICORE_PHOTO_017_ZIP,manifest:manifestFile,product:productPath,
  releaseNotes:'修复：订阅操作响应。\n\n小程序更新：需要客户自行上传',output:photoCandidate});
 const preparedPhoto=await json(photoCandidate);
 assert.equal(preparedPhoto.localRelease.artifact.integrity.format,'id-photo-release-integrity-v1');
 assert.equal(preparedPhoto.sha256,photos.compatible.sha256);
 candidate.archive=runtimeArchive;candidate.initialRelease.releaseNotes=spec.releaseNotes;candidate.fields.releaseNotes=spec.releaseNotes;
 const customerCandidate=join(paths.QICORE_DELIVERY_REPORT_DIR,'customer-initial-candidate.json');await save(customerCandidate,candidate);
 const customer=await buildCustomerDelivery({candidate:customerCandidate,product:productPath,runtime:candidate.archive,
  bootstrap:bootstrapArchive,bootstrapReport:bootstrapReportPath,guide,runtimeUser:'www',output:paths.QICORE_CUSTOMER_OUTPUT_DIR});
 const exported={...selected,QICORE_PHOTO_017_RELEASE:photoCandidate,QICORE_CUSTOMER_INSTALL_ZIP:join(paths.QICORE_CUSTOMER_OUTPUT_DIR,customer.archive),QICORE_CUSTOMER_INSTALL_SHA256:customer.sha256};
 const report={format:'qicore-photo-integrity-qa-input-v1',status:'prepared-awaiting-linux-acceptance',historicalPhotoReleaseSha256:historicalDigest,
  originalPhotoSignatureVerified:true,newPhotoReleaseSigning:false,photoArchiveRebuilt:false,
  applications:Object.fromEntries(Object.entries(photos).map(([key,value])=>[key,{path:value.path,sha256:value.sha256,manifestSha256:value.manifestSha256}])),
  sourceInitialMetadataSha256:await fileHash(initialPath),transitionBootstrapSha256:bootstrap.sha256,
  capabilities:{update:bootstrap.updatePlanCapability,lifecycle:bootstrap.applicationLifecycleCapability},outputs:exported,customer,
  formalPublication:false,productionAccess:false};
 await save(join(paths.QICORE_DELIVERY_REPORT_DIR,'prepare-report.json'),report);
 if(env.GITHUB_ENV){noLinks(env.GITHUB_ENV);const info=await lstat(env.GITHUB_ENV);assert.ok(info.isFile()&&info.nlink===1,'GITHUB_ENV_INVALID');
  assert.ok(Object.values(exported).every(value=>!/[\x00-\x1f\x7f]/.test(value)),'GITHUB_ENV_VALUE_INVALID');
  await appendFile(env.GITHUB_ENV,Object.entries(exported).map(([key,value])=>key+'='+value).join('\n')+'\n');
 }
 return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await preparePhotoIntegrityQa()));
