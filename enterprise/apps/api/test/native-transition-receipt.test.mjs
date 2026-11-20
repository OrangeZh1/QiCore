import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './fixtures/native-release.mjs';
import {transitionReceipt} from './fixtures/native-transition-receipt.mjs';
import {LicenseClient} from '../dist/license/client.js';
test('the Linux transition receipt fixture preserves a valid signed authorization interval on every platform',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-transition-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:'frm_cdm43f43e7yhk5jd'}),before=f.client.status().receipt;
 transitionReceipt(f);const after=f.client.status().receipt;
 assert.equal(f.client.status().state,'active');assert.equal(after.refresh_after,before.online_valid_until);
 assert.equal(after.online_valid_until,before.online_valid_until);assert.equal(after.grace_until,before.grace_until);
 assert.equal(after.instance_id,before.instance_id);assert.deepEqual(after.entitlements,before.entitlements);
});
test('the privileged read-only installer cannot rewrite a runtime receipt after the watermark interval',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-transition-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:'frm_cdm43f43e7yhk5jd'});transitionReceipt(f);
 const receiptPath=join(f.client.store.root,'receipt.json'),before=await readFile(receiptPath);
 const client=new LicenseClient(f.client.store,f.product,f.client.domain,async()=>{throw Error('NO_NETWORK')},true);
 const now=Date.now;try{Date.now=()=>now()+61000;assert.equal(client.status().state,'active');assert.equal(client.componentStatus(f.product.appKey,'framework').state,'active')}finally{Date.now=now}
 assert.deepEqual(await readFile(receiptPath),before);
});
