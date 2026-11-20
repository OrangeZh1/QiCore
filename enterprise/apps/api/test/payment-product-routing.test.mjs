import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {PaymentClientPolicy} from '../src/payments/client-policy.mjs';
import {PaymentExecution} from '../src/payments/execution.mjs';

test('server payment gate rejects forged providers and stale subject revisions',async()=>{
 const scope={tenantId:'site-a',applicationKey:'app-a'},mini={config:{appId:'wx1234567890abcdef',subjectType:'personal'}},revision={provider:'wechat-virtual',config:{appId:mini.config.appId,subjectType:'personal'}},db={tenantMiniProgramSetting:{findUnique:async()=>mini},tenantPaymentRevision:{findFirst:async()=>revision}},policy=new PaymentClientPolicy(db);
 const virtual={paymentKind:()=> 'virtual'},physical={paymentKind:()=> 'physical'},order={product:{paymentKind:'physical'}};
 await assert.rejects(policy.product(db,scope,'mini','wechat',virtual,order),{code:'PAYMENT_PRODUCT_UNSUPPORTED'});
 await assert.rejects(policy.product(db,scope,'mini','wechat',physical,order),{code:'MINI_SUBJECT_UNSUPPORTED'});
 await policy.product(db,scope,'mini','wechat-virtual',virtual,order);
 mini.config.subjectType='business';
 await assert.rejects(policy.product(db,scope,'mini','wechat-virtual',virtual,order),{code:'MINI_SUBJECT_CHANGED'});
 revision.config.subjectType='business';await policy.product(db,scope,'mini','wechat-virtual',virtual,order);await policy.product(db,scope,'mini','wechat',physical,order);
 await policy.product(db,scope,'h5','wechat',virtual,order);await policy.product(db,scope,'official','wechat',virtual,order);
 mini.config.subjectType='unknown';revision.config.appId='wx0000000000000001';await assert.rejects(policy.product(db,scope,'mini','wechat-virtual',virtual,order),{code:'MINI_SUBJECT_REQUIRED'});
});

test('payment method reads filter ordinary pay for virtual goods regardless of subject',async()=>{
 for(const subjectType of ['personal','business']){
  const s={tenantId:'site',applicationKey:'app',userId:'user',authProvider:'wechat'},config={appId:'wx1234567890abcdef',subjectType},db={tenantMiniProgramSetting:{findUnique:async()=>({config})},tenantPaymentRevision:{findMany:async()=>[],findFirst:async()=>({provider:'wechat-virtual',config})},paymentRecord:{findFirst:async()=>null}},adapter={authorize:async()=>{},lock:async()=>({userId:'user',amount:199,currency:'CNY'}),payable:async()=>{},paymentKind:()=> 'virtual'};
  const engine=new PaymentExecution(db,{apps:{transaction:fn=>fn(db)},secrets:{}},{app:adapter},{enabled:false});engine.balance.wallet.account=async()=>null;engine.clientPolicy.read=async()=>({version:1,config:{mini:[{provider:'wechat',enabled:true},{provider:'balance',enabled:false},{provider:'wechat-virtual',enabled:true}]}});
  const result=await engine.methods(s,'order',{client:'mini'});assert.deepEqual(result.methods.map(row=>row.provider),['wechat-virtual']);
 }
});

test('ordinary payment creation is blocked before credentials or gateway execution; existing paid attempts remain readable',async()=>{
 const s={tenantId:'site',applicationKey:'app',userId:'user'},db={tenantPaymentRevision:{findFirst:async()=>null}},adapter={authorize:async()=>{},lock:async()=>({id:'order',userId:'user',amount:199,currency:'CNY'}),payable:async()=>{},paymentKind:()=> 'virtual'},engine=new PaymentExecution(db,{apps:{transaction:fn=>fn(db)},secrets:{}},{app:adapter},{enabled:true});
 engine.attempt=async()=>({p:null,lineage:{}});engine.clientPolicy.allowed=async()=>1;
 await assert.rejects(engine.pay(s,'order',{}),{code:'PAYMENT_PRODUCT_UNSUPPORTED'});
 engine.attempt=async()=>({p:{id:'original',state:'PAID'}});engine.latestRefund=async()=>null;engine.view=p=>({paymentId:p.id,state:p.state});engine.clientPolicy.product=async()=>{throw Error('historical payment must not be reclassified')};
 assert.equal((await engine.pay(s,'order',{})).paymentId,'original');
});


