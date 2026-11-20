import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,zip,hash} from './fixtures/native-release.mjs';
import {nativeArchiveFromCatalog} from '../dist/license/native-release.js';
import {prepareNativeCandidate,buildCustomerDelivery} from '../../../scripts/customer-delivery.mjs';
import {extractCustomerInstallZip} from './fixtures/customer-install-package.mjs';

test('the exact bundled customer ZIP is validated and retained unchanged for browser acceptance',{timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-customer-web-input-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{initial:true,version:'0.1.0',frameworkKey:'frm_cdm43f43e7yhk5jd'});
 const source=f.release(f.product.appKey,'0.1.0','0.0.0',{'server/main.mjs':'export const ready=true','config/license-product.json':JSON.stringify(f.product)});
 const input={archive:join(root,'runtime.zip'),manifest:join(root,'release-manifest.json'),product:join(root,'product.json'),output:join(root,'candidate.json'),releaseNotes:'隔离首装输入测试'};
 for(const [path,bytes] of [[input.archive,source.archive],[input.manifest,JSON.stringify(nativeArchiveFromCatalog(source.release.manifest))],[input.product,JSON.stringify(f.product)]])await writeFile(path,bytes);
 await prepareNativeCandidate(input);
 const files=[{path:'start.mjs',data:'// fixture entry'},{path:'controller.mjs',data:'// fixture controller'}];
 const manifest={format:'qicore-bootstrap-v1',product:'qicore',packageKey:f.product.appKey,version:'0.1.0',initialReleaseFormat:'qicore-initial-release-v2',updatePlanCapability:'native-full-v3',applicationLifecycleCapability:'native-lifecycle-v2',files:files.map(file=>({path:file.path,size:Buffer.byteLength(file.data),sha256:hash(file.data)}))};
 const bootstrap=zip([...files,{path:'bootstrap-manifest.json',data:JSON.stringify(manifest)}]),bootstrapFile=join(root,'bootstrap.zip'),reportFile=join(root,'bootstrap-report.json');
 await writeFile(bootstrapFile,bootstrap);await writeFile(reportFile,JSON.stringify({version:'0.1.0',initialReleaseFormat:'qicore-initial-release-v2',sha256:hash(bootstrap)}));
 const output=join(root,'delivery'),report=await buildCustomerDelivery({candidate:input.output,product:input.product,runtime:input.archive,bootstrap:bootstrapFile,bootstrapReport:reportFile,output});
 const archive=join(output,report.archive),extracted=await extractCustomerInstallZip(archive,report.sha256,join(root,'extracted'));
 assert.equal(extracted.release.format,'qicore-initial-release-v2');assert.equal(extracted.release.artifact.sha256,hash(source.archive));assert.deepEqual(await readFile(extracted.runtime),source.archive);
 await extracted.verifyUnchanged();assert.equal(hash(await readFile(archive)),report.sha256);
 await assert.rejects(extractCustomerInstallZip(archive,'0'.repeat(64),join(root,'wrong-pin')),/DIGEST_MISMATCH/);
 const entries=[];async function collect(dir,prefix=''){for(const name of await readdir(dir)){const path=join(dir,name);if((await lstat(path)).isDirectory())await collect(path,prefix+name+'/');else entries.push({path:prefix+name,data:await readFile(path)})}}await collect(extracted.root);
 const cases=[
  {change:d=>d.runtimeUser='root',reject:/CUSTOMER_RUNTIME_USER_REQUIRED/},
  {change:d=>d.format='wrong-format',reject:e=>e.issues?.some(issue=>issue.path[0]==='format')},
  {change:d=>d.privateRoot='relative/path',reject:e=>e.issues?.some(issue=>issue.path[0]==='privateRoot')},
  {change:d=>d.runtimeUser='bad user',reject:e=>e.issues?.some(issue=>issue.path[0]==='runtimeUser')},
  {change:d=>d.extra='unknown',reject:e=>e.issues?.some(issue=>issue.code==='unrecognized_keys')},
 ];
 for(const [index,scenario] of cases.entries()){
  const changed=entries.map(entry=>({...entry})),delivery=JSON.parse(changed.find(entry=>entry.path==='bootstrap/delivery.json').data);scenario.change(delivery);
  const bytes=Buffer.from(JSON.stringify(delivery));changed.find(entry=>entry.path==='bootstrap/delivery.json').data=bytes;
  const declared=JSON.parse(changed.find(entry=>entry.path==='bootstrap/bootstrap-manifest.json').data),file=declared.files.find(file=>file.path==='delivery.json');file.size=bytes.length;file.sha256=hash(bytes);
  changed.find(entry=>entry.path==='bootstrap/bootstrap-manifest.json').data=JSON.stringify(declared);
  const badZip=zip(changed),path=join(root,'bad-delivery-'+index+'.zip');await writeFile(path,badZip);
  await assert.rejects(extractCustomerInstallZip(path,hash(badZip),join(root,'bad-delivery-'+index)),scenario.reject);
 }
 for(const [index,patch] of [{updatePlanCapability:'native-full-v1'},{updatePlanCapability:'native-full-v2'},{applicationLifecycleCapability:'native-lifecycle-v1'},{applicationLifecycleCapability:undefined}].entries()){
  const changed=entries.map(entry=>({...entry})),declaration=JSON.parse(changed.find(entry=>entry.path==='bootstrap/bootstrap-manifest.json').data);
  Object.assign(declaration,patch);changed.find(entry=>entry.path==='bootstrap/bootstrap-manifest.json').data=JSON.stringify(declaration);
  const badCapability=zip(changed),badCapabilityFile=join(root,'bad-capability-'+index+'.zip');await writeFile(badCapabilityFile,badCapability);
  await assert.rejects(extractCustomerInstallZip(badCapabilityFile,hash(badCapability),join(root,'bad-capability-'+index)),/CUSTOMER_BOOTSTRAP_CAPABILITY_REQUIRED/);
 }
 await mkdir(join(extracted.root,'.well-known'));await extracted.verifyUnchanged();
 for(const file of ['identity.json','.well-known/qilicense-challenge']){
  await writeFile(join(extracted.root,file),'unexpected private data');await assert.rejects(extracted.verifyUnchanged(),/CUSTOMER_FILE_INVENTORY_CHANGED/);await rm(join(extracted.root,file));
 }
 const guide=await readFile(join(extracted.root,'INSTALL.md'));await rm(join(extracted.root,'INSTALL.md'));await assert.rejects(extracted.verifyUnchanged(),/CUSTOMER_FILE_INVENTORY_CHANGED/);await writeFile(join(extracted.root,'INSTALL.md'),guide);
 await extracted.verifyUnchanged();
 await writeFile(join(extracted.bootstrap,'controller.mjs'),'changed code');await assert.rejects(extracted.verifyUnchanged(),/BOOTSTRAP_/);
});

test('customer ZIP input rejects traversal, links, private files and case-folded duplicates before use',{timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-customer-unsafe-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const cases=[
  [{path:'../escape',data:'x'}],
  [{path:'bootstrap/link',data:'elsewhere',mode:0o120777}],
  [{path:'bootstrap/.env',data:'secret'}],
  [{path:'INSTALL.md',data:'guide'},{path:'install.md',data:'other'}],
  [{path:'unexplained.txt',data:'other'}],
 ];
 for(const [i,entries] of cases.entries()){
  const bytes=zip(entries),path=join(root,'unsafe-'+i+'.zip');await writeFile(path,bytes);
  await assert.rejects(extractCustomerInstallZip(path,hash(bytes),join(root,'extracted-'+i)),/CUSTOMER_ZIP_|invalid relative path/);
 }
});
