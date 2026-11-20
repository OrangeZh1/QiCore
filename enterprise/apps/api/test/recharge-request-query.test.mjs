import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Recharge} from '../dist/core/recharge.mjs';
test('unknown order results are read by original request identity in the full consumer scope',async()=>{
 const s={tenantId:'tenant',applicationKey:'system',userId:'user'},key='00000000-0000-4000-8000-000000000001',queries=[];
 let order={id:'original'},authorized=0;
 const db={rechargeOrder:{findFirst:async query=>{queries.push(query);return order}}};
 const service=new Recharge(db);service.apps={transaction:fn=>fn(db)};service.wallet={authorize:async()=>authorized++};service.expose=async(_db,value)=>value;
 assert.equal((await service.byRequest(s,key)).id,'original');assert.deepEqual(queries[0].where,{...s,requestKey:key,consumerDeletedAt:null});assert.equal(authorized,2);
 order=null;assert.equal(await service.byRequest(s,key),null);await assert.rejects(service.byRequest(s,'bad'),{code:'WALLET_INPUT_INVALID'});assert.equal(queries.length,2);
});