test('forged H5 channel and method queries are rejected for a mini-program session',async()=>{
 const engine=new PaymentExecution({}, {secrets:{},apps:{transaction:()=>{throw Error('must reject before transaction')}}},{},{enabled:true}),s={tenantId:'site',applicationKey:'app',userId:'user',authProvider:'wechat'};
 await assert.rejects(engine.methods(s,'order',{client:'h5'}),{code:'PAYMENT_CLIENT_MISMATCH'});
 await assert.rejects(engine.methods(s,'order',{client:'official'}),{code:'PAYMENT_CLIENT_MISMATCH'});
 await assert.rejects(engine.pay(s,'order',{channel:'h5'},{origin:'https://site.example',ip:'127.0.0.1'}),{code:'PAYMENT_CLIENT_MISMATCH'});
});

let ordinaryKeys;
function historicalPayment(provider){
 if(provider==='wechat'&&!ordinaryKeys){
  const merchant=generateKeyPairSync('rsa',{modulusLength:2048}),platform=generateKeyPairSync('rsa',{modulusLength:2048});
  ordinaryKeys={apiV3Key:'v'.repeat(32),privateKey:merchant.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:platform.publicKey.export({type:'spki',format:'pem'})};
 }
 const s={tenantId:'site',applicationKey:'app',userId:'user',token:'trusted-session',authProvider:'wechat',authAppId:'wx1234567890abcdef'},scope={tenantId:s.tenantId,applicationKey:s.applicationKey};
 const config=provider==='wechat'?{enabled:true,apiVersion:'V3',appId:s.authAppId,mchId:'123456',serialNo:'A'.repeat(16),publicKeyId:'PUB_KEY_ID_fixture'}:{enabled:true,appId:s.authAppId,offerId:'123',env:1,subjectType:'business'};
 const keys=provider==='wechat'?ordinaryKeys:{sandboxAppKey:'saved-key'},original={id:'original',provider,config,keys,secretFields:Object.keys(keys)},latest={id:'latest',provider,config:{...config,enabled:false,...provider==='wechat'?{mchId:'654321'}:{offerId:'456',subjectType:'unknown'}},keys:{},secretFields:[]};
 const identity={openId:'trusted-openid',sessionKey:Buffer.alloc(16,1).toString('base64')},payer={mode:provider==='wechat'?'JSAPI':'VIRTUAL_GOODS',appId:s.authAppId,openId:identity.openId,offerId:'123',env:1,appSecret:'old-app-secret',signData:JSON.stringify({offerId:'123',productId:'frozen-product'})};
 const payment={id:'a'.repeat(32),...scope,userId:s.userId,orderId:'order',provider,revisionId:original.id,state:'READY',currentSlot:1,amount:199,currency:'CNY',sequence:1,expiresAt:new Date(Date.now()+900000),payerCipher:payer,prepayId:'original-prepay',signingHash:provider==='wechat'?createHash('sha256').update(keys.privateKey).digest('hex'):null};
 const state={payment,revisions:[latest,original],kind:provider==='wechat'?'virtual':'physical',mini:{config:{appId:s.authAppId,subjectType:'unknown'},keyCipher:{appSecret:'current-app-secret'}},session:{...s,wechatSessionCipher:identity},external:[{...scope,provider:'wechat',appId:s.authAppId,subjectHash:'fixture',identityCipher:{openId:identity.openId}}]};
 const db={paymentRecord:{findFirst:async()=>state.payment,create:async()=>assert.fail('a read or resume must not create a payment')},tenantPaymentRevision:{findFirst:async({where})=>state.revisions.find(row=>(!where.id||row.id===where.id)&&row.provider===where.provider)||null,findMany:async({where})=>state.revisions.filter(row=>!where.provider||row.provider===where.provider)},tenantMiniProgramSetting:{findUnique:async()=>state.mini},session:{findUnique:async()=>state.session},consumerExternalIdentity:{findMany:async({where})=>{assert.deepEqual(where,{...scope,userId:s.userId,provider:'wechat',appId:s.authAppId});return state.external}}};
 const adapter={authorize:async()=>{},lock:async()=>({id:'order',...scope,userId:s.userId,amount:199,currency:'CNY'}),payable:async()=>{},paymentKind:()=>state.kind};
 const settings={apps:{transaction:fn=>fn(db)},secrets:{decrypt:(_aad,value)=>value},decrypt:row=>row.keys},gateway={prepay:async()=>assert.fail('resuming a ready payment must not send a new prepay'),clientParameters:(_config,prepayId)=>({prepayId})};
 const engine=new PaymentExecution(db,settings,{app:adapter},{enabled:true,gateway});engine.balance.wallet.account=async()=>null;engine.clientPolicy.read=async()=>({version:1,config:{mini:[{provider:'wechat',enabled:true},{provider:'wechat-virtual',enabled:true}]}});engine.virtual.goods=async()=>assert.fail('an existing payment must retain its original goods snapshot');
 return{s,state,engine,payment,original};
}

