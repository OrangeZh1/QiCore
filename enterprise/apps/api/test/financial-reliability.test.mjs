import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,createCipheriv,sign} from 'node:crypto';
import {singleEnterprise} from './fixtures/single-enterprise.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';
import {Recharge,rechargePayments} from '../src/core/recharge.mjs';
import {TenantPayments} from '../src/core/tenant-payments.mjs';
import {AfterSales} from '../src/core/after-sales.mjs';
import {PaymentExecution} from '../src/payments/execution.mjs';
import {WechatTransport} from '../src/payments/wechat-transport.mjs';
import {StorageSecrets} from '../src/storage/secrets.mjs';

const integration={skip:!process.env.TEST_DATABASE_URL};
async function fixture(t){
 const {db}=await isolatedDatabase(t),recharge=new Recharge(db),s={tenantId:'financial-review',applicationKey:'system',userId:'consumer',token:'a'.repeat(64),role:'user',authProvider:'wechat'};
 await singleEnterprise(db,{id:s.tenantId});await db.tenantApplication.create({data:{tenantId:s.tenantId,applicationKey:'system',activeSlot:null,config:{}}});await db.consumerProfile.create({data:{tenantId:s.tenantId,applicationKey:'system',userId:s.userId,nickname:'Review'}});await db.session.create({data:{...s,expiresAt:new Date(Date.now()+600000)}});
 const secrets=new StorageSecrets('.'),storageKey=randomBytes(32);secrets.key=()=>storageKey;
 const merchant=generateKeyPairSync('rsa',{modulusLength:2048}),platform=generateKeyPairSync('rsa',{modulusLength:2048}),config={enabled:true,apiVersion:'V3',mchId:'1234567890',appId:'wx1234567890abcdef',serialNo:'A'.repeat(32),publicKeyId:'PUB_KEY_ID_REVIEW'},keys={privateKey:merchant.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:platform.publicKey.export({type:'spki',format:'pem'}),apiV3Key:randomBytes(16).toString('hex')},revisionId=randomUUID();
 await db.tenantPaymentRevision.create({data:{id:revisionId,tenantId:s.tenantId,applicationKey:s.applicationKey,provider:'wechat',version:1,config,secretFields:Object.keys(keys),secretsCipher:secrets.encrypt(['tenant-payment',s.tenantId,s.applicationKey,'wechat',revisionId].join(':'),keys)}});
 const settings=new TenantPayments(db,secrets),adapter=rechargePayments(recharge,'system',{}),gateway=new WechatTransport();
 for(const method of ['prepay','prepayH5','query','close','refund','queryRefund'])gateway[method]=async()=>{throw Error('UNEXPECTED_EXTERNAL_NETWORK')};
 const createEngine=()=>new PaymentExecution(db,settings,{system:adapter},{gateway,enabled:true,origin:()=> 'https://review.example.com'}),engine=createEngine();recharge.payments=engine;
 const order=async()=>db.rechargeOrder.create({data:{id:Date.now().toString()+String(Math.floor(Math.random()*1e7)).padStart(7,'0'),tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,requestKey:randomUUID(),payloadHash:'b'.repeat(64),kind:'points_recharge',amount:100,product:{name:'Review',asset:'points',base:100,gift:20},currency:'CNY'}});
 const payment=async(o)=>{const id=randomUUID().replaceAll('-','');return db.paymentRecord.create({data:{id,tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,orderId:o.id,provider:'wechat',revisionId,payerCipher:secrets.encrypt(['payment-payer',s.tenantId,s.applicationKey,id].join(':'),{mode:'MWEB'}),amount:100,currency:'CNY',state:'READY',expiresAt:new Date(Date.now()+60000)}})};
 const receipt=p=>({mchid:config.mchId,appid:config.appId,out_trade_no:p.id,transaction_id:'transaction'+p.id,trade_state:'SUCCESS',trade_type:'MWEB',amount:{total:p.amount,payer_total:p.amount,currency:'CNY',payer_currency:'CNY'},success_time:new Date().toISOString()});
 const refund=(p,r,state='SUCCESS')=>({mchid:config.mchId,appid:config.appId,out_trade_no:p.id,transaction_id:p.transactionId,out_refund_no:r.id,refund_id:'refund'+r.id,status:state,amount:{total:p.amount,refund:r.amount??p.amount,payer_refund:state==='SUCCESS'?(r.amount??p.amount):0,currency:'CNY'},...(state==='SUCCESS'?{success_time:new Date().toISOString()}:{})});
 function notice(kind,data,id=randomUUID()){
  const nonce=randomBytes(6).toString('hex'),aad='review',cipher=createCipheriv('aes-256-gcm',Buffer.from(keys.apiV3Key),Buffer.from(nonce));cipher.setAAD(Buffer.from(aad));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final(),cipher.getAuthTag()]).toString('base64');
  const raw=Buffer.from(JSON.stringify({id,event_type:kind==='payment'?'TRANSACTION.SUCCESS':'REFUND.'+data.status,resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:aad,ciphertext}})),timestamp=String(Math.floor(Date.now()/1000)),headerNonce=randomUUID(),signature=sign('RSA-SHA256',Buffer.from(timestamp+'\n'+headerNonce+'\n'+raw+'\n'),platform.privateKey).toString('base64');
  return{raw,headers:new Headers({'wechatpay-timestamp':timestamp,'wechatpay-nonce':headerNonce,'wechatpay-signature':signature,'wechatpay-serial':config.publicKeyId})};
 }
 async function reconcileWallet(){const accounts=await db.walletAccount.findMany();for(const a of accounts){const lots=await db.walletLot.findMany({where:{accountId:a.id}}),entries=await db.walletEntry.findMany({where:{accountId:a.id}});assert.equal(lots.reduce((n,r)=>n+r.remaining,0n),a.amount);assert.equal(entries.reduce((n,r)=>n+r.delta,0n),a.amount);assert.ok(entries.every(r=>r.beforeAmount+r.delta===r.afterAmount))}}
 return{db,recharge,s,adapter,engine,createEngine,gateway,order,payment,receipt,refund,notice,reconcileWallet};
}

