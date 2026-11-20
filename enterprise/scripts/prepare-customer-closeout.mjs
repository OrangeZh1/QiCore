import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile,mkdir,cp,lstat} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalJson} from '../apps/api/dist/license/contracts.js';
import {nativeArchiveManifestSchema,nativeArchiveFromCatalog} from '../apps/api/dist/license/native-release.js';
import {sha256,verifyNativeInitialRelease,verifyNativeLocalRelease} from '../apps/api/dist/license/native-updates.js';
import {fileHash,extractNativeArchive,noLinks} from '../apps/api/dist/lifecycle/native-files.js';
import {verifyBootstrapInventory} from './bootstrap-inventory.mjs';
import {buildCustomerDelivery} from './customer-delivery.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const inside=(parent,child)=>{const p=relative(parent,child);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)};
const inputNames=['QICORE_016_ARTIFACT_DIR','QICORE_017_ARTIFACT_DIR','QICORE_017_REPORT_DIR','QICORE_PHOTO_INPUT_DIR'];
const outputNames=['NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','QICORE_CUSTOMER_OUTPUT_DIR','QICORE_DELIVERY_REPORT_DIR'];

// Standard-library ZIP inspection is issuer-side only; no downloaded code is executed.
function inspectZip(file,manifestName,destination=''){
 const script=String.raw`import sys,json,zipfile,pathlib,hashlib,stat
archive,manifest_name,destination=sys.argv[1:]
with zipfile.ZipFile(archive) as z:
 raw=z.read(manifest_name);manifest=json.loads(raw);expected={f['path']:f for f in manifest['files']};names=z.namelist()
 if len(expected)!=len(manifest['files']) or len(names)!=len(set(n.lower() for n in names)) or set(names)!=set(expected)|{manifest_name}: raise ValueError('ZIP_INVENTORY_MISMATCH')
 for item in z.infolist():
  name=item.filename
  if pathlib.PurePosixPath(name).is_absolute() or '\\' in name or ':' in name or any(p in ('','.', '..') for p in name.split('/')) or stat.S_ISLNK(item.external_attr>>16) or item.flag_bits&1: raise ValueError('ZIP_PATH_UNSAFE')
  data=z.read(item)
  if name!=manifest_name:
   f=expected[name]
   if len(data)!=f['size'] or hashlib.sha256(data).hexdigest()!=f['sha256']: raise ValueError('ZIP_FILE_CHANGED')
  if destination:
   target=pathlib.Path(destination)/name;target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as output: output.write(data)
 sys.stdout.buffer.write(raw)
`;
 const result=spawnSync(process.platform==='win32'?'python':'python3',['-c',script,file,manifestName,destination],{windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
 if(result.status!==0)throw Error('CLOSEOUT_ZIP_INVALID: '+String(result.stderr).slice(-1500));
 return {raw:result.stdout,manifest:JSON.parse(result.stdout.toString('utf8'))};
}

export async function prepareCustomerCloseout(options=process.env, historicalSource=repo){
 const paths={};
 for(const name of [...inputNames,...outputNames]){
  const value=options[name];if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value)||!isAbsolute(value))throw Error(name+'_REQUIRED');
  paths[name]=resolve(value);noLinks(paths[name]);
 }
 const inputs=inputNames.map(n=>paths[n]),outputs=outputNames.map(n=>paths[n]);
 if(outputs.some((p,i)=>inside(repo,p)||inputs.some(q=>inside(p,q)||inside(q,p))||outputs.some((q,j)=>i!==j&&(inside(p,q)||inside(q,p)))))throw Error('CLOSEOUT_PATHS_OVERLAP');
 for(const p of outputs){const existing=await lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(existing)throw Error('CLOSEOUT_OUTPUT_EXISTS')}
 const spec=await json(join(historicalSource,'config/customer-closeout-0.1.7.json')),guide=join(historicalSource,spec.guide);
 assert.equal(spec.version,'0.1.7');assert.equal(spec.packageKey,'frm_cdm43f43e7yhk5jd');assert.equal(await fileHash(guide),spec.guideSha256,'CUSTOMER_GUIDE_CHANGED');
 const initialInput=join(paths.QICORE_017_ARTIFACT_DIR,'qicore-017-initial'),updateInput=join(paths.QICORE_017_ARTIFACT_DIR,'qicore-017-update');
 const selected={oldRuntime:join(paths.QICORE_016_ARTIFACT_DIR,'qicore-native',spec.pins.oldRuntime.file),oldBootstrap:join(paths.QICORE_016_ARTIFACT_DIR,'qicore-native',spec.pins.oldBootstrap.file),initialRuntime:join(initialInput,spec.pins.initialRuntime.file),newBootstrap:join(initialInput,spec.pins.newBootstrap.file),updateRuntime:join(updateInput,spec.pins.updateRuntime.file),photo016:join(paths.QICORE_PHOTO_INPUT_DIR,spec.pins.photo016.file),photo017:join(paths.QICORE_PHOTO_INPUT_DIR,spec.pins.photo017.file)};
 for(const [name,file] of Object.entries(selected)){
  noLinks(file);const info=await lstat(file),pin=spec.pins[name];if(!info.isFile()||info.nlink!==1||info.size!==pin.bytes||await fileHash(file)!==pin.sha256)throw Error('PINNED_ARTIFACT_MISMATCH: '+name);
 }
 const product=await json(join(repo,'config/license-product.json')),oldMetadata=join(repo,spec.historicalMetadata.file);
 assert.equal(await fileHash(oldMetadata),spec.historicalMetadata.sha256,'HISTORICAL_METADATA_CHANGED');
 const oldRelease=verifyNativeInitialRelease({...product,version:'0.1.6'},await json(oldMetadata));assert.equal(oldRelease.artifact.sha256,spec.pins.oldRuntime.sha256);
 const candidate=await json(join(initialInput,'integrity-candidate.json')),upgrade=await json(join(updateInput,'integrity-candidate.json'));
 const sourceMetadataHashes={initial:await fileHash(join(initialInput,'integrity-candidate.json')),update:await fileHash(join(updateInput,'integrity-candidate.json'))};
 const initial=verifyNativeInitialRelease({...product,version:spec.version},candidate.initialRelease),local=verifyNativeLocalRelease({...product,version:spec.version},upgrade.localRelease);
 for(const [value,release,pin] of [[candidate,initial,spec.pins.initialRuntime],[upgrade,local,spec.pins.updateRuntime]]){
  assert.equal(value.sha256,pin.sha256);assert.equal(value.size,String(pin.bytes));assert.equal(release.artifact.sha256,pin.sha256);assert.equal(release.artifact.size,String(pin.bytes));
  assert.equal(canonicalJson(JSON.parse(value.fields.manifest)),canonicalJson(release.manifest));assert.equal(value.fields.releaseManifest,canonicalJson(nativeArchiveFromCatalog(release.manifest))+'\n');
 }
 assert.equal(local.artifact.fromVersion,'0.1.6');assert.equal(initial.version,spec.version);assert.equal(local.version,spec.version);
 const bootstrapReport=await json(join(paths.QICORE_017_REPORT_DIR,'qicore-017-initial/bootstrap-report.json'));
 assert.equal(bootstrapReport.sha256,spec.pins.newBootstrap.sha256);assert.equal(bootstrapReport.version,spec.version);assert.equal(bootstrapReport.initialReleaseFormat,initial.format);
 const photos={};for(const [name,version,from] of [['photo016','0.1.6','0.1.5'],['photo017','0.1.7','0.1.6']]){
  const parsed=inspectZip(selected[name],'release-manifest.json'),m=nativeArchiveManifestSchema.parse(parsed.manifest);
  assert.equal(m.package_key,spec.applicationKey);assert.equal(m.package_type,'app_update');assert.equal(m.version,version);assert.equal(m.from_version,from);assert.equal(m.framework.packageKey,spec.packageKey);
  assert.equal(m.framework.range,version==='0.1.6'?'>=0.1.3 <=0.1.6':'>=0.1.3 <=0.1.7');
  photos[name]={archive:selected[name],sha256:spec.pins[name].sha256,version,fromVersion:from,manifestSha256:sha256(parsed.raw),files:m.files.length,migrations:m.migrations};
 }
 assert.equal(canonicalJson(photos.photo016.migrations),canonicalJson(photos.photo017.migrations),'APPLICATION_MIGRATIONS_CHANGED');
 for(const p of outputs.filter(p=>p!==paths.QICORE_CUSTOMER_OUTPUT_DIR))await mkdir(p,{recursive:true});
 async function runtime(source,out,release){
  const archive=join(out,release===oldRelease?spec.pins.oldRuntime.file:spec.pins.initialRuntime.file);await cp(source,archive,{errorOnExist:true,force:false});
  await extractNativeArchive(archive,join(out,'runtime'),release);
  const raw=canonicalJson(nativeArchiveFromCatalog(release.manifest))+'\n';await writeFile(join(out,'release-manifest.json'),raw,{flag:'wx'});
  await save(join(out,'package-report.json'),{version:release.version,fromVersion:release.artifact.fromVersion,archive:spec.pins.initialRuntime.file.replace('0.1.7',release.version),archiveBytes:Number(release.artifact.size),sha256:release.artifact.sha256,manifestSha256:release.artifact.manifestSha256,files:release.manifest.files.length,preparedFromPinnedArchive:true});
  return archive;
 }
 const oldArchive=await runtime(selected.oldRuntime,paths.NATIVE_BASELINE_PACKAGE_DIR,oldRelease);await cp(oldMetadata,join(paths.NATIVE_BASELINE_PACKAGE_DIR,'initial-release.json'),{errorOnExist:true,force:false});
 const initialArchive=await runtime(selected.initialRuntime,paths.NATIVE_PACKAGE_DIR,initial),updateArchive=await runtime(selected.updateRuntime,paths.NATIVE_UPDATE_PACKAGE_DIR,local);
 for(const [source,out,version] of [[selected.oldBootstrap,paths.NATIVE_BASELINE_PACKAGE_DIR,'0.1.6'],[selected.newBootstrap,paths.NATIVE_PACKAGE_DIR,spec.version]]){
  const inspected=inspectZip(source,'bootstrap-manifest.json',join(out,'bootstrap'));assert.equal(inspected.manifest.version,version);await verifyBootstrapInventory(join(out,'bootstrap'));
  if(version===spec.version)assert.equal(sha256(inspected.raw),bootstrapReport.manifestSha256);
  await cp(source,join(out,spec.pins.newBootstrap.file.replace('0.1.7',version)),{errorOnExist:true,force:false});
 }
 // Only output copies are relocated. The downloaded metadata, ZIP bytes and file manifests stay immutable.
 candidate.archive=initialArchive;candidate.initialRelease.releaseNotes=spec.releaseNotes;candidate.fields.releaseNotes=spec.releaseNotes;
 verifyNativeInitialRelease({...product,version:spec.version},candidate.initialRelease);upgrade.archive=updateArchive;
 await save(join(paths.NATIVE_PACKAGE_DIR,'integrity-candidate.json'),candidate);await save(join(paths.NATIVE_PACKAGE_DIR,'initial-release.json'),candidate.initialRelease);await save(join(paths.NATIVE_PACKAGE_DIR,'bootstrap-report.json'),bootstrapReport);
 await save(join(paths.NATIVE_UPDATE_PACKAGE_DIR,'integrity-candidate.json'),upgrade);await save(join(paths.NATIVE_UPDATE_PACKAGE_DIR,'local-release.json'),local);
 await mkdir(dirname(paths.QICORE_CUSTOMER_OUTPUT_DIR),{recursive:true});
 const customer=await buildCustomerDelivery({candidate:join(paths.NATIVE_PACKAGE_DIR,'integrity-candidate.json'),product:join(repo,'config/license-product.json'),runtime:initialArchive,bootstrap:selected.newBootstrap,bootstrapReport:join(paths.NATIVE_PACKAGE_DIR,'bootstrap-report.json'),guide,runtimeUser:'www',output:paths.QICORE_CUSTOMER_OUTPUT_DIR});
 const customerPath=join(paths.QICORE_CUSTOMER_OUTPUT_DIR,customer.archive),report={format:'qicore-customer-closeout-preparation-v1',status:'prepared-awaiting-full-web-and-combination-acceptance',version:spec.version,sourceArtifacts:spec.artifacts,inputs:Object.fromEntries(Object.entries(selected).map(([name,path])=>[name,{path,...spec.pins[name]}])),outputs:paths,sourceMetadataHashes,customerNotesChangedOnly:true,guideSha256:spec.guideSha256,historicalFrameworkSignatureVerified:true,applicationArchiveSignaturesVerified:false,applicationSignatures:'Dedicated combination acceptance must verify application releases; this helper neither signs nor bypasses signatures.',applications:photos,customer:{...customer,archivePath:customerPath,bytes:(await lstat(customerPath)).size,formalPublication:false,fullWebAcceptance:false},runtimeRebuilt:false,oldArchive,selectedTransitionBootstrapSha256:spec.pins.newBootstrap.sha256,otherBootstrapUsed:false};
 await save(join(paths.QICORE_DELIVERY_REPORT_DIR,'prepare-report.json'),report);
 if(options.GITHUB_ENV){noLinks(options.GITHUB_ENV);const info=await lstat(options.GITHUB_ENV);if(!info.isFile()||info.nlink!==1)throw Error('GITHUB_ENV_INVALID');
  const values={QICORE_CUSTOMER_INSTALL_ZIP:customerPath,QICORE_CUSTOMER_INSTALL_SHA256:customer.sha256,QICORE_PHOTO_016_ZIP:selected.photo016,QICORE_PHOTO_017_ZIP:selected.photo017};
  if(Object.values(values).some(value=>/[\x00-\x1f\x7f]/.test(value)))throw Error('GITHUB_ENV_VALUE_INVALID');await appendFile(options.GITHUB_ENV,Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n');
 }
 return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await prepareCustomerCloseout()));
