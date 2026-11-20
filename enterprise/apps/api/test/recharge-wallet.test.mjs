import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Recharge,rechargeDefaults} from '../src/core/recharge.mjs';

test('public wallet adjustments require the same site and application to save recharge settings first',async()=>{
 const scope={tenantId:'site-a',applicationKey:'app-a'},settings=new Map(),writes=[];
 const db={
  rechargeSetting:{findUnique:async({where})=>settings.get(JSON.stringify(where.tenantId_applicationKey))||null},
  consumerProfile:{count:async()=>1,findUnique:async()=>({enabled:true,deletedAt:null})},
  walletEntry:{findUnique:async()=>null},audit:{create:async()=>{}}
 };
 const service=new Recharge(db);service.apps={transaction:fn=>fn(db),admin:async()=>{}};
 service.adminContext=async(_db,_s,tenantId,applicationKey)=>({tenantId,applicationKey});
 service.wallet={
  summary:async()=>({points:{amount:20,version:1},balance:{amount:0,version:0}}),
  account:async()=>{writes.push('account');return{id:'account-a',version:1}},
  credit:async()=>{writes.push('credit');return{id:'entry-a',kind:'gift',reference:'request',delta:20n,beforeAmount:20n,afterAmount:40n,createdAt:new Date()}},
  debit:async()=>{throw Error('unexpected debit')}
 };
 const args=[{id:'admin-a'},scope.tenantId,scope.applicationKey,'user-a'];
 const before=await service.adminAssets(...args);assert.equal(before.enabled,false);assert.equal(before.assets.points.amount,20,'existing public funds remain readable');assert.deepEqual(writes,[]);
 for(const other of [{tenantId:'site-b',applicationKey:'app-a'},{tenantId:'site-a',applicationKey:'app-b'}])settings.set(JSON.stringify(other),{version:1,config:rechargeDefaults()});
 for(const kind of ['gift','adjust'])await assert.rejects(service.adminAssets(...args,{requestKey:randomUUID(),version:1,kind,amount:20,reason:'测试调整'}),{code:'WALLET_NOT_ENABLED',status:409});
 assert.deepEqual(writes,[],'blocked adjustments must not create an account or touch the ledger');assert.equal(settings.size,2,'adjusting points must not enable a legacy site');
 settings.set(JSON.stringify(scope),{version:1,config:rechargeDefaults()});
 const result=await service.adminAssets(...args,{requestKey:randomUUID(),version:1,kind:'gift',amount:20,reason:'测试赠送'});
 assert.equal(result.enabled,true);assert.equal(result.entry.delta,20);assert.deepEqual(writes,['account','credit']);
 settings.delete(JSON.stringify(scope));
 await assert.rejects(service.adminAssets(...args,{requestKey:randomUUID(),version:1,kind:'gift',amount:20,reason:'重新核验'}),{code:'WALLET_NOT_ENABLED'});
 assert.deepEqual(writes,['account','credit'],'each write rechecks the current setting');
});