test('signed encrypted notifications survive failed fulfillment and concurrent recovery without duplicate credit',integration,async t=>{
 const f=await fixture(t),o=await f.order(),p=await f.payment(o),data=f.receipt(p),notice=f.notice('payment',data);
 const tampered=Buffer.from(notice.raw);tampered[tampered.length-2]^=1;await assert.rejects(f.engine.accept(p.id,'payment',tampered,notice.headers),{code:'PAYMENT_NOTICE_INVALID'});
 const wrong=f.notice('payment',{...data,out_trade_no:'wrong'});await assert.rejects(f.engine.accept(p.id,'payment',wrong.raw,wrong.headers),{code:'PAYMENT_NOTICE_INVALID'});
 await Promise.all([f.engine.accept(p.id,'payment',notice.raw,notice.headers),f.engine.accept(p.id,'payment',notice.raw,notice.headers)]);assert.equal(await f.db.paymentNotice.count(),1);
 const saved=await f.db.paymentNotice.findFirst();assert.ok(!saved.payloadCipher.includes(data.transaction_id));
 f.adapter.afterSettlement=async()=>{throw Error('FULFILLMENT_FAILURE')};await assert.rejects(f.engine.processNotice(saved.id),/FULFILLMENT_FAILURE/);assert.equal(await f.db.walletEntry.count(),0);assert.equal((await f.db.paymentRecord.findUnique({where:{id:p.id}})).paidAt,null);assert.equal((await f.db.paymentNotice.findUnique({where:{id:saved.id}})).state,'PENDING');
 f.adapter.afterSettlement=async()=>{};const restarted=f.createEngine();f.gateway.query=async()=>({data});
 await Promise.all([restarted.processNotice(saved.id),restarted.reconcile(p.id)]);assert.equal((await f.recharge.wallet.summary(f.db,f.s)).points.amount,120);assert.equal(await f.db.walletEntry.count(),2);assert.equal((await f.db.paymentNotice.findUnique({where:{id:saved.id}})).state,'DONE');await f.reconcileWallet();
 t.diagnostic('reliability payment '+JSON.stringify({rsaSignature:true,aesGcm:true,tamperRejected:true,identityMismatchRejected:true,failedFulfillmentRolledBack:true,restartReplay:true,concurrentNotificationAndQuery:true,credits:2,points:120,realGateway:false}));
});

