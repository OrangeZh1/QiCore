import {randomUUID} from 'node:crypto';
import {Wallet,walletScope} from '../core/wallet.mjs';
import {fail} from '../core/errors.mjs';

// Internal tender uses the same PaymentRecord/PaymentRefund and fulfilment hooks.
// It never impersonates an external signed receipt or invokes a transport.
export class BalancePayments {
 constructor(engine){this.engine=engine;this.wallet=new Wallet(engine.db)}
 async pay(s,orderId,context={},switchFrom=null){const engine=this.engine,client=await engine.balanceClient(s,context);return engine.tx(async db=>{
  const app=engine.app(s.applicationKey);await app.authorize(db,s);const order=await app.lock(db,s.tenantId,orderId);
  if(order.userId!==s.userId||order.consumerDeletedAt)fail('NOT_FOUND','订单不存在',404);
  const attempt=await engine.attempt(db,s,orderId,'balance','BALANCE',switchFrom),previous=attempt.p;
  if(previous){const checked=await engine.locked(db,previous);return engine.view(checked.p,await engine.latestRefund(db,previous.id))}
  await app.payable(db,order);await app.balancePayable?.(db,order);
  await engine.clientPolicy.allowed(db,s,client,'balance');
  if(order.currency!=='CNY'||!Number.isSafeInteger(order.amount)||order.amount<=0)fail('PAYMENT_AMOUNT_INVALID','余额仅支持人民币正金额');
  const id=randomUUID().replaceAll('-',''),entry=await this.wallet.debit(db,s,'balance',{requestKey:'payment:'+id,kind:'spend',reference:orderId,amount:order.amount,reason:'订单余额付款',actor:'consumer'});
  const p=await db.paymentRecord.create({data:{id,...walletScope(s),...attempt.lineage,orderId,provider:'balance',revisionId:'internal-balance',payerCipher:engine.secrets.encrypt(['payment-payer',s.tenantId,s.applicationKey,id].join(':'),{entryId:entry.id,client,mode:'BALANCE'}),amount:order.amount,currency:'CNY',state:'PAID',transactionId:'balance'+id,payerTotal:order.amount,paidAt:new Date(),expiresAt:new Date()}});
  if(await app.settle(db,order,p))fail('ORDER_NOT_PAYABLE','订单当前无法履约，余额扣款已撤销',409);
  await app.afterSettlement?.(db,order,p);
  await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:s.tenantId,applicationKey:s.applicationKey,actor:'consumer',action:'payment.balance',details:{orderId,paymentId:id,entryId:entry.id,amountCents:order.amount}}});return engine.view(p);
 })}
 async refund(refundId){const engine=this.engine;return engine.tx(async db=>{
  const found=await db.paymentRefund.findUnique({where:{id:refundId},include:{payment:true}});if(!found||found.payment.provider!=='balance')fail('REFUND_SOURCE_INVALID','原余额支付不存在',409);
  const {p,order}=await engine.locked(db,found.payment);await db.$queryRaw`SELECT id FROM PaymentRefund WHERE id=${refundId} FOR UPDATE`;const r=await db.paymentRefund.findUnique({where:{id:refundId}});if(r.state==='SUCCESS')return;if(r.state!=='PENDING')fail('REFUND_NOT_ALLOWED','退款当前不能执行',409);
  const total=await engine.refundSummary(db,p),amount=r.amount??p.amount;if(amount>total.remaining)fail('REFUND_AMOUNT_INVALID','退款超过剩余金额',409);
  const original=engine.payerData(p).entryId;await this.wallet.restore(db,p,'balance',{requestKey:'refund:'+r.id,kind:'return',reference:original,amount,reason:'订单原路退回余额',actor:'system'},original);
  await db.paymentRefund.update({where:{id:r.id},data:{state:'SUCCESS',refundId:'balance'+r.id,payerRefund:amount,succeededAt:new Date(),lastError:null}});
  const full=total.refunded+amount===p.amount;await engine.app(p.applicationKey).refunded(db,order,full);await db.paymentRecord.update({where:{id:p.id},data:{state:full?'REFUNDED':'PARTIAL_REFUND'}});
  await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:p.tenantId,applicationKey:p.applicationKey,actor:'system',action:'payment.balance.refund',details:{orderId:p.orderId,refundId:r.id,amountCents:amount}}});
 })}
}