test('READY ordinary and virtual attempts read and resume their original credentials after current subject or configuration changes',async()=>{
 for(const provider of ['wechat','wechat-virtual']){
  const f=historicalPayment(provider);
  for(const subject of ['unknown','personal']){
   f.state.mini.config.subjectType=subject;
   const methods=await f.engine.methods(f.s,'order',{client:'mini'}),current=methods.methods.find(row=>row.provider===provider);assert.equal(current?.available,true,provider+' '+subject);assert.equal(current.requiresSwitch,false);
   const result=await f.engine.pay(f.s,'order',provider==='wechat'?{}:{provider});assert.equal(result.paymentId,f.payment.id);
   if(provider==='wechat')assert.equal(result.paymentParams.prepayId,'original-prepay');else assert.equal(result.virtualPaymentParams.signData,f.payment.payerCipher.signData);
  }
 }
});

test('historical method availability still rejects missing original revisions, changed identities and expiring ordinary payments',async()=>{
 for(const provider of ['wechat','wechat-virtual']){
  const f=historicalPayment(provider);f.state.revisions=f.state.revisions.filter(row=>row.id!==f.original.id);
  let methods=await f.engine.methods(f.s,'order',{client:'mini'});assert.equal(methods.methods.find(row=>row.provider===provider)?.available,false);
  await assert.rejects(f.engine.pay(f.s,'order',provider==='wechat'?{}:{provider}),{code:'PAYMENT_RECEIPT_MISMATCH'});
  f.state.revisions.push(f.original);f.s.authAppId='wx0000000000000001';methods=await f.engine.methods(f.s,'order',{client:'mini'});assert.notEqual(methods.methods.find(row=>row.provider===provider)?.available,true);
  await assert.rejects(f.engine.pay(f.s,'order',provider==='wechat'?{}:{provider}),{code:provider==='wechat'?'WECHAT_LOGIN_REQUIRED':'WECHAT_SESSION_REFRESH_REQUIRED'});
  if(provider==='wechat'){f.s.authAppId=f.original.config.appId;f.payment.expiresAt=new Date(Date.now()+30000);methods=await f.engine.methods(f.s,'order',{client:'mini'});assert.equal(methods.methods.find(row=>row.provider===provider)?.available,false);await assert.rejects(f.engine.pay(f.s,'order',{}),{code:'PAYMENT_CLOSING'})}
 }
});

test('paid, review, closed and switch-required attempts cannot use the historical resume exemption',async()=>{
 for(const provider of ['wechat','wechat-virtual']){
  const f=historicalPayment(provider);
  for(const state of ['PAID','REVIEW','CLOSED']){f.payment.state=state;f.payment.paidAt=state==='PAID'?new Date():null;const result=await f.engine.methods(f.s,'order',{client:'mini'});assert.ok(result.methods.every(row=>!row.available),provider+' '+state)}
  f.payment.state='CLOSED';f.payment.closeReason='switch';f.payment.paidAt=null;const result=await f.engine.methods(f.s,'order',{client:'mini'});assert.ok(result.methods.every(row=>!row.available));
  f.payment.state='READY';f.payment.closeReason=null;f.state.kind=provider==='wechat'?'virtual':'physical';
  await assert.rejects(f.engine.switchPayment(f.s,'order',{paymentId:f.payment.id,provider:provider==='wechat'?'wechat-virtual':'wechat'}),{code:'MINI_SUBJECT_REQUIRED'});
 }
});

test('unknown current subjects and undeclared products remain blocked for new attempts',async()=>{
 const f=historicalPayment('wechat-virtual');f.state.payment=null;f.state.kind='virtual';
 let result=await f.engine.methods(f.s,'order',{client:'mini'});assert.deepEqual(result.methods.map(row=>[row.provider,row.available]),[['wechat-virtual',false]]);
 await assert.rejects(f.engine.pay(f.s,'order',{provider:'wechat-virtual'}),{code:'MINI_SUBJECT_REQUIRED'});
 await assert.rejects(f.engine.pay(f.s,'order',{}),{code:'PAYMENT_PRODUCT_UNSUPPORTED'});
 f.state.kind='unknown';result=await f.engine.methods(f.s,'order',{client:'mini'});assert.deepEqual(result.methods,[]);
 await assert.rejects(f.engine.pay(f.s,'order',{provider:'wechat-virtual'}),{code:'PAYMENT_PRODUCT_UNSUPPORTED'});
});