test('unknown refund dispatch reuses its original number and late notifications never undo success',integration,async t=>{
 const f=await fixture(t),o=await f.order(),created=await f.payment(o);await f.engine.tx(tx=>f.engine.settle(tx,created,f.receipt(created)));const p=await f.db.paymentRecord.findUnique({where:{id:created.id}}),requestKey=randomUUID();
 const r=await f.engine.tx(async tx=>{const locked=await f.engine.locked(tx,p);return f.engine.createRefund(tx,locked.p,locked.order,'refund',{amount:100,requestKey})});
 await assert.rejects(f.engine.tx(async tx=>{const locked=await f.engine.locked(tx,p);return f.engine.createRefund(tx,locked.p,locked.order,'changed',{amount:99,requestKey})}),{code:'REFUND_REQUEST_CONFLICT'});
 const channel=new Map(),dispatches=[];let loseResponse=true;f.gateway.refund=async(_config,payload)=>{dispatches.push(payload.out_refund_no);if(!channel.has(payload.out_refund_no))channel.set(payload.out_refund_no,f.refund(p,r));if(loseResponse){loseResponse=false;throw Error('RESPONSE_LOST_AFTER_ACCEPTANCE')}return{data:channel.get(payload.out_refund_no)}};f.gateway.queryRefund=async()=>({data:channel.get(r.id)});
 await assert.rejects(f.engine.processRefund(r.id),/RESPONSE_LOST_AFTER_ACCEPTANCE/);assert.equal((await f.db.paymentRefund.findUnique({where:{id:r.id}})).state,'PENDING');
 await f.createEngine().processRefund(r.id);assert.equal(channel.size,1);assert.deepEqual(dispatches,[r.id,r.id]);assert.equal((await f.db.paymentRefund.findUnique({where:{id:r.id}})).state,'SUCCESS');
 const success=f.notice('refund',channel.get(r.id));await f.engine.accept(p.id,'refund',success.raw,success.headers);const n=await f.db.paymentNotice.findFirst({where:{paymentId:p.id}});await f.engine.processNotice(n.id);
 await assert.rejects(f.engine.tx(tx=>f.engine.applyRefund(tx,p,r,f.refund(p,r,'PROCESSING'))),{code:'PAYMENT_RECEIPT_MISMATCH'});assert.equal((await f.db.paymentRefund.findUnique({where:{id:r.id}})).state,'SUCCESS');assert.equal((await f.engine.refundSummary(f.db,p)).refunded,100);await f.reconcileWallet();
 t.diagnostic('reliability refund '+JSON.stringify({dispatchCalls:2,uniqueChannelRefunds:1,requestContentBound:true,lateStateProtected:true,realGateway:false}));
});

