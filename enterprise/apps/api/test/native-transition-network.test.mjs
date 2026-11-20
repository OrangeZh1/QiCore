import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/native-release.mjs';

test('the Linux transition network fixture binds v2/v3 plans and rejects legacy consumers of plain releases',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-transition-network-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:'frm_cdm43f43e7yhk5jd'}),installed=[{packageKey:f.product.appKey,version:'1.0.0'}],release=f.release().release;
 delete release.artifact.signatureEnvelope;release.artifact.integrity={format:'qicore-release-integrity-v1'};
 const plans=Object.fromEntries(['native-full-v2','native-full-v3'].map(capability=>[capability,f.envelope(f.plan(release,installed,f.product.appKey,capability))]));
 const file=join(root,'network.json');await writeFile(file,JSON.stringify({instanceId:f.client.identity().instanceId,publicKey:f.client.identity().publicKey,product:f.product,installed,release,plans}));
 const source=`
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
await import(${JSON.stringify(new URL('./fixtures/native-transition-network.mjs',import.meta.url).href)});
const {LicenseClient}=await import(${JSON.stringify(new URL('../dist/license/client.js',import.meta.url).href)});
const {StateStore}=await import(${JSON.stringify(new URL('../dist/license/store.js',import.meta.url).href)});
const data=JSON.parse(readFileSync(process.env.QICORE_TRANSITION_NETWORK_FILE,'utf8'));let observed;
const transport=async(...args)=>{const response=await fetch(...args);observed={status:response.status,body:await response.clone().json()};return response};
const client=new LicenseClient(new StateStore(${JSON.stringify(f.client.store.root)}),data.product,'127.0.0.1',transport,true);
const request=capability=>client.machine('updates/plan',{protocol:'license-api-v2',installed:data.installed,targetPackageKeys:[data.product.appKey],capability});
for(const cap of ['native-full-v2','native-full-v3']){const response=await request(cap);assert.equal(client.verifyEnvelope(response.signedPlan).nativeContext.capability,cap);assert.equal(observed.status,200)}
await assert.rejects(request('native-full-v1'));assert.equal(observed.status,409);assert.equal(observed.body.code,'NATIVE_UPDATER_TRANSITION_REQUIRED');
data.release.artifact.integrity.format='id-photo-release-integrity-v1';writeFileSync(process.env.QICORE_TRANSITION_NETWORK_FILE,JSON.stringify(data));
await assert.rejects(request('native-full-v2'));assert.equal(observed.status,409);assert.equal(observed.body.code,'NATIVE_UPDATER_TRANSITION_REQUIRED');
`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{env:{...process.env,QICORE_TRANSITION_NETWORK_FILE:file},encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr);
});
