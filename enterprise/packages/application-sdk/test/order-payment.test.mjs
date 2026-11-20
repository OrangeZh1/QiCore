import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {transform} from 'esbuild';

const code=async name=>(await transform(await readFile(new URL('../client/lib/'+name+'.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'})).code;
const paymentCode=await code('order-payment'),virtualCode=await code('virtual-payment');
class ApiError extends Error{constructor(code,message,status){super(message);Object.assign(this,{code,status})}}
function fixture(web=false){
 const state={scope:'site:app:user',token:'token',base:'/api/v1'},requests=[],native=[],redirects=[],appId='wx1234567890abcdef';
 const bridge={ApiError,isH5:web,consumerScope:()=>state.scope+'|'+state.token,getToken:()=>state.token,runtimeConfig:()=>({apiBase:state.base}),sessionStorageKey:key=>key,startOfficialLogin:async()=>{},api:(url,method='GET',data)=>new Promise((resolve,reject)=>requests.push({url,method,data,resolve,reject}))};
 const uni={getStorageSync:()=>({mode:'wechat',appId}),getAccountInfoSync:()=>({miniProgram:{appId}}),requestPayment:options=>native.push(options),canIUse:()=>true,requestVirtualPayment:options=>native.push(options)};
 const virtual={exports:{}};new Function('module','exports','require','uni',virtualCode)(virtual,virtual.exports,()=>bridge,uni);
 const module={exports:{}};new Function('module','exports','require','uni','navigator','location',paymentCode)(module,module.exports,name=>name==='./virtual-payment'?virtual.exports:bridge,uni,{userAgent:'Browser'},{assign:url=>redirects.push(url)});
 return{...module.exports,state,requests,native,redirects,appId};
}
const order={id:'order-a',status:'pending',kind:'points_recharge',amountCents:100};
async function reconcile(c,result={...order,status:'paid'}){
 await setImmediate();const request=c.requests.shift();assert.equal(request.url,'/orders/order-a/reconcile');assert.equal(request.method,'POST');request.resolve({});
 await setImmediate();const read=c.requests.shift();assert.equal(read.url,'/orders/order-a');assert.equal(read.method,'GET');read.resolve(result);
}

test('public balance payment coalesces duplicate clicks, rejects a different operation and reads the original order',async()=>{
 const c=fixture(),paid=c.payOrder(order,{provider:'balance'});assert.equal(c.payOrder(order,{provider:'balance'}),paid);
 await assert.rejects(c.payOrder(order,{provider:'wechat'}),{code:'PAYMENT_BUSY'});assert.equal(c.requests.length,1);
 const request=c.requests.shift();assert.equal(request.url,'/orders/order-a/pay');assert.deepEqual(request.data,{provider:'balance'});request.resolve({orderId:order.id,state:'PAID'});
 await setImmediate();c.requests.shift().resolve({...order,status:'paid'});assert.equal((await paid).status,'paid');assert.equal(c.native.length,0);
});

test('native payment success and cancellation both reconcile without inventing a paid status',async()=>{
 for(const callback of ['success','fail']){
  const c=fixture(),payment=c.payOrder(order);c.requests.shift().resolve({orderId:order.id,state:'READY',paymentParams:{appId:c.appId,timeStamp:'1',nonceStr:'nonce',package:'prepay_id=test',signType:'RSA',paySign:'fixture'}});
  await setImmediate();assert.equal(c.native.length,1);c.native[0][callback]();await reconcile(c,order);assert.equal((await payment).status,'pending');
 }
});

test('payment failures and changed identities never open a cashier or retry an unknown submission automatically',async()=>{
 for(const change of [c=>c.state.scope='site:other:user',c=>c.state.token='new-token',c=>c.state.base='/another-api']){
  const c=fixture(),payment=c.payOrder(order),failed=assert.rejects(payment,{code:'PAYMENT_IDENTITY_CHANGED'});change(c);c.requests.shift().resolve({orderId:order.id,state:'READY',paymentParams:{appId:c.appId}});await failed;assert.equal(c.native.length,0);assert.equal(c.requests.length,0);
 }
 const wrong=fixture(),payment=wrong.payOrder(order),rejected=assert.rejects(payment,{code:'PAYMENT_APPID_MISMATCH'});wrong.requests.shift().resolve({orderId:order.id,state:'READY',paymentParams:{appId:'wxabcdef1234567890'}});await rejected;assert.equal(wrong.native.length,0);
 const c=fixture(),unknown=c.payOrder(order),failed=assert.rejects(unknown,{code:'NETWORK_UNKNOWN'});c.requests.shift().reject(new ApiError('NETWORK_UNKNOWN','unknown',0));await failed;assert.equal(c.requests.length,0);
 const retry=c.payOrder(order),again=assert.rejects(retry,{code:'NETWORK_UNKNOWN'});assert.equal(c.requests[0].url,'/orders/order-a/pay');c.requests.shift().reject(new ApiError('NETWORK_UNKNOWN','unknown',0));await again;
});

test('public H5 payment preserves the original order and accepts only the selected trusted cashier',async()=>{
 for(const [provider,url] of [['wechat','https://wx.tenpay.com/cashier?fixture=1'],['alipay','https://openapi.alipay.com/gateway.do?fixture=1']]){
  const c=fixture(true),payment=c.payOrder(order,{provider});c.requests.shift().resolve({orderId:order.id,state:'READY',redirectUrl:url});assert.equal(await payment,order);assert.deepEqual(c.redirects,[url]);
  for(const untrusted of ['https://evil.example/cashier',url.replace('https://','https://user@')]){
   const blocked=fixture(true),attempt=blocked.payOrder(order,{provider}),rejected=assert.rejects(attempt,{code:'PAYMENT_URL_INVALID'});blocked.requests.shift().resolve({orderId:order.id,state:'READY',redirectUrl:untrusted});await rejected;assert.deepEqual(blocked.redirects,[]);
  }
 }
 const wrong=fixture(true),attempt=wrong.payOrder(order),rejected=assert.rejects(attempt,{code:'PAYMENT_RESULT_UNKNOWN'});wrong.requests.shift().resolve({orderId:'another-order',state:'READY',redirectUrl:'https://wx.tenpay.com/cashier'});await rejected;assert.deepEqual(wrong.redirects,[]);
});

test('payment switching checks its lineage and virtual payment preserves signed bytes then reconciles',async()=>{
 const c=fixture(),previous='a'.repeat(32),events=[],payment=c.payOrder(order,{provider:'balance',switchPaymentId:previous,onSwitch:value=>events.push(value)});
 const request=c.requests.shift();assert.equal(request.url,'/orders/order-a/payment/switch');assert.equal(request.data.paymentId,previous);request.resolve({orderId:order.id,state:'CLOSED',paymentId:previous,switchStatus:'waiting'});
 await setImmediate();c.requests.shift().resolve(order);assert.equal((await payment).status,'pending');assert.deepEqual(events,['waiting']);
 const invalid=fixture(),attempt=invalid.payOrder(order,{provider:'balance',switchPaymentId:previous}),rejected=assert.rejects(attempt,{code:'PAYMENT_RESULT_UNKNOWN'});invalid.requests.shift().resolve({orderId:order.id,state:'PAID',paymentId:'b'.repeat(32),previousPaymentId:'c'.repeat(32),provider:'balance',switchStatus:'completed'});await rejected;
 const v=fixture(),virtual=v.payOrder(order,{provider:'wechat-virtual'}),paymentId='d'.repeat(32),params={mode:'short_series_goods',signData:JSON.stringify({outTradeNo:paymentId,attach:paymentId,goodsPrice:100,buyQuantity:1,currencyType:'CNY',env:1,offerId:'123',productId:'product-a'}),paySig:'e'.repeat(64),signature:'f'.repeat(64)};
 v.requests.shift().resolve({orderId:order.id,state:'READY',paymentId,provider:'wechat-virtual',virtualPaymentParams:params});await setImmediate();assert.equal(v.native[0].signData,params.signData);assert.equal(v.native[0].signature,params.signature);v.native[0].success();await reconcile(v);assert.equal((await virtual).status,'paid');
});
