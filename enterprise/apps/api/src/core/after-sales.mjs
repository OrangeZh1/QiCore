import {randomUUID,createHash} from 'node:crypto';
import {hasApplicationPermission} from '../applications/registry.mjs';
import {z} from 'zod';
import {fail,Fault} from './errors.mjs';
import {recordPaymentProviders} from './financial-records.mjs';
import {consumerIdentities,consumerIdentity} from '../applications/consumer-profiles.mjs';

const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),reason=z.string().trim().min(1).max(200);
const states=['APPLIED','REJECTED','PENDING','PROCESSING','ABNORMAL','CLOSED','SUCCESS'];
const paging={page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)};
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail('AFTER_SALE_INPUT_INVALID','请检查售后单、原因和分页参数');return r.data};
const newId=()=>randomUUID().replaceAll('-','');
const paymentSelect={id:true,tenantId:true,applicationKey:true,orderId:true,userId:true,amount:true,payerTotal:true,currency:true,paidAt:true,state:true,provider:true,sequence:true,currentSlot:true,providerState:true};
const providers=recordPaymentProviders.filter(p=>p.key!=='unknown');
const paymentInfo=p=>({paymentId:p.id,provider:p.provider,providerLabel:(providers.find(r=>r.key===p.provider)?.label||'未知支付方式')+(p.provider==='wechat-virtual'&&p.providerState?.orderType===7?' · Apple':''),paymentSequence:p.sequence,currentPayment:p.currentSlot===1});
// Pre-partial-refund rows have amount=null; the executor treats them as full-order requests.
const adminExpose=(r,p)=>({...expose(r),...paymentInfo(p),orderId:p.orderId,requestedCents:r.amount??p.amount,legacyFullRefund:r.amount==null,amountCents:p.amount,payerTotalCents:p.payerTotal,currency:p.currency,payerRefundCents:r.state==='SUCCESS'?r.payerRefund:null,succeededAt:r.state==='SUCCESS'?r.succeededAt:null});
const expose=r=>({id:r.id,requestedCents:r.amount??null,sequence:r.sequence,previousId:r.previousId,source:r.source,state:r.state,reason:r.reason,reviewReason:r.reviewReason,reviewedAt:r.reviewedAt,createdAt:r.createdAt,succeededAt:r.succeededAt,payerRefundCents:r.payerRefund,lastError:r.lastError});
const canDelete=(order,p,refund)=>['paid','cancelled','refunded'].includes(order.status)&&(!refund||['REJECTED','SUCCESS'].includes(refund.state))&&(!p||({paid:'PAID',cancelled:'CLOSED',refunded:'REFUNDED'})[order.status]===p.state);

