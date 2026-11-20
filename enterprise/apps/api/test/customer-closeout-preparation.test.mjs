import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareCustomerCloseout} from '../../../scripts/prepare-customer-closeout.mjs';

async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'qicore-closeout-preflight-'));t.after(()=>rm(root,{recursive:true,force:true}));const options={};
 for(const name of ['QICORE_016_ARTIFACT_DIR','QICORE_017_ARTIFACT_DIR','QICORE_017_REPORT_DIR','QICORE_PHOTO_INPUT_DIR','NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','QICORE_CUSTOMER_OUTPUT_DIR','QICORE_DELIVERY_REPORT_DIR'])options[name]=join(root,name);
 for(const name of ['QICORE_016_ARTIFACT_DIR','QICORE_017_ARTIFACT_DIR','QICORE_017_REPORT_DIR','QICORE_PHOTO_INPUT_DIR'])await mkdir(options[name]);return{root,options};
}
test('importing closeout preparation never performs CLI work or requires CI input paths',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../../../scripts/prepare-customer-closeout.mjs',import.meta.url).href)});console.log('import-only')`],{encoding:'utf8',env:{...process.env,QICORE_016_ARTIFACT_DIR:''},windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'import-only');
});
test('closeout rejects missing paths, overlaps and existing output before materializing anything',async t=>{
 const {options}=await setup(t);await assert.rejects(prepareCustomerCloseout({}),/QICORE_016_ARTIFACT_DIR_REQUIRED/);
 await assert.rejects(prepareCustomerCloseout({...options,QICORE_PHOTO_INPUT_DIR:options.QICORE_PHOTO_INPUT_DIR+'\n'}),/QICORE_PHOTO_INPUT_DIR_REQUIRED/);
 await assert.rejects(prepareCustomerCloseout({...options,NATIVE_PACKAGE_DIR:options.QICORE_017_ARTIFACT_DIR}),/CLOSEOUT_PATHS_OVERLAP/);
 await mkdir(options.QICORE_CUSTOMER_OUTPUT_DIR);await assert.rejects(prepareCustomerCloseout(options),/CLOSEOUT_OUTPUT_EXISTS/);
 await assert.rejects(access(options.NATIVE_PACKAGE_DIR),/ENOENT/);
});
test('a wrong historical artifact is refused before any output or customer bundle exists',async t=>{
 const {options}=await setup(t),native=join(options.QICORE_016_ARTIFACT_DIR,'qicore-native');await mkdir(native);await writeFile(join(native,'qicore-0.1.6-linux-x64.zip'),'not the pinned artifact');
 // Reproduce the pin/guide boundary with disposable issuer data; a customer's release records are not test fixtures.
 const historical=join(native,'fixture-source'),guide='Test-only installation guide';
 await mkdir(join(historical,'config'),{recursive:true});await writeFile(join(historical,'guide.md'),guide);
 const pins=Object.fromEntries(['oldRuntime','oldBootstrap','initialRuntime','newBootstrap','updateRuntime','photo016','photo017'].map(name=>[name,{file:name==='oldRuntime'?'qicore-0.1.6-linux-x64.zip':name+'.zip',bytes:256,sha256:'0'.repeat(64)}]));
 await writeFile(join(historical,'config/customer-closeout-0.1.7.json'),JSON.stringify({version:'0.1.7',packageKey:'frm_cdm43f43e7yhk5jd',guide:'guide.md',guideSha256:createHash('sha256').update(guide).digest('hex'),pins}));
 await assert.rejects(prepareCustomerCloseout(options,historical),/PINNED_ARTIFACT_MISMATCH: oldRuntime/);
 for(const name of ['NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','QICORE_CUSTOMER_OUTPUT_DIR','QICORE_DELIVERY_REPORT_DIR'])await assert.rejects(access(options[name]),/ENOENT/);
});
