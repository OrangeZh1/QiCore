import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Recharge} from '../src/core/recharge.mjs';
import {PaymentExecution} from '../src/payments/execution.mjs';

const scope={tenantId:'site-a',applicationKey:'system',userId:'member-a'};
const order=(id,extra={})=>({id,...scope,kind:'balance_recharge',product:{name:'余额充值'},amount:1000,currency:'CNY',status:'paid',createdAt:new Date('2026-10-28T00:00:00Z'),...extra});
const payment=(o,extra={})=>({id:'p-'+o.id,...scope,orderId:o.id,userId:o.userId,provider:'balance',state:'PAID',sequence:1,currentSlot:1,payerTotal:1000,refunds:[],...extra});
function fixture(orders,attempts){
 const calls=[],db={
  rechargeOrder:{count:async q=>{calls.push(['count',q]);return orders.length},findMany:async q=>{calls.push(['orders',q]);return orders.slice(q.skip,q.skip+q.take)}},
  paymentRecord:{findMany:async q=>{calls.push(['payments',q]);return attempts.filter(row=>q.where.OR.some(s=>Object.entries(s).every(([k,v])=>row[k]===v))).sort((a,b)=>b.sequence-a.sequence)}}
 };
 const service=new Recharge(db);service.payments={history:PaymentExecution.prototype.history,view:PaymentExecution.prototype.view,enabled:false};
 return{db,service,calls};
}

test('recharge lists batch payment reads independent of page size and preserve full consumer scope',async()=>{
 for(const pageSize of [1,20,50]){
  const orders=Array.from({length:50},(_,i)=>order(String(i))),attempts=orders.map(o=>payment(o));
  attempts.push(payment(orders[0],{id:'other-site',tenantId:'site-b'}),payment(orders[0],{id:'other-app',applicationKey:'app-b'}),payment(orders[0],{id:'other-user',userId:'member-b'}));
  const {db,service,calls}=fixture(orders,attempts),result=await service.list(db,scope,{pageSize});
  assert.equal(result.items.length,pageSize);assert.equal(result.total,50);
  assert.deepEqual(calls.map(([name])=>name),['count','orders','payments']);
  assert.deepEqual(calls[2][1].where.OR,orders.slice(0,pageSize).map(o=>({...scope,orderId:o.id})));
  assert.deepEqual(calls[2][1].include,{refunds:{orderBy:{sequence:'desc'}}});
  for(const row of result.items){assert.equal(row.payment.paymentId,'p-'+row.id);assert.equal(row.paymentAttempts.length,1)}
  assert.doesNotMatch(JSON.stringify(result),/other-site|other-app|other-user/);
 }
 const {db,service,calls}=fixture([],[]);assert.deepEqual((await service.list(db,scope)).items,[]);assert.equal(calls.length,2);
});

test('batched recharge views retain retired attempts, current partial refunds and unpaid orders',async()=>{
 const orders=[order('paid',{status:'partial_refund'}),order('unpaid',{status:'pending',userId:'member-b'})];
 const current=payment(orders[0],{id:'current',sequence:2,state:'PARTIAL_REFUND',refunds:[{id:'pending',state:'PENDING',amount:300,sequence:3},{id:'partial',state:'SUCCESS',amount:200,payerRefund:150,sequence:2}]}),retired=payment(orders[0],{id:'retired',currentSlot:null,state:'REFUNDED',refunds:[{id:'old-refund',state:'SUCCESS',amount:null,payerRefund:1000,sequence:1}]});
 const {db,service,calls}=fixture(orders,[retired,current]),result=await service.list(db,scope,{},true);
 assert.deepEqual(calls[0][1].where,{tenantId:scope.tenantId,applicationKey:scope.applicationKey});
 const [paid,unpaid]=result.items;
 assert.equal(paid.payment.paymentId,'current');assert.equal(paid.payment.refund.id,'pending');assert.equal(paid.refundedCents,200);assert.equal(paid.fulfillment,'revoked');
 assert.deepEqual(paid.paymentAttempts.map(p=>[p.paymentId,p.current,p.refundedCents]),[['current',true,150],['retired',false,1000]]);
 assert.equal(unpaid.payment,null);assert.deepEqual(unpaid.paymentAttempts,[]);assert.equal(unpaid.refundedCents,0);assert.equal(unpaid.refundUnavailableReason,'尚未支付');assert.equal(unpaid.userId,'member-b');
 const detail=await service.expose(db,orders[0]);assert.deepEqual(detail.paymentAttempts,paid.paymentAttempts);assert.equal(detail.refundedCents,200);
 current.refunds=[{id:'legacy',state:'SUCCESS',amount:null,payerRefund:1000}];assert.equal((await service.expose(db,orders[0])).refundedCents,1000);
 service.payments=null;assert.deepEqual((await service.expose(db,orders[0])).paymentAttempts,[]);
});

test('recharge pagination reads attempts for the requested page only and keeps filters',async()=>{
 const orders=Array.from({length:25},(_,i)=>order(String(i))),{db,service,calls}=fixture(orders,orders.map(o=>payment(o)));
 const result=await service.list(db,scope,{page:2,pageSize:20,status:'paid',kind:'balance_recharge',q:'12'});
 assert.equal(result.page,2);assert.deepEqual(result.items.map(o=>o.id),['20','21','22','23','24']);
 assert.deepEqual(calls[0][1].where,{...scope,consumerDeletedAt:null,kind:'balance_recharge',status:{in:['paid','partial_refund','refund_pending','compensation_due']},OR:[{id:{contains:'12'}},{userId:{contains:'12'}}]});
 assert.deepEqual(calls[2][1].where.OR,orders.slice(20).map(o=>({...scope,orderId:o.id})));
});
