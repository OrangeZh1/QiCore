import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpdateService} from '../dist/lifecycle/update-service.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './fixtures/native-release.mjs';
import {TenantApplications,bindApplicationLicensing} from '../dist/applications/service.mjs';

test('real application fixtures explicitly sign a finite tenant limit while omitted limits remain unavailable',t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-fixture-quota-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const limit of [undefined,5]){
  const packageKey='app_kmqjjt72urnxp526',f=fixture(join(root,String(limit)),{applicationPackageKey:packageKey,...(limit===undefined?{}:{applicationTenantLimit:limit})});
  const receipt=f.client.verifyReceipt(f.client.store.read('receipt.json').envelope),entitlement=receipt.entitlements.find(item=>item.packageKey===packageKey);
  assert.equal(entitlement.tenantLimit,limit);assert.equal(Object.hasOwn(entitlement,'tenantLimit'),limit!==undefined);
  const db={};bindApplicationLicensing(db,{allowed:()=>true,assert(){},limit:key=>{assert.equal(key,'id-photo');return f.client.componentStatus(packageKey,'app').receipt.entitlements.find(item=>item.packageKey===packageKey).tenantLimit}});
  const applications=new TenantApplications(db);
  if(limit===undefined)assert.throws(()=>applications.licenseLimit('id-photo'),error=>error.code==='APPLICATION_LICENSE_UNAVAILABLE'&&error.status===403);
  else assert.equal(applications.licenseLimit('id-photo'),5);
 }
});

function service(limit,usage,source='native'){
 const loaded=[{key:'fixture-app',name:'Fixture',packageKey:'app_fixture',version:'1.0.0',source}];
 const entitlement={packageKey:'app_fixture',type:'app',useExpiresAt:null,updatesExpiresAt:null,...(limit===undefined?{}:{tenantLimit:limit})};
 const client={product:{appKey:'frm_fixture'},componentCatalog:async()=>({components:[],issuedAt:'2026-10-24'}),status:()=>({receipt:{entitlements:[entitlement,{...entitlement,packageKey:'app_uninstalled'}]}}),componentStatus:()=>({state:'active',updatesEligible:true})};
 return new UpdateService({client},undefined,loaded,usage);
}
test('update center returns actual occupied slots without confusing zero, unlimited or unavailable quotas',async()=>{
 for(const [limit,used,remaining] of [[5,2,3],[5,5,0],[5,7,0],[0,0,0],[null,2,null],[undefined,2,null]]){
  const result=await service(limit,async keys=>{assert.deepEqual(keys,['fixture-app']);return{'fixture-app':used}}).applications();
  const q=result.installed[0].license;assert.equal(q.tenantUsed,used);assert.equal(q.tenantRemaining,remaining);assert.equal(q.tenantLimitKnown,limit!==undefined);assert.equal(q.tenantUsageKnown,true);
  assert.equal(result.purchased[0].license.tenantUsed,null,'uninstalled retained bindings must not be guessed as zero');
 }
 for(const usage of [undefined,async()=>{throw Error('database unavailable')},async()=>({'fixture-app':NaN})]){
  const q=(await service(5,usage).applications()).installed[0].license;assert.equal(q.tenantLimit,5);assert.equal(q.tenantUsed,null);assert.equal(q.tenantUsageKnown,false);assert.equal(q.tenantRemaining,null);
 }
 const development=(await service(null,async()=>({'fixture-app':2}),'development').applications()).installed[0];assert.equal(development.update.state,'development');assert.equal(development.update.canCheck,false);
});


test('first install has zero usage while retained uninstalled identities keep their occupied slots',async()=>{
 const fresh=await service(5,async()=>({'fixture-app':2})).applications([]);
 assert.equal(fresh.purchased[0].license.tenantUsed,0);assert.equal(fresh.purchased[0].license.tenantRemaining,5);
 const retained=await service(5,async keys=>{assert.deepEqual(keys,['fixture-app','retained-app']);return{'fixture-app':2,'retained-app':3}}).applications([{packageKey:'app_uninstalled',key:'retained-app'}]);
 assert.equal(retained.purchased[0].license.tenantUsed,3);assert.equal(retained.purchased[0].license.tenantRemaining,2);
 const unavailable=await service(5,async()=>{throw Error('db unavailable')}).applications([{packageKey:'app_uninstalled',key:'retained-app'}]);
 assert.equal(unavailable.purchased[0].license.tenantUsed,null);
});


test('view reads retained application inventory once before presenting first-install quota',async t=>{
 const before=process.env.UPDATER_SOCKET;process.env.UPDATER_SOCKET='fixture.sock';t.after(()=>{if(before===undefined)delete process.env.UPDATER_SOCKET;else process.env.UPDATER_SOCKET=before});
 const s=service(5,async()=>({'fixture-app':2}));let calls=0;
 s.call=async()=>{calls++;return {kind:'native',code:'READY',applicationLifecycle:true,applicationIdentities:[],tasks:[],components:[]}};
 s.license.updateCenter=()=>({allowed:true,update:{state:'current'}});s.license.client.product.deliveryKind='archive';
 const result=await s.view();assert.equal(calls,1);assert.equal(result.applications.purchased[0].license.tenantUsed,0);assert.equal(result.applications.purchased[0].license.tenantRemaining,5);
});
