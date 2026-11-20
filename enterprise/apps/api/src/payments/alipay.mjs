import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AlipayTransport,alipayCents,alipayDate} from './alipay-transport.mjs';
import {paymentConfigured,validatePaymentKeys} from './config.mjs';
import {isH5PlatformHost} from '../core/h5-entry.mjs';
import {miniProgramDomains} from '../channels/mini-domains.mjs';
import {fail} from '../core/errors.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const scope=p=>({tenantId:p.tenantId,applicationKey:p.applicationKey});
const payerAad=p=>['payment-payer',p.tenantId,p.applicationKey,p.id].join(':');
const noticeAad=(p,n)=>['payment-notice',p.tenantId,p.applicationKey,p.id,n.id].join(':');
const terminal=p=>['PAID','PARTIAL_REFUND','COMPENSATION','REFUNDED','CLOSED','REVIEW'].includes(p.state);
const mismatch=()=>fail('PAYMENT_RECEIPT_MISMATCH','支付凭证与原订单不匹配',409);
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const errorCode=e=>/^[A-Z0-9_]{1,64}$/.test(e?.code||'')?e.code:'ALIPAY_UNCONFIRMED';

// Alipay-specific protocol and lifecycle differences; accounting and application
// fulfilment remain in PaymentExecution and the registered order adapters.
export class AlipayPayments {
 constructor(engine,gateway=new AlipayTransport()){this.engine=engine;this.gateway=gateway}
 async credentials(p,db=this.engine.db){
  if(p.provider!=='alipay')mismatch();const original=await db.tenantPaymentRevision.findFirst({where:{id:p.revisionId,...scope(p),provider:'alipay'}});if(!original)mismatch();
  const rows=await db.tenantPaymentRevision.findMany({where:{...scope(p),provider:'alipay'},orderBy:{version:'desc'}}),trusted=rows.filter(row=>row.config.appId===original.config.appId&&row.config.sellerId===original.config.sellerId).map(row=>({...row.config,...this.engine.settings.decrypt(row),revisionId:row.id}));
  const current=trusted.find(c=>{try{validatePaymentKeys('alipay',c,c,true);return true}catch{return false}});if(!current)fail('PAYMENT_KEYS_UNAVAILABLE','原订单支付宝凭据不可用',503);return{...current,trusted};
 }
 async pay(s,orderId,input,context,switchFrom=null){
  const e=this.engine;e.assertEnabled();if(!validId(orderId)||!z.object({provider:z.literal('alipay'),channel:z.literal('h5')}).strict().safeParse(input).success)fail('PAYMENT_INPUT_INVALID','支付宝仅支持 H5 收银台，金额由服务端确定');
  if(/MicroMessenger/i.test(context.userAgent||''))fail('PAYMENT_CLIENT_UNSUPPORTED','微信内不能直接调用支付宝，请使用普通 H5 浏览器',409);const h5=await e.h5Context(s,context),returnUrl=h5.origin+(isH5PlatformHost(new URL(h5.origin).host)?'/h5/'+encodeURIComponent(s.tenantId):'')+'/orders?orderId='+encodeURIComponent(orderId),domains=miniProgramDomains(e.origin());if(!domains.available)fail('PAYMENT_ORIGIN_INVALID','支付通知需要服务端公网 HTTPS 地址',503);
  return e.tx(async db=>{
   const app=e.app(s.applicationKey);await app.authorize(db,s);const order=await app.lock(db,s.tenantId,orderId);if(order.userId!==s.userId||order.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
   const attempt=await e.attempt(db,s,orderId,'alipay','ALIPAY_WAP',switchFrom);let p=attempt.p;if(p&&terminal(p))return e.view(p,await e.latestRefund(db,p.id));await app.payable(db,order);await e.clientPolicy.allowed(db,s,'h5','alipay');
   if(!p){const row=await db.tenantPaymentRevision.findFirst({where:{...scope(s),provider:'alipay'},orderBy:{version:'desc'}});if(!row||!paymentConfigured('alipay',row.config,row.secretFields))fail('PAYMENT_UNAVAILABLE','支付宝尚未配置完整',503);validatePaymentKeys('alipay',row.config,e.settings.decrypt(row),true);if(!Number.isSafeInteger(order.amount)||order.amount<=0||order.currency!=='CNY')fail('PAYMENT_AMOUNT_INVALID','支付宝仅支持人民币正金额');
    p={id:randomUUID().replaceAll('-',''),...scope(s),...attempt.lineage,userId:s.userId,orderId,provider:'alipay',revisionId:row.id,amount:order.amount,currency:'CNY',state:'READY',expiresAt:new Date(Date.now()+15*60000)};
    p=await db.paymentRecord.create({data:{...p,payerCipher:e.secrets.encrypt(payerAad(p),{appId:row.config.appId,mode:'ALIPAY_WAP',returnUrl,notifyUrl:domains.request+'/api/v1/payments/alipay/'+p.id+'/notify'})}});
   }
   if(p.closeRequested||p.expiresAt.getTime()-Date.now()<60000)fail('PAYMENT_CLOSING','支付正在关闭或即将到期，请查询原订单',409);
   const saved=e.payerData(p);if(saved.mode!=='ALIPAY_WAP'||saved.returnUrl!==returnUrl)fail('PAYMENT_CHANNEL_MISMATCH','请从原站点入口继续支付',409);
   const config=await this.credentials(p,db),redirectUrl=this.gateway.cashier(config,{id:p.id,amount:p.amount,description:order.description,expiresAt:p.expiresAt,returnUrl:saved.returnUrl,notifyUrl:saved.notifyUrl});return{...e.view(p),redirectUrl};
  });
 }
 identity(p,config,data){if(data.out_trade_no!==p.id||data.app_id!==undefined&&data.app_id!==config.appId||data.seller_id!==undefined&&data.seller_id!==config.sellerId)mismatch()}
 receipt(p,config,data){
  this.identity(p,config,data);if(!['TRADE_SUCCESS','TRADE_FINISHED'].includes(data.trade_status)||!validId(data.trade_no))mismatch();
  const total=alipayCents(data.total_amount),paid=alipayCents(data.buyer_pay_amount);if(total!==p.amount||paid>total)mismatch();
  return{receiptProvider:'alipay',mchid:config.sellerId,appid:config.appId,out_trade_no:p.id,transaction_id:data.trade_no,trade_state:'SUCCESS',trade_type:'ALIPAY_WAP',amount:{total,payer_total:paid,currency:'CNY',payer_currency:'CNY'},success_time:alipayDate(data.send_pay_date)};
 }
 validate(p,config,data){if(p.provider!=='alipay'||data.receiptProvider!=='alipay'||data.mchid!==config.sellerId||data.appid!==config.appId||data.out_trade_no!==p.id||!validId(data.transaction_id)||data.trade_state!=='SUCCESS'||data.trade_type!=='ALIPAY_WAP'||data.amount?.total!==p.amount||data.amount.currency!=='CNY'||p.currency!=='CNY'||!Number.isSafeInteger(data.amount.payer_total)||data.amount.payer_total<0||data.amount.payer_total>p.amount||!Number.isFinite(Date.parse(data.success_time)))mismatch();if(p.transactionId&&(p.transactionId!==data.transaction_id||p.payerTotal!==data.amount.payer_total))mismatch()}
 async reconcile(paymentId,force=false){
  const e=this.engine;e.assertEnabled();const found=await e.db.paymentRecord.findUnique({where:{id:paymentId}});if(!found||found.provider!=='alipay')mismatch();
  const prepared=await e.tx(async db=>{const {p}=await e.locked(db,found);if(terminal(p)&&!force)return null;return{p,config:await this.credentials(p,db),token:await e.lease(db,'paymentRecord',p)}});if(!prepared)return;
  const {p,config,token}=prepared;let error;
  try{
   let data;try{data=await this.gateway.query(config,p.id)}catch(err){
    if(!err.authenticated||err.code!=='ALIPAY_TRADE_NOT_EXIST')throw err;
    // A signed WAP URL can still create a trade until its signed expiration.
    // A missing trade before that point is not proof that a cancelled URL is inert.
    if(force)throw err;
    if(p.expiresAt>new Date()){await e.db.paymentRecord.updateMany({where:{id:p.id,leaseToken:token},data:{nextCheckAt:p.expiresAt,lastError:p.closeRequested?'ALIPAY_CLOSE_WAIT_EXPIRY':null}});return}
    data={out_trade_no:p.id,trade_status:'TRADE_CLOSED'};
   }
   this.identity(p,config,data);
   if(['TRADE_SUCCESS','TRADE_FINISHED'].includes(data.trade_status)){await e.tx(db=>e.settle(db,p,this.receipt(p,config,data)));return}
   if(!['WAIT_BUYER_PAY','TRADE_CLOSED'].includes(data.trade_status))mismatch();
   const current=await e.db.paymentRecord.findUnique({where:{id:p.id}});
   if(data.trade_status==='WAIT_BUYER_PAY'&&(current.closeRequested||p.expiresAt<=new Date())){const closed=await this.gateway.close(config,p.id);this.identity(p,config,closed);data=await this.gateway.query(config,p.id);this.identity(p,config,data);if(['TRADE_SUCCESS','TRADE_FINISHED'].includes(data.trade_status)){await e.tx(db=>e.settle(db,p,this.receipt(p,config,data)));return}}
   if(data.trade_status==='TRADE_CLOSED'){
    if(p.paidAt&&p.state!=='REFUNDED'||force&&force!=='closed')fail('ALIPAY_EXTERNAL_REFUND_REVIEW','支付宝资金状态需要核查，原记录已保留',409);
    await e.tx(db=>e.closed(db,p,token));
   }else if(force)fail('ALIPAY_NOTICE_QUERY_PENDING','支付通知与查单结果尚未一致，请继续查询原单',409);
  }catch(err){error=err;throw err}finally{await e.release('paymentRecord',p,token,error)}
 }
 async accept(paymentId,raw){
  const e=this.engine;if(!validId(paymentId))fail('PAYMENT_NOTICE_INVALID','通知标识无效');const p=await e.db.paymentRecord.findUnique({where:{id:paymentId}});if(!p||p.provider!=='alipay')fail('NOT_FOUND','支付记录不存在',404);const config=await this.credentials(p);let fields;
  try{fields=this.gateway.notification(raw,config);this.identity(p,config,fields);if(fields.app_id!==config.appId||fields.seller_id!==config.sellerId||!validId(fields.trade_no)||p.transactionId&&p.transactionId!==fields.trade_no||alipayCents(fields.total_amount)!==p.amount||!['TRADE_SUCCESS','TRADE_FINISHED','TRADE_CLOSED'].includes(fields.trade_status)||typeof fields.notify_id!=='string'||fields.notify_id.length<1||fields.notify_id.length>128||/[\u0000-\u001f]/.test(fields.notify_id))mismatch()}catch{fail('PAYMENT_NOTICE_INVALID','支付宝通知验签或内容核验失败',400)}
  const payload=Object.fromEntries(Object.keys(fields).filter(k=>k!=='sign').sort().map(k=>[k,fields[k]])),n={id:hash('alipay:'+p.id+':'+fields.notify_id),paymentId:p.id,kind:'payment',payloadHash:hash(JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='notify_time')))),state:'PENDING'};
  await e.tx(async db=>{const existing=await db.paymentNotice.findUnique({where:{id:n.id}});if(existing){if(existing.payloadHash!==n.payloadHash)mismatch();return}await db.paymentNotice.create({data:{...n,payloadCipher:e.secrets.encrypt(noticeAad(p,n),payload)}})});return{status:200,type:'text/plain',body:'success'};
 }
 async processNotice(n,p){
  const e=this.engine;try{const fields=e.secrets.decrypt(noticeAad(p,n),n.payloadCipher);await this.reconcile(p.id,fields.trade_status==='TRADE_CLOSED'?'closed':true);const current=await e.db.paymentRecord.findUnique({where:{id:p.id}});if(current?.transactionId&&current.transactionId!==fields.trade_no)mismatch();if(['TRADE_SUCCESS','TRADE_FINISHED'].includes(fields.trade_status)&&!current?.paidAt)fail('ALIPAY_NOTICE_QUERY_PENDING','到账尚未确认',409);if(fields.trade_status==='TRADE_CLOSED'&&current?.paidAt&&current.state!=='REFUNDED')fail('ALIPAY_EXTERNAL_REFUND_REVIEW','请核查支付宝资金状态',409);await e.db.paymentNotice.updateMany({where:{id:n.id,state:'PENDING'},data:{state:'DONE',lastError:null}})}catch(err){await e.db.paymentNotice.updateMany({where:{id:n.id,state:'PENDING'},data:{attempts:{increment:1},lastError:errorCode(err),nextCheckAt:new Date(Date.now()+Math.min(1800000,30000*2**Math.min(n.attempts,6)))}});throw err}
 }
 assertRefund(p){if(p.payerTotal!==p.amount)fail('ALIPAY_PROMOTION_REFUND_REVIEW','支付宝优惠订单的实际退款金额需核查，暂不支持自动退款',409)}
 refundReceipt(p,r,config,data){
  this.identity(p,config,data);if(data.trade_no!==p.transactionId||data.out_request_no!==r.id||data.refund_status!=='REFUND_SUCCESS'||alipayCents(data.total_amount)!==p.amount||alipayCents(data.refund_amount)!==(r.amount??p.amount))mismatch();this.assertRefund(p);
  return{receiptProvider:'alipay',mchid:config.sellerId,appid:config.appId,out_trade_no:p.id,transaction_id:p.transactionId,out_refund_no:r.id,refund_id:data.out_request_no,status:'SUCCESS',amount:{total:p.amount,refund:r.amount??p.amount,payer_refund:r.amount??p.amount,currency:'CNY'},success_time:alipayDate(data.gmt_refund_pay)};
 }
 validateRefund(p,r,config,data){this.assertRefund(p);if(data.receiptProvider!=='alipay'||data.mchid!==config.sellerId||data.appid!==config.appId||data.out_trade_no!==p.id||data.transaction_id!==p.transactionId||data.out_refund_no!==r.id||data.refund_id!==r.id||data.status!=='SUCCESS'||data.amount?.total!==p.amount||data.amount.refund!==(r.amount??p.amount)||data.amount.payer_refund!==(r.amount??p.amount)||data.amount.currency!=='CNY'||!Number.isFinite(Date.parse(data.success_time)))mismatch();return'SUCCESS'}
 async processRefund(refundId){
  const e=this.engine;e.assertEnabled();const found=await e.db.paymentRefund.findUnique({where:{id:refundId},include:{payment:true}});if(!found||found.payment.provider!=='alipay')mismatch();
  const prepared=await e.tx(async db=>{const {p}=await e.locked(db,found.payment);await db.$queryRaw`SELECT id FROM PaymentRefund WHERE id=${refundId} FOR UPDATE`;const r=await db.paymentRefund.findUnique({where:{id:refundId}});if(!['PENDING','PROCESSING','ABNORMAL'].includes(r.state))return null;return{p,r,config:await this.credentials(p,db),token:await e.lease(db,'paymentRefund',r)}});if(!prepared)return;
  const {p,r,config,token}=prepared;let error;
  try{
   this.assertRefund(p);
   // Persisted attempts distinguish a first dispatch from crash/timeout recovery.
   // An uncertain dispatch is queried with its original out_request_no, never replaced.
   let data;
   const dispatch=async()=>{const accepted=await this.gateway.refund(config,p,r);this.identity(p,config,accepted);if(accepted.trade_no!==p.transactionId||accepted.out_request_no!==undefined&&accepted.out_request_no!==r.id||alipayCents(accepted.refund_fee)!==(r.amount??p.amount)||!['Y','N'].includes(accepted.fund_change))mismatch();return this.gateway.queryRefund(config,p,r)};
   if(!r.attempts)data=await dispatch();else try{data=await this.gateway.queryRefund(config,p,r)}catch(err){
    if(!err.authenticated||err.code!=='ALIPAY_TRADE_NOT_EXIST')throw err;
    const original=await this.gateway.query(config,p.id);this.validate(p,config,this.receipt(p,config,original));
    data=await dispatch(); // signed absence + original paid trade; same immutable refund number
   }
   if(data.refund_status!=='REFUND_SUCCESS')fail('ALIPAY_REFUND_UNCONFIRMED','退款结果尚未确认，请查询原退款单',409);
   await e.tx(db=>e.applyRefund(db,p,r,this.refundReceipt(p,r,config,data)));
  }catch(err){error=err;throw err}finally{await e.release('paymentRefund',r,token,error)}
 }
}
