import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../core/errors.mjs';
import {identityAad,wechatSessionAad} from '../core/wechat-consumer-auth.mjs';
import {VirtualGoodsClient,virtualPaymentParameters} from './virtual-goods-client.mjs';
import {paymentConfigured,validatePaymentKeys} from './config.mjs';
import {virtualRechargeOrder,virtualRechargeHash} from './virtual-recharge.mjs';
import {virtualCallback} from './virtual-callback.mjs';
import {consumerIdentities,consumerIdentity} from '../applications/consumer-profiles.mjs';

const scope=p=>({tenantId:p.tenantId,applicationKey:p.applicationKey});
const mismatch=()=>fail('PAYMENT_RECEIPT_MISMATCH','虚拟支付记录与原订单不匹配',409);
const terminal=p=>['PAID','PARTIAL_REFUND','COMPENSATION','REFUNDED','CLOSED','REVIEW'].includes(p.state);
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_|*@-]{8,64}$/.test(v);
const cents=v=>Number.isSafeInteger(v)&&v>=0;
const hash=v=>createHash('sha256').update(v).digest('hex');
const noticeAad=(p,n)=>['payment-notice',p.tenantId,p.applicationKey,p.id,n.id].join(':');

export class VirtualPayments {
 constructor(engine,gateway=new VirtualGoodsClient()){this.engine=engine;this.gateway=gateway}
 async adminOrders(s,tenantId,applicationKey,input={},paymentId=/** @type {string|null} */(null)){
  const parsed=z.object({q:z.string().trim().max(100).default(''),state:z.enum(['all','PREPARING','READY','PAID','PARTIAL_REFUND','COMPENSATION','REFUNDED','CLOSED','REVIEW']).default('all'),channel:z.enum(['all','standard','apple']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)}).strict().safeParse(input);if(!parsed.success||paymentId!==null&&!/^[a-f0-9]{32}$/.test(paymentId))fail('VIRTUAL_ORDER_INPUT_INVALID','请检查订单编号和查询条件');const q=parsed.data,e=this.engine;
  const result=await e.db.$transaction(async db=>{
   await e.settings.context(db,s,tenantId,applicationKey);await e.settings.apps.admin(s,tenantId,applicationKey,'orders.read',db);
   const where={tenantId,applicationKey,provider:'wechat-virtual',...(paymentId?{id:paymentId}:{}),...(q.state==='all'?{}:{state:q.state}),...(q.channel==='all'?{}:{providerState:{path:'$.orderType',equals:q.channel==='apple'?7:0}}),...(q.q?{OR:[{id:{contains:q.q}},{orderId:{contains:q.q}},{userId:{contains:q.q}}]}:{})};
   const total=await db.paymentRecord.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize))),rows=await db.paymentRecord.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*q.pageSize,take:paymentId?1:q.pageSize,include:{refunds:{orderBy:{sequence:'desc'}}}});
   if(paymentId&&!rows.length)fail('NOT_FOUND','虚拟支付记录不存在',404);
   const orders=await db.rechargeOrder.findMany({where:{tenantId,applicationKey,id:{in:rows.map(p=>p.orderId)}},select:{id:true,kind:true,product:true,status:true}}),users=await consumerIdentities(db,tenantId,rows.map(p=>p.userId),applicationKey),revisions=await db.tenantPaymentRevision.findMany({where:{tenantId,applicationKey,id:{in:rows.map(p=>p.revisionId)}},select:{id:true,config:true}});
   const items=rows.map(p=>{const order=orders.find(o=>o.id===p.orderId),config=revisions.find(r=>r.id===p.revisionId)?.config;return{id:p.id,orderId:p.orderId,sequence:p.sequence,current:p.currentSlot===1,previousPaymentId:p.previousId,name:order?.product.name||'充值订单',kind:order?.kind||null,businessStatus:order?.status||null,user:consumerIdentity(p.userId,users),amountCents:p.amount,payerTotalCents:p.payerTotal,state:p.state,createdAt:p.createdAt,paidAt:p.paidAt,lastError:p.lastError,channel:p.providerState?.orderType===7?'apple':p.providerState?.orderType===0?'standard':'unknown',env:config?.env??null,subjectType:config?.subjectType||'business',delivery:p.providerState?.delivery||'pending',observedRefundCents:p.providerState?.observedRefundCents||0,refundedCents:p.refunds.filter(r=>r.state==='SUCCESS').reduce((n,r)=>n+(r.payerRefund||0),0),refunds:p.refunds.map(r=>({id:r.id,source:r.source,state:r.state,requestedCents:r.amount??p.amount,payerRefundCents:r.payerRefund,createdAt:r.createdAt,succeededAt:r.succeededAt,lastError:r.lastError}))}});
   return paymentId?items[0]:{items,total,page,pageSize:q.pageSize};
  },{isolationLevel:'RepeatableRead'});
  await e.settings.context(e.db,s,tenantId,applicationKey);await e.settings.apps.admin(s,tenantId,applicationKey,'orders.read');return result;
 }
 async credentials(p,db=this.engine.db){
  const e=this.engine,saved=e.payerData(p),original=await db.tenantPaymentRevision.findFirst({where:{id:p.revisionId,...scope(p),provider:'wechat-virtual'}});if(!original)mismatch();
  const compatible=(await db.tenantPaymentRevision.findMany({where:{...scope(p),provider:'wechat-virtual'},orderBy:{version:'desc'}})).filter(r=>r.config.appId===original.config.appId&&r.config.offerId===original.config.offerId&&r.config.env===original.config.env);
  let config;for(const row of compatible){const keys=e.settings.decrypt(row);try{validatePaymentKeys('wechat-virtual',row.config,keys,true);config={...row.config,appKey:row.config.env===0?keys.appKey:keys.sandboxAppKey};break}catch{}}
  if(!config)fail('PAYMENT_KEYS_UNAVAILABLE','原虚拟支付凭据不可用',503);
  const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(p)}});let appSecret=saved.appSecret;
  if(mini?.config.appId===config.appId&&mini.keyCipher)appSecret=e.secrets.decrypt('tenant-mini:'+p.tenantId+':'+p.applicationKey,mini.keyCipher).appSecret;
  if(!appSecret||saved.appId!==config.appId||saved.offerId!==config.offerId||saved.env!==config.env)mismatch();return{...config,appSecret};
 }
 async goods(db,s,o,config){
  const source=virtualRechargeOrder(o),goods=await db.virtualGoods.findMany({where:{...scope(s),appId:config.appId,offerId:config.offerId,env:config.env,localId:source.localId,publishState:'SUCCESS',uploadState:'SUCCESS'},orderBy:{updatedAt:'desc'}});
  const match=goods.find(g=>g.payload.price===o.amount&&g.payload.rechargeSnapshot&&virtualRechargeHash(g.payload.rechargeSnapshot)===virtualRechargeHash(source.snapshot));
  if(!match)fail('VIRTUAL_GOODS_UNAVAILABLE','该充值档位尚未上传发布，或商品与购买快照不一致',409);return match;
 }
 async pay(s,orderId,input,switchFrom=null){
  const e=this.engine;e.assertEnabled();if(!z.object({provider:z.literal('wechat-virtual')}).strict().safeParse(input).success||typeof orderId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(orderId))fail('PAYMENT_INPUT_INVALID','虚拟支付金额和身份由服务端确定');
  return e.tx(async db=>{
   const app=e.app(s.applicationKey);await app.authorize(db,s);const o=await app.lock(db,s.tenantId,orderId);if(o.userId!==s.userId||o.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
   const attempt=await e.attempt(db,s,orderId,'wechat-virtual','VIRTUAL_GOODS',switchFrom);let p=attempt.p;if(p&&terminal(p))return e.view(p,await e.latestRefund(db,p.id));
   await app.payable(db,o);await e.clientPolicy.allowed(db,s,'mini','wechat-virtual');
   if(s.authProvider!=='wechat')fail('WECHAT_LOGIN_REQUIRED','微信虚拟支付仅支持已授权的小程序用户',401);
   const session=await db.session.findUnique({where:{token:s.token}});if(!session?.wechatSessionCipher||session.authAppId!==s.authAppId)fail('WECHAT_SESSION_REFRESH_REQUIRED','请重新进行微信登录后支付',401);
   const identity=e.secrets.decrypt(wechatSessionAad(session),session.wechatSessionCipher);
   const external=await db.consumerExternalIdentity.findMany({where:{...scope(s),userId:s.userId,provider:'wechat',appId:s.authAppId}});
   if(external.length!==1||e.secrets.decrypt(identityAad(external[0]),external[0].identityCipher).openId!==identity.openId)mismatch();
   if(!p){
    const row=await db.tenantPaymentRevision.findFirst({where:{...scope(s),provider:'wechat-virtual'},orderBy:{version:'desc'}});
    await e.clientPolicy.product(db,s,'mini','wechat-virtual',app,o);
    if(!row||!paymentConfigured('wechat-virtual',row.config,row.secretFields))fail('PAYMENT_UNAVAILABLE','微信虚拟支付尚未配置完整',503);
    if(row.config.subjectType==='personal'&&!['callbackToken','encodingAESKey'].every(k=>row.secretFields.includes(k)))fail('VIRTUAL_CALLBACK_REQUIRED','个人主体请先配置安全消息推送凭据',409);
    if(s.authAppId!==row.config.appId)fail('MINI_PAYMENT_APPID_MISMATCH','请使用当前小程序的微信身份',409);
    const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(s)}});if(!mini?.keyCipher||mini.config.appId!==row.config.appId)fail('MINI_PAYMENT_APPID_MISMATCH','小程序与虚拟支付 AppID 不一致',409);
    const goods=await this.goods(db,s,o,row.config),id=randomUUID().replaceAll('-',''),signData=JSON.stringify({offerId:row.config.offerId,buyQuantity:1,env:row.config.env,currencyType:'CNY',productId:goods.productId,goodsPrice:o.amount,outTradeNo:id,attach:id});
    p=await db.paymentRecord.create({data:{id,...scope(s),...attempt.lineage,userId:s.userId,orderId,provider:'wechat-virtual',revisionId:row.id,amount:o.amount,currency:'CNY',state:'READY',expiresAt:new Date(Date.now()+15*60000),payerCipher:e.secrets.encrypt(['payment-payer',s.tenantId,s.applicationKey,id].join(':'),{mode:'VIRTUAL_GOODS',appId:row.config.appId,offerId:row.config.offerId,env:row.config.env,openId:identity.openId,appSecret:e.secrets.decrypt('tenant-mini:'+s.tenantId+':'+s.applicationKey,mini.keyCipher).appSecret,signData,goodsId:goods.id}),providerState:{delivery:'pending'}}});
   }
   if(p.closeRequested)fail('PAYMENT_CLOSING','原虚拟支付正在核查关闭状态，请查询原订单',409);
   const config=await this.credentials(p,db),saved=e.payerData(p);if(saved.openId!==identity.openId||saved.appId!==s.authAppId)mismatch();
   return{...e.view(p),virtualPaymentParams:virtualPaymentParameters(config,saved.signData,identity.sessionKey)};
  });
 }
 validate(p,c,data){
  if(data.receiptProvider!=='wechat-virtual'||data.appid!==c.appId||data.offerId!==c.offerId||data.env!==c.env||data.out_trade_no!==p.id||!validId(data.transaction_id)||data.amount?.total!==p.amount||!cents(data.amount.payer_total)||data.amount.payer_total>p.amount||data.amount.currency!=='CNY'||!Number.isFinite(Date.parse(data.success_time)))mismatch();
  if(p.transactionId&&(p.transactionId!==data.transaction_id||p.payerTotal!==data.amount.payer_total))mismatch();
 }
 validateOrder(p,c,o){
  if(!o||o.order_id!==p.id||o.env_type!==(c.env===0?1:2)||![0,7].includes(o.order_type)||o.order_fee!==p.amount||!cents(o.paid_fee)||o.paid_fee>p.amount||!Number.isInteger(o.status)||o.status<0||o.status>10)mismatch();
  if(p.providerState?.wxOrderId&&p.providerState.wxOrderId!==o.wx_order_id)mismatch();
  if([2,3,4].includes(o.status)&&(!validId(o.wx_order_id)||!Number.isSafeInteger(o.paid_time)||o.paid_time<=0||!cents(o.left_fee)||o.left_fee>p.amount))mismatch();
 }
 async recordQuery(p,o){
  const e=this.engine,proof=Object.fromEntries(['order_id','wx_order_id','order_type','env_type','order_fee','paid_fee','left_fee','paid_time','status'].filter(k=>o[k]!==undefined).map(k=>[k,o[k]])),payloadHash=hash(JSON.stringify(proof)),n={id:hash('virtual:'+p.id+':'+payloadHash),paymentId:p.id,kind:'virtual-query',payloadHash,state:'PENDING'};
  await e.tx(async db=>{if(await db.paymentNotice.findUnique({where:{id:n.id}}))return;await db.paymentNotice.create({data:{...n,payloadCipher:e.secrets.encrypt(noticeAad(p,n),proof)}})});return n.id;
 }
 async processNotice(n,p){
  if(n.kind==='virtual-push'){
   const e=this.engine;try{await this.reconcile(p.id);const latest=await e.db.paymentRecord.findUnique({where:{id:p.id}});if(!latest.paidAt&&latest.state!=='CLOSED')fail('VIRTUAL_PAYMENT_PENDING','支付尚未确认，请继续查询原单',409);await e.db.paymentNotice.updateMany({where:{id:n.id,state:'PENDING'},data:{state:'DONE',lastError:null}})}catch(err){await e.db.paymentNotice.updateMany({where:{id:n.id,state:'PENDING'},data:{attempts:{increment:1},lastError:'VIRTUAL_NOTICE_PENDING',nextCheckAt:new Date(Date.now()+60000)}});throw err}return;
  }
  const e=this.engine;try{await e.tx(async db=>{
   const {p:current}=await e.locked(db,p);await db.$queryRaw`SELECT id FROM PaymentNotice WHERE id=${n.id} FOR UPDATE`;const notice=await db.paymentNotice.findUnique({where:{id:n.id}});if(notice.state==='DONE')return;
   if(notice.kind!=='virtual-query')mismatch();const o=e.secrets.decrypt(noticeAad(p,n),notice.payloadCipher),c=await this.credentials(current,db);this.validateOrder(current,c,o);
   if(![2,3,4].includes(o.status)){
    await db.paymentRecord.update({where:{id:p.id},data:{state:'REVIEW',lastError:'VIRTUAL_ORDER_REVIEW',providerState:{...current.providerState,observedStatus:o.status,observedAt:new Date().toISOString()}}});
   }else{
    const summary=await e.refundSummary(db,current),observedRefund=p.amount-o.left_fee,previousRefund=current.providerState?.observedRefundCents||0;
    if(observedRefund>=previousRefund){
     await db.paymentRecord.update({where:{id:p.id},data:{providerState:{...current.providerState,wxOrderId:o.wx_order_id,orderType:o.order_type,delivery:o.status===4||current.providerState?.delivery==='delivered'?'delivered':'pending',observedRefundCents:observedRefund,observedAt:new Date().toISOString()}}});
     if(observedRefund>summary.refunded&&!summary.busy){await db.paymentRecord.update({where:{id:p.id},data:{state:'REVIEW',transactionId:o.wx_order_id,payerTotal:o.paid_fee,paidAt:new Date(o.paid_time*1000),lastError:'VIRTUAL_EXTERNAL_REFUND_REVIEW',nextCheckAt:new Date(Date.now()+1800000)}})}
     else await e.settle(db,current,{receiptProvider:'wechat-virtual',appid:c.appId,offerId:c.offerId,env:c.env,out_trade_no:p.id,transaction_id:o.wx_order_id,amount:{total:p.amount,payer_total:o.paid_fee,currency:'CNY'},success_time:new Date(o.paid_time*1000).toISOString()});
    }
   }
   await db.paymentNotice.update({where:{id:n.id},data:{state:'DONE',lastError:null}});
  })}catch(err){await e.db.paymentNotice.updateMany({where:{id:n.id,state:'PENDING'},data:{attempts:{increment:1},lastError:'VIRTUAL_SETTLEMENT_PENDING',nextCheckAt:new Date(Date.now()+60000)}});throw err}
 }
 async callback(tenantId,applicationKey,query,raw){
  const e=this.engine;if(![tenantId,applicationKey].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v))||raw!==undefined&&(!Buffer.isBuffer(raw)||raw.length>65536))fail('VIRTUAL_NOTICE_INVALID','通知参数无效',400);
  const rows=await e.db.tenantPaymentRevision.findMany({where:{tenantId,applicationKey,provider:'wechat-virtual'},orderBy:{version:'desc'}});let message,matched;
  let text;try{text=raw===undefined?undefined:new TextDecoder('utf-8',{fatal:true}).decode(raw)}catch{fail('VIRTUAL_NOTICE_INVALID','通知编码无效',400)}
  for(const row of rows){try{message=virtualCallback(row.config,e.settings.decrypt(row),query,text);matched=row;break}catch{}}
  if(!matched)fail('VIRTUAL_NOTICE_INVALID','消息签名或解密验证失败',403);
  if(raw===undefined)return{type:'text/plain',body:message};
  if(message.MsgType!=='event'||!['xpay_goods_deliver_notify','xpay_refund_notify','xpay_subscribe_ios_refund_query_notify'].includes(message.Event))fail('VIRTUAL_EVENT_UNSUPPORTED','该消息事件暂不支持',400);
  if(message.Event==='xpay_subscribe_ios_refund_query_notify')fail('VIRTUAL_IOS_REVIEW_REQUIRED','Apple 退款问询不自动决策，请由平台核查',503);
  const orderId=message.Event==='xpay_goods_deliver_notify'?message.OutTradeNo:message.MchOrderId;
  if(!validId(orderId))fail('VIRTUAL_NOTICE_INVALID','原支付编号无效',400);
  const p=await e.db.paymentRecord.findFirst({where:{id:orderId,tenantId,applicationKey,provider:'wechat-virtual'}});if(!p)fail('NOT_FOUND','原支付记录不存在',404);const saved=e.payerData(p);
  if(saved.appId!==matched.config.appId||message.OpenId!==saved.openId||message.Env!==undefined&&Number(message.Env)!==saved.env)mismatch();
  if(message.Event==='xpay_goods_deliver_notify'){const signData=JSON.parse(saved.signData),g=message.GoodsInfo;if(!g||g.ProductId!==signData.productId||Number(g.Quantity)!==1||g.OrigPrice!==undefined&&Number(g.OrigPrice)!==p.amount||g.ActualPrice!==undefined&&(!cents(Number(g.ActualPrice))||Number(g.ActualPrice)>p.amount)||g.Attach!==undefined&&g.Attach!==p.id)mismatch()}
  else if(!cents(Number(message.RefundFee))||Number(message.RefundFee)>p.amount||message.WxOrderId&&p.transactionId&&message.WxOrderId!==p.transactionId)mismatch();
  const proof=Object.fromEntries(['Event','OpenId','OutTradeNo','MchOrderId','WxOrderId','WxRefundId','MchRefundId','RefundFee','RetCode','GoodsInfo'].filter(k=>message[k]!==undefined).map(k=>[k,message[k]])),payloadHash=hash(JSON.stringify(proof)),n={id:hash('virtual-push:'+p.id+':'+payloadHash),paymentId:p.id,kind:'virtual-push',payloadHash,state:'PENDING'};
  await e.tx(async db=>{if(await db.paymentNotice.findUnique({where:{id:n.id}}))return;await db.paymentNotice.create({data:{...n,payloadCipher:e.secrets.encrypt(noticeAad(p,n),proof)}})});
  // A delivery ACK promises actual fulfilment. Refund ACK only acknowledges the
  // durable notification; its money remains subject to the original query.
  if(message.Event==='xpay_goods_deliver_notify'){await e.processNotice(n.id);const current=await e.db.paymentRecord.findUnique({where:{id:p.id}});if(!current.paidAt||['COMPENSATION','REVIEW'].includes(current.state))fail('VIRTUAL_DELIVERY_PENDING','原订单尚未完成交付，请继续查询',503)}
  return{type:'text/xml',body:'<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'};
 }
 async reconcile(paymentId){
  const e=this.engine;e.assertEnabled();const found=await e.db.paymentRecord.findUnique({where:{id:paymentId}});if(!found||found.provider!=='wechat-virtual')mismatch();
  const prepared=await e.tx(async db=>{const {p}=await e.locked(db,found);if(p.state==='REFUNDED')return null;return{p,c:await this.credentials(p,db),token:await e.lease(db,'paymentRecord',p)}});if(!prepared)return;
  const {p,c,token}=prepared;let error;
  try{
   const response=await this.gateway.call(c,'query_order',{openid:e.payer(p),env:c.env,...(p.providerState?.wxOrderId?{wx_order_id:p.providerState.wxOrderId}:{order_id:p.id})}),o=response.order;this.validateOrder(p,c,o);
   if(o.status===6){if(p.paidAt)mismatch();await e.tx(db=>e.closed(db,p,token));return}
   if([0,1].includes(o.status)){await e.db.paymentRecord.updateMany({where:{id:p.id,leaseToken:token,paidAt:null},data:{lastError:p.closeRequested?'VIRTUAL_CLOSE_UNCONFIRMED':null,nextCheckAt:new Date(Date.now()+60000)}});return}
   await e.processNotice(await this.recordQuery(p,o));
   const settled=await e.db.paymentRecord.findUnique({where:{id:p.id}});
   if(settled.state==='PAID'&&o.status!==4){await this.gateway.call(c,'notify_provide_goods',{wx_order_id:o.wx_order_id,env:c.env});await e.db.paymentRecord.updateMany({where:{id:p.id,leaseToken:token},data:{providerState:{...settled.providerState,delivery:'delivered'}}})}
   await e.db.paymentRecord.updateMany({where:{id:p.id,leaseToken:token},data:{nextCheckAt:new Date(Date.now()+1800000)}});
  }catch(err){error=err;throw err}finally{await e.release('paymentRecord',p,token,error)}
 }
 assertRefund(p){if(p.providerState?.orderType===7)fail('VIRTUAL_IOS_REFUND_REQUIRED','Apple 支付由用户在 App Store 申请退款，请核查平台退款结果',409);if(p.payerTotal!==p.amount)fail('VIRTUAL_PROMOTION_REFUND_REVIEW','优惠订单实际退款金额需核查，暂不支持自动退款',409)}
 validateRefund(p,r,c,data){this.assertRefund(p);if(data.receiptProvider!=='wechat-virtual'||data.appid!==c.appId||data.offerId!==c.offerId||data.env!==c.env||data.out_trade_no!==p.id||data.transaction_id!==p.transactionId||data.out_refund_no!==r.id||!validId(data.refund_id)||data.amount?.total!==p.amount||data.amount.refund!==(r.amount??p.amount)||data.amount.payer_refund!==(r.amount??p.amount)||data.amount.currency!=='CNY'||!Number.isFinite(Date.parse(data.success_time)))mismatch();if(r.refundId&&r.refundId!==data.refund_id)mismatch();return'SUCCESS'}
 async processRefund(refundId){
  const e=this.engine;e.assertEnabled();const found=await e.db.paymentRefund.findUnique({where:{id:refundId},include:{payment:true}});if(found?.payment.provider!=='wechat-virtual')mismatch();
  const prepared=await e.tx(async db=>{const {p}=await e.locked(db,found.payment);await db.$queryRaw`SELECT id FROM PaymentRefund WHERE id=${refundId} FOR UPDATE`;const r=await db.paymentRefund.findUnique({where:{id:refundId}});if(!['PENDING','PROCESSING','ABNORMAL'].includes(r.state))return null;return{p,r,c:await this.credentials(p,db),token:await e.lease(db,'paymentRefund',r)}});if(!prepared)return;
  const {p,r,c,token}=prepared;let error;
  try{
   this.assertRefund(p);const amount=r.amount??p.amount;
   if(!r.providerState?.dispatchStarted){
    const {order}=await this.gateway.call(c,'query_order',{openid:e.payer(p),env:c.env,wx_order_id:p.transactionId});this.validateOrder(p,c,order);const summary=await e.refundSummary(e.db,p);if(order.left_fee!==summary.remaining||amount>order.left_fee)fail('VIRTUAL_REFUND_REVIEW','渠道剩余可退金额与本地记录不一致',409);
    const payload={openid:e.payer(p),env:c.env,wx_order_id:p.transactionId,refund_order_id:r.id,left_fee:order.left_fee,refund_fee:amount,biz_meta:r.id,refund_reason:'5',req_from:r.source==='consumer'?'2':r.source==='admin'?'1':'3'};
    const marked=await e.db.paymentRefund.updateMany({where:{id:r.id,leaseToken:token,leaseUntil:{gt:new Date()}},data:{providerState:{dispatchStarted:true,originalLeftCents:order.left_fee}}});if(!marked.count)fail('PAYMENT_BUSY','退款操作已由其他请求接管',409);
    const accepted=await this.gateway.call(c,'refund_order',payload);
    if(accepted.refund_order_id!==r.id||accepted.pay_wx_order_id!==p.transactionId||accepted.pay_order_id!==p.id||!validId(accepted.refund_wx_order_id))mismatch();
    await e.db.paymentRefund.updateMany({where:{id:r.id,leaseToken:token},data:{state:'PROCESSING',refundId:accepted.refund_wx_order_id}});
   }
   // After timeout/crash, query the original refund number. No second dispatch
   // is inferred from an undocumented "not found" error code.
   const {order}=await this.gateway.call(c,'query_order',{openid:e.payer(p),env:c.env,order_id:r.id});
   if(!order||order.order_id!==r.id||order.order_type!==1||order.env_type!==(c.env===0?1:2)||order.refund_fee!==amount||order.biz_meta!==r.id||!validId(order.wx_order_id))mismatch();
   if(order.status!==8){if(![0,1,5,7].includes(order.status))mismatch();await e.db.paymentRefund.updateMany({where:{id:r.id,leaseToken:token},data:{state:order.status===7?'ABNORMAL':'PROCESSING',lastError:order.status===7?'VIRTUAL_REFUND_REVIEW':null}});return}
   if(!Number.isSafeInteger(order.paid_time)||order.paid_time<=0)mismatch();
   await e.tx(db=>e.applyRefund(db,p,r,{receiptProvider:'wechat-virtual',appid:c.appId,offerId:c.offerId,env:c.env,out_trade_no:p.id,transaction_id:p.transactionId,out_refund_no:r.id,refund_id:order.wx_order_id,amount:{total:p.amount,refund:amount,payer_refund:amount,currency:'CNY'},success_time:new Date(order.paid_time*1000).toISOString()}));
  }catch(err){error=err;throw err}finally{await e.release('paymentRefund',r,token,error)}
 }
}