export class AfterSales {
 constructor(db,payments){this.db=db;this.payments=payments;this.apps=payments.settings.apps}
 async access(db,s,tenantId,key,write=false){return this.apps.admin(s,tenantId,key,write?'orders.manage':'orders.read',db,write)}
 async record(db,s,tenantId,key,id,write=false){
  parse(identifier,id);await this.access(db,s,tenantId,key,write);
  const row=await db.paymentRefund.findFirst({where:{id,payment:{tenantId,applicationKey:key}},include:{payment:true}});
  if(!row)fail('NOT_FOUND','售后订单不存在',404);return row;
 }
 async audit(db,s,p,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:p.tenantId,applicationKey:p.applicationKey,actor:s.impersonatedBy||s.id,action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
 async apply(s,orderId,input){
  const q=parse(z.object({requestKey:identifier,reason}).strict(),input);
  return this.payments.tx(async db=>{
   const found=await this.payments.owned(s,orderId,db),{p,order}=await this.payments.locked(db,found);
   if(order.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
   const duplicate=await db.paymentRefund.findUnique({where:{paymentId_requestKey:{paymentId:p.id,requestKey:q.requestKey}}});
   if(duplicate){if(duplicate.reason!==q.reason)fail('AFTER_SALE_CONFLICT','同一申请编号不能更换退款原因',409);return expose(duplicate)}
   const latest=await this.payments.latestRefund(db,p.id);
   if(latest&&!['REJECTED','SUCCESS'].includes(latest.state))return expose(latest);
   if(!p.paidAt||!['PAID','PARTIAL_REFUND'].includes(p.state)||!['paid','partial_refund'].includes(order.status))fail('REFUND_NOT_ALLOWED','订单当前不能申请退款',409);
   const available=await this.payments.refundSummary(db,p);if(available.remaining<=0)fail('REFUND_NOT_ALLOWED','订单已全部退款',409);
   const row=await db.paymentRefund.create({data:{id:newId(),paymentId:p.id,amount:available.remaining,sequence:(latest?.sequence||0)+1,requestKey:q.requestKey,source:'consumer',reason:q.reason,state:'APPLIED'}});
   await this.audit(db,{id:'consumer:'+createHash('sha256').update(s.userId).digest('hex').slice(0,48)},p,'after-sale.apply',{refundId:row.id,orderId});return expose(row);
  });
 }
 async consumerOrders(s,input={}){
  const q=parse(z.object({...paging,status:z.enum(['all','pending','paid','refunded','cancelled']).optional(),category:z.enum(['all','packages']).optional()}).strict(),input);
  return this.payments.tx(async db=>{
   await this.payments.app(s.applicationKey).authorize(db,s);
   const result=await this.payments.app(s.applicationKey).orders(db,s,q);
   const payments=await db.paymentRecord.findMany({where:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,orderId:{in:result.items.map(o=>o.id)},currentSlot:1},include:{refunds:{orderBy:{sequence:'desc'},take:1}}});
   return{...result,items:result.items.map(order=>{const p=payments.find(p=>p.orderId===order.id),r=p?.refunds[0];return{...order,payerTotalCents:p?.payerTotal??null,afterSale:r?expose(r):null,canDelete:canDelete(order,p,r),canApply:!!p?.paidAt&&['PAID','PARTIAL_REFUND'].includes(p.state)&&['paid','partial_refund'].includes(order.status)&&(!r||['REJECTED','SUCCESS'].includes(r.state))}})};
  });
 }
 async removeOrder(s,orderId){
  parse(identifier,orderId);
  return this.payments.tx(async db=>{
   const app=this.payments.app(s.applicationKey);await app.authorize(db,s);
   const order=await app.lock(db,s.tenantId,orderId);
   if(order.userId!==s.userId)fail('NOT_FOUND','订单不存在',404);
   await app.authorize(db,s);
   if(order.consumerDeletedAt)return{deleted:true};
   const p=await db.paymentRecord.findFirst({where:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,orderId,currentSlot:1}}),refund=p?await this.payments.latestRefund(db,p.id):null;
   if(!canDelete(order,p,refund))fail('ORDER_DELETE_NOT_ALLOWED','当前订单不能删除，请先完成取消或售后处理',409);
   if(!app.removeFromConsumer)fail('ORDER_DELETE_UNAVAILABLE','当前应用暂不支持删除订单',409);
   await app.removeFromConsumer(db,order);
   await this.audit(db,{id:'consumer:'+createHash('sha256').update(s.userId).digest('hex').slice(0,48)},s,'order.consumer-delete',{orderId,status:order.status});
   return{deleted:true};
  });
 }
 async consumerHistory(s,orderId){return this.payments.tx(async db=>{await this.payments.owned(s,orderId,db);return(await db.paymentRefund.findMany({where:{payment:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,orderId}},orderBy:[{createdAt:'desc'},{sequence:'desc'}],include:{payment:{select:{provider:true}}}})).map(r=>({...expose(r),paymentId:r.paymentId,provider:r.payment.provider}))})}
 async list(s,tenantId,input={}){
  const q=parse(z.object({...paging,applicationKey:identifier.optional(),state:z.enum(['all',...states]).default('all'),provider:z.enum(['all','balance','wechat','alipay','wechat-virtual']).default('all'),q:z.string().trim().max(100).default('')}).strict(),input);
  const context=await this.apps.featureContext(this.db,s,tenantId,q.applicationKey,'payments','orders.read'),key=context.selected?.key;
  if(!key)return{items:[],total:0,...q,applicationKey:null,applications:context.sources,providers};
  await this.access(this.db,s,tenantId,key);
  const where={payment:{tenantId,applicationKey:key,...(q.provider==='all'?{}:{provider:q.provider})},...(q.q?{OR:[{id:{contains:q.q}},{payment:{orderId:{contains:q.q}}},{payment:{id:{contains:q.q}}},{payment:{userId:{contains:q.q}}}]}:{}),...(q.state==='all'?{}:{state:q.state})};
  const result=await this.db.$transaction(async db=>{await this.access(db,s,tenantId,key);const total=await db.paymentRefund.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize))),rows=await db.paymentRefund.findMany({where,include:{payment:{select:paymentSelect}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*q.pageSize,take:q.pageSize});
   const users=await consumerIdentities(db,tenantId,rows.map(r=>r.payment.userId),key);return{items:rows.map(r=>({...adminExpose(r,r.payment),user:consumerIdentity(r.payment.userId,users)})),total,page,pageSize:q.pageSize,applicationKey:key,applications:context.sources,providers};
  },{isolationLevel:'RepeatableRead'});await this.access(this.db,s,tenantId,key);return result;
 }
 async detail(s,tenantId,key,id){
  await this.access(this.db,s,tenantId,key);
  const result=await this.db.$transaction(async db=>{
   const row=await this.record(db,s,tenantId,key,id),p=row.payment,history=await db.paymentRefund.findMany({where:{paymentId:p.id},orderBy:{sequence:'desc'}}),latest=history[0];
   const actor=await this.apps.actor(db,s,'tenant',tenantId),canManage=hasApplicationPermission(s.permissions,key,'orders.manage')&&hasApplicationPermission(actor.role.permissions,key,'orders.manage'),canReview=canManage&&latest?.id===id&&row.state==='APPLIED';
   const users=await consumerIdentities(db,tenantId,[p.userId],key);let preview=null,approveUnavailableReason=null,summary=null;
   try{preview=await this.payments.app(key).refundPreview?.(db,p)}catch(e){if(!(e instanceof Fault)||e.status>=500)throw e;approveUnavailableReason=e.message}
   try{summary=await this.payments.refundSummary(db,p,history);if(p.provider==='alipay')this.payments.alipay.assertRefund(p);if(p.provider==='wechat-virtual')this.payments.virtual.assertRefund(p)}catch(e){if(!(e instanceof Fault)||e.status>=500)throw e;approveUnavailableReason=e.message}
   approveUnavailableReason=approveUnavailableReason||(!canManage?'没有退款处理权限':latest?.id!==id||row.state!=='APPLIED'?'该申请已处理或已有后续记录':p.currentSlot!==1?'该申请属于已切换的历史支付，请核查原支付补偿':!p.paidAt||!['PAID','PARTIAL_REFUND'].includes(p.state)?'原支付状态需要核查':!summary||(row.amount??p.amount)>summary.remaining?'申请金额超过剩余可退金额':!preview?'当前应用未提供退款核查':preview.refundUnavailableReason||null);
   if(!approveUnavailableReason&&p.provider!=='balance'&&!this.payments.enabled)approveUnavailableReason='真实渠道退款尚未开放';
   const retryUnavailableReason=!canManage?'没有退款处理权限':latest?.id!==id||row.state!=='CLOSED'?'仅可重试当前已关闭的退款':p.provider!=='wechat'?'当前渠道须继续查询原退款，不能另建退款尝试':!this.payments.enabled?'真实渠道退款尚未开放':!row.refundId?'缺少渠道退款记录，请核查原退款':p.state==='REFUNDED'?'原支付已全部退款':row.leaseUntil&&row.leaseUntil>new Date()?'原退款仍在处理中，请稍后刷新':null;
   const successful=history.filter(r=>r.state==='SUCCESS'),payerRefundedCents=successful.every(r=>Number.isSafeInteger(r.payerRefund)&&r.payerRefund>=0)?successful.reduce((n,r)=>n+r.payerRefund,0):null;
   if(payerRefundedCents===null)approveUnavailableReason='已有成功退款缺少实际金额，请核查原退款凭证';
   return{...adminExpose(row,p),user:consumerIdentity(p.userId,users),history:history.map(r=>adminExpose(r,p)),orderName:preview?.orderName||null,orderKind:preview?.orderKind||null,refundEffect:p.currentSlot!==1||row.source==='compensation'?'只退回本次支付的款项，不回收当前支付或其他订单的资产。':preview?.refundEffect||'原订单资产处理规则需要核查。',remainingRequestedCents:summary?.remaining??null,payerRefundedCents,canReview,canReject:canReview,canApprove:canReview&&!approveUnavailableReason,approveUnavailableReason,canRetry:!retryUnavailableReason,retryUnavailableReason};
  },{isolationLevel:'RepeatableRead'});
  await this.access(this.db,s,tenantId,key);const actor=await this.apps.actor(this.db,s,'tenant',tenantId);if(!hasApplicationPermission(actor.role.permissions,key,'orders.manage'))Object.assign(result,{canReview:false,canReject:false,canApprove:false,canRetry:false,approveUnavailableReason:'没有退款处理权限',retryUnavailableReason:'没有退款处理权限'});return result;
 }
 async review(s,tenantId,key,id,input){
  const q=parse(z.object({decision:z.enum(['approve','reject']),reason}).strict(),input);
  return this.payments.tx(async db=>{
   const before=await this.record(db,s,tenantId,key,id,true),{p,order}=await this.payments.locked(db,before.payment),row=await db.paymentRefund.findUnique({where:{id}});
   if(q.decision==='approve'&&p.provider!=='balance')this.payments.assertEnabled();
   if(row.state!=='APPLIED'){
    if(row.reviewedBy===s.id&&row.reviewReason===q.reason&&(q.decision==='reject'?row.state==='REJECTED':!!row.reviewedAt&&row.state!=='REJECTED'))return expose(row);
    fail('AFTER_SALE_REVIEWED','售后申请已处理，请刷新查看',409);
   }
   if((await this.payments.latestRefund(db,p.id))?.id!==id)fail('AFTER_SALE_REVIEWED','已有后续售后记录，请刷新查看',409);
   if(q.decision==='approve'){if(p.currentSlot!==1)fail('REFUND_NOT_ALLOWED','历史支付需要核查原支付补偿，不能回收当前订单资产',409);if(p.provider==='alipay')this.payments.alipay.assertRefund(p);if(p.provider==='wechat-virtual')this.payments.virtual.assertRefund(p);if(!p.paidAt||!['PAID','PARTIAL_REFUND'].includes(p.state))fail('REFUND_NOT_ALLOWED','原支付状态需要核查',409);const available=await this.payments.refundSummary(db,p);if(available.rows.some(r=>r.state==='SUCCESS'&&(!Number.isSafeInteger(r.payerRefund)||r.payerRefund<0)))fail('REFUND_LEDGER_MISMATCH','已有成功退款缺少实际金额，请核查原退款凭证',409);if((row.amount??p.amount)>available.remaining)fail('REFUND_AMOUNT_INVALID','申请金额超过剩余可退金额',409);await this.payments.app(key).reserveRefund(db,order)}
   const updated=await db.paymentRefund.update({where:{id},data:{state:q.decision==='approve'?'PENDING':'REJECTED',reviewedBy:s.id,reviewReason:q.reason,reviewedAt:new Date(),nextCheckAt:new Date()}});
   await this.audit(db,s,p,'after-sale.'+q.decision,{refundId:id,orderId:p.orderId,reason:q.reason});return expose(updated);
  });
 }
 async retry(s,tenantId,key,id,input){
  this.payments.assertEnabled();const q=parse(z.object({reason}).strict(),input);
  const prepared=await this.payments.tx(async db=>{
   const row=await this.record(db,s,tenantId,key,id,true),{p}=await this.payments.locked(db,row.payment),latest=await this.payments.latestRefund(db,p.id);
   if(p.provider!=='wechat')fail('REFUND_RETRY_NOT_ALLOWED','请查询原退款结果，当前渠道不支持另建退款尝试',409);if(latest?.previousId===id)return{done:latest};
   if(latest?.id!==id||row.state!=='CLOSED'||!row.refundId||p.state==='REFUNDED')fail('REFUND_RETRY_NOT_ALLOWED','仅可重试当前已关闭且有渠道记录的退款',409);
   return{p,r:row,config:await this.payments.credentials(p,db),token:await this.payments.lease(db,'paymentRefund',row)};
  });
  if(prepared.done)return expose(prepared.done);
  const {p,r,config,token}=prepared;let failure;
  try{
   const {data}=await this.payments.gateway.queryRefund(config,r.id);
   if(this.payments.validateRefund(p,r,config,data)!=='CLOSED'||data.amount.payer_refund!==0)fail('REFUND_RETRY_UNCONFIRMED','渠道尚未确认退款关闭且未退款，请先核查原记录',409);
   return await this.payments.tx(async db=>{
    await this.access(db,s,tenantId,key,true);const current=await this.payments.locked(db,p),latest=await this.payments.latestRefund(db,p.id),old=await db.paymentRefund.findUnique({where:{id}});
    if(latest?.previousId===id)return expose(latest);
    if(latest?.id!==id||old.state!=='CLOSED'||old.leaseToken!==token||old.leaseUntil<=new Date()||current.p.state==='REFUNDED')fail('REFUND_RETRY_CONFLICT','退款记录已变化，请刷新核对',409);
    const next=await db.paymentRefund.create({data:{id:newId(),paymentId:p.id,amount:r.amount??p.amount,sequence:r.sequence+1,previousId:id,source:r.source,reason:r.reason,state:'PENDING',reviewedBy:s.id,reviewedAt:new Date(),reviewReason:q.reason}});
    await this.audit(db,s,p,'after-sale.retry',{refundId:next.id,previousId:id,orderId:p.orderId,reason:q.reason});return expose(next);
   });
  }catch(e){failure=e;throw e}finally{await this.payments.release('paymentRefund',r,token,failure)}
 }
}