test('retired payment arriving after balance payment refunds only its own cash and preserves winning assets',integration,async t=>{
 const f=await fixture(t),o=await f.order(),old=await f.payment(o);
 await f.engine.tx(tx=>f.recharge.wallet.credit(tx,f.s,'balance',{requestKey:'seed',kind:'gift',reference:'seed',amount:500,reason:'review',actor:'system'}));
 await f.db.paymentRecord.update({where:{id:old.id},data:{state:'CLOSED',closeReason:'switch',closeRequested:true}});
 const winner=await f.engine.balance.pay(f.s,o.id,{},old.id);assert.equal((await f.recharge.wallet.summary(f.db,f.s)).points.amount,120);
 const signed=f.notice('payment',f.receipt(old));await f.engine.accept(old.id,'payment',signed.raw,signed.headers);await f.engine.processNotice((await f.db.paymentNotice.findFirst()).id);
 const retired=await f.db.paymentRecord.findUnique({where:{id:old.id}}),r=await f.db.paymentRefund.findFirst({where:{paymentId:old.id}});assert.equal(retired.state,'COMPENSATION');assert.equal(r.source,'compensation');
 f.gateway.refund=async()=>({data:f.refund(retired,r)});await f.engine.processRefund(r.id);
 assert.equal((await f.db.paymentRecord.findUnique({where:{id:winner.paymentId}})).state,'PAID');assert.equal((await f.db.rechargeOrder.findUnique({where:{id:o.id}})).status,'paid');const assets=await f.recharge.wallet.summary(f.db,f.s);assert.equal(assets.points.amount,120);assert.equal(assets.balance.amount,400);await f.reconcileWallet();
 t.diagnostic('reliability late-payment '+JSON.stringify({winningPayment:'balance',retiredPayment:'wechat',compensationRefund:100,pointsRetained:120,balanceRetained:400,realGateway:false}));
});

test('closed refund retry keeps prior evidence and concurrent retries create at most one successor',integration,async t=>{
 const f=await fixture(t),o=await f.order(),created=await f.payment(o);await f.engine.tx(tx=>f.engine.settle(tx,created,f.receipt(created)));const p=await f.db.paymentRecord.findUnique({where:{id:created.id}});
 const r=await f.engine.tx(async tx=>{const locked=await f.engine.locked(tx,p);return f.engine.createRefund(tx,locked.p,locked.order,'refund',{amount:100,requestKey:randomUUID()})});const closed=f.refund(p,r,'CLOSED');await f.engine.tx(tx=>f.engine.applyRefund(tx,p,r,closed));
 const permissions=['tenant:orders.read','tenant:orders.manage'];await f.db.adminRole.create({data:{id:'refund-role',name:'Refund',portal:'tenant',permissions}});await f.db.adminAccount.create({data:{id:'refund-admin',username:'refund-admin',nickname:'Refund',passwordHash:'fixture',roleId:'refund-role',scopes:{create:{tenantId:f.s.tenantId}}}});await f.db.adminSession.create({data:{tokenHash:'c'.repeat(64),csrfHash:'d'.repeat(64),adminId:'refund-admin',portal:'tenant',expiresAt:new Date(Date.now()+600000)}});
 const actor={id:'refund-admin',_admin:true,role:'tenant',tenantIds:[f.s.tenantId],permissions,tokenHash:'c'.repeat(64)},sales=new AfterSales(f.db,f.engine);f.gateway.queryRefund=async()=>({data:closed});
 const attempts=await Promise.allSettled([sales.retry(actor,f.s.tenantId,'system',r.id,{reason:'retry'}),sales.retry(actor,f.s.tenantId,'system',r.id,{reason:'retry'})]);assert.ok(attempts.some(r=>r.status==='fulfilled'));for(const result of attempts.filter(r=>r.status==='rejected'))assert.equal(result.reason.code,'PAYMENT_BUSY');
 const next=await f.db.paymentRefund.findFirst({where:{previousId:r.id}});assert.ok(next);assert.equal(await f.db.paymentRefund.count(),2);assert.equal((await sales.retry(actor,f.s.tenantId,'system',r.id,{reason:'retry'})).id,next.id);
 await assert.rejects(f.engine.tx(tx=>f.engine.applyRefund(tx,p,r,f.refund(p,r))),{code:'PAYMENT_RECEIPT_MISMATCH'});assert.equal((await f.db.paymentRefund.findUnique({where:{id:r.id}})).state,'CLOSED');f.gateway.refund=async()=>({data:f.refund(p,next)});await f.engine.processRefund(next.id);assert.equal((await f.engine.refundSummary(f.db,p)).refunded,100);assert.equal(await f.db.walletEntry.count({where:{kind:'refund.revoke'}}),1);await f.reconcileWallet();
});
