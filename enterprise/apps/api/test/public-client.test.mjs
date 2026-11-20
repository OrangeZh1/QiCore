import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setApplicationDefinitions} from '../dist/applications/catalog-state.mjs';
import {basicDecoration} from '../dist/core/decoration-contract.mjs';
import {TenantDecoration} from '../dist/core/tenant-decoration.mjs';
import {Recharge,rechargeDefaults} from '../dist/core/recharge.mjs';

setApplicationDefinitions([{key:'guest-fixture',decoration:{...basicDecoration,member(){throw Error('private member read')},publicContent:async()=>({components:[],targets:[],applicationData:{label:'public'}})}}]);

test('guest presentation verifies the bound application and never reads private member data',async()=>{
 const service=Object.create(TenantDecoration.prototype),checks=[];
 service.apps={async available(tenant,key){checks.push([tenant,key]);if(tenant!=='allowed'||key!=='guest-fixture')throw Error('forbidden')}};
 service.db={tenantConsumerSetting:{findUnique:async()=>null},tenantDecoration:{findUnique:async()=>null}};
 const input={tenantId:'allowed',applicationKey:'guest-fixture'},value=await service.publicView(input);
 assert.equal(value.member,null);assert.equal(value.profile,null);assert.deepEqual(value.applicationData,{label:'public'});assert.equal(checks.length,2);
 await assert.rejects(service.publicView({...input,tenantId:'another'}),/forbidden/);
 await assert.rejects(service.publicView({...input,userId:'injected'}));
 await assert.rejects(service.publicImage(input,'unpublished-private-image'));
});
test('guest recharge catalog exposes only enabled offers without reading a wallet',async()=>{
 const service=Object.create(Recharge.prototype),config=rechargeDefaults();
 config.points=[{id:'a',enabled:true,sort:1,priceCents:100,points:10},{id:'b',enabled:false,sort:0,priceCents:200,points:20}];
 service.apps={async available(tenant,key){assert.equal(tenant,'allowed');assert.equal(key,'guest-fixture')}};
 service.db={rechargeSetting:{findUnique:async()=>({version:3,config})}};
 const result=await service.publicCatalog({tenantId:'allowed',applicationKey:'guest-fixture'});
 assert.deepEqual(result.points.map(v=>v.id),['a']);assert.equal(result.version,3);assert.equal(result.wallet,undefined);
 await assert.rejects(service.publicCatalog({tenantId:'allowed',applicationKey:'guest-fixture',userId:'injected'}));
});

test('guest presentation rechecks authorization after settings and image delivery reads',async()=>{
 const scheme=basicDecoration.defaults(),imageId='6ebd35bb-d2aa-4d2a-984e-82b5ce4495c1';scheme.home.blocks[0].imageId=imageId;
 const service=Object.create(TenantDecoration.prototype);let revoked=false,settingsReads=0;
 service.apps={async available(){if(revoked)throw Error('access revoked')}};
 service.db={tenantConsumerSetting:{findUnique:async()=>{settingsReads++;return null}},tenantDecoration:{findUnique:async()=>({published:scheme})}};
 service.storage={async imageUrls(tenant,key,ids){assert.equal(tenant,'allowed');assert.equal(key,'guest-fixture');assert.deepEqual(ids,[imageId]);assert.ok(settingsReads>0);revoked=true;return{[imageId]:'https://fixture.example/image.png'}}};
 await assert.rejects(service.publicView({tenantId:'allowed',applicationKey:'guest-fixture'}),/access revoked/);
});
