import {Prisma} from '@prisma/client';

export const recordPaymentProviders=[{key:'balance',label:'余额支付'},{key:'wechat',label:'微信支付'},{key:'alipay',label:'支付宝'},{key:'wechat-virtual',label:'微信虚拟支付'},{key:'unknown',label:'历史未记录'}];

// Counts describe orders; money describes actual payment attempts (including retired
// attempts and compensation). Aggregate receipts and refunds separately to avoid fanout.
export const overviewOrderRows=(tenantId,applicationKey,applicationOrders,now,userId)=>Prisma.sql`
 SELECT a.*,'application' source FROM (${applicationOrders}) a WHERE a.createdAt<=${now} AND ${userId===undefined?Prisma.sql`TRUE`:Prisma.sql`a.userId=${userId}`}
 UNION ALL SELECT id,userId,status,createdAt,kind source FROM RechargeOrder WHERE tenantId=${tenantId} AND applicationKey=${applicationKey} AND createdAt<=${now} AND ${userId===undefined?Prisma.sql`TRUE`:Prisma.sql`userId=${userId}`}`;
export async function orderOverview(db,tenantId,applicationKey,applicationOrders,{now,today,periodStart,userId}){
 const orders=overviewOrderRows(tenantId,applicationKey,applicationOrders,now,userId);
 const payments=Prisma.sql`FROM PaymentRecord p JOIN (${orders}) o ON o.id=p.orderId AND o.userId=p.userId WHERE p.tenantId=${tenantId} AND p.applicationKey=${applicationKey}`;
 const [groups,days,receipts,refunds,missing]=await Promise.all([
  db.$queryRaw(Prisma.sql`SELECT source,status,COUNT(*) total,SUM(createdAt>=${today}) todayTotal FROM (${orders}) o GROUP BY source,status`),
  db.$queryRaw(Prisma.sql`SELECT DATE_FORMAT(DATE_ADD(createdAt,INTERVAL 8 HOUR),'%Y-%m-%d') day,COUNT(*) total,SUM(status IN ('paid','partial_refund')) paid FROM (${orders}) o WHERE createdAt>=${periodStart} GROUP BY day ORDER BY day`),
  db.$queryRaw(Prisma.sql`SELECT p.provider,COALESCE(SUM(p.payerTotal),0) amount ${payments} AND p.currency='CNY' AND p.paidAt<=${now} AND p.payerTotal IS NOT NULL GROUP BY p.provider`),
  db.$queryRaw(Prisma.sql`SELECT p.provider,COALESCE(SUM(r.payerRefund),0) amount FROM PaymentRefund r JOIN PaymentRecord p ON p.id=r.paymentId JOIN (${orders}) o ON o.id=p.orderId AND o.userId=p.userId
   WHERE p.tenantId=${tenantId} AND p.applicationKey=${applicationKey} AND p.currency='CNY' AND r.state='SUCCESS' AND r.succeededAt<=${now} AND r.payerRefund IS NOT NULL GROUP BY p.provider`),
  db.$queryRaw(Prisma.sql`SELECT
   (SELECT COUNT(*) FROM (${orders}) o WHERE o.status IN ('paid','partial_refund','refunded','refund_pending','compensation_due') AND NOT EXISTS
    (SELECT 1 FROM PaymentRecord p WHERE p.tenantId=${tenantId} AND p.applicationKey=${applicationKey} AND p.orderId=o.id AND p.userId=o.userId AND p.paidAt<=${now} AND p.payerTotal IS NOT NULL)) ordersWithoutReceipt,
   (SELECT COUNT(*) FROM PaymentRefund r JOIN PaymentRecord p ON p.id=r.paymentId JOIN (${orders}) o ON o.id=p.orderId AND o.userId=p.userId
    WHERE p.tenantId=${tenantId} AND p.applicationKey=${applicationKey} AND p.currency='CNY' AND r.state='SUCCESS' AND (r.succeededAt IS NULL OR r.payerRefund IS NULL)) incompleteRefunds`)
 ]);
 const sum=condition=>groups.filter(condition).reduce((n,row)=>n+Number(row.total),0),status=value=>sum(row=>row.status===value);
 const amount=(rows,providers)=>rows.filter(row=>providers.includes(row.provider)).reduce((n,row)=>n+BigInt(row.amount.toString()),0n);
 const external=['wechat','alipay','wechat-virtual'],known=[...external,'balance'];
 const received=amount(receipts,external),refunded=amount(refunds,external),unknown=rows=>rows.filter(row=>!known.includes(row.provider)).reduce((n,row)=>n+BigInt(row.amount.toString()),0n).toString();
 return{total:sum(()=>true),todayTotal:groups.reduce((n,row)=>n+Number(row.todayTotal),0),paid:status('paid')+status('partial_refund'),pending:status('pending'),cancelled:status('cancelled'),partialRefund:status('partial_refund'),refunded:status('refunded'),refundPending:status('refund_pending'),compensationDue:status('compensation_due'),review:status('review'),
  sources:{application:sum(row=>row.source==='application'),pointsRecharge:sum(row=>row.source==='points_recharge'),balanceRecharge:sum(row=>row.source==='balance_recharge')},
  paidAmountCents:(received-refunded).toString(),
  funds:{externalReceivedCents:received.toString(),externalRefundedCents:refunded.toString(),externalNetCents:(received-refunded).toString(),balancePaidCents:amount(receipts,['balance']).toString(),balanceRefundedCents:amount(refunds,['balance']).toString(),unclassifiedReceivedCents:unknown(receipts),unclassifiedRefundedCents:unknown(refunds),ordersWithoutReceipt:Number(missing[0].ordersWithoutReceipt),incompleteRefunds:Number(missing[0].incompleteRefunds)},
  activity:Array.from({length:15},(_,i)=>{const day=new Date(periodStart.getTime()+i*86400000+8*3600000).toISOString().slice(0,10),row=days.find(row=>row.day===day);return{day,total:Number(row?.total||0),paid:Number(row?.paid||0)}})};
}

// Read projections only. Applications combine these with their own legacy sources
// before filtering/counting/paging; no wallet or business state is changed here.
export const walletPointsRows=(tenantId,applicationKey)=>Prisma.sql`
 SELECT CONCAT('wallet-',e.id) id,a.userId,'points' kind,e.delta,e.beforeAmount,e.afterAmount,e.createdAt occurredAt,
 e.kind operationKind,e.reason,e.actor actorName,e.reference,'wallet' recordSource,a.amount remaining,p.nickname,p.avatar
 FROM WalletEntry e JOIN WalletAccount a ON a.id=e.accountId
 LEFT JOIN ConsumerProfile p ON p.tenantId=a.tenantId AND p.applicationKey=a.applicationKey AND p.userId=a.userId
 WHERE a.tenantId=${tenantId} AND a.applicationKey=${applicationKey} AND a.asset='points'`;

export const rechargeTransactionRows=(tenantId,applicationKey)=>Prisma.sql`
 SELECT CONCAT('recharge-pay-',x.id) id,o.id orderId,o.userId,o.kind,JSON_UNQUOTE(JSON_EXTRACT(o.product,'$.name')) name,
 x.payerTotal amount,x.currency,CASE WHEN x.state='COMPENSATION' THEN 'compensation_due' WHEN x.state='REVIEW' THEN 'review' ELSE 'paid' END status,
 x.paidAt occurredAt,p.nickname,p.avatar,x.transactionId reference,x.provider,x.id paymentId,x.sequence,x.currentSlot,'recharge' recordSource,'receipt' flow
 FROM PaymentRecord x JOIN RechargeOrder o ON o.id=x.orderId AND o.tenantId=x.tenantId AND o.applicationKey=x.applicationKey AND o.userId=x.userId
 LEFT JOIN ConsumerProfile p ON p.tenantId=x.tenantId AND p.applicationKey=x.applicationKey AND p.userId=x.userId
 WHERE x.tenantId=${tenantId} AND x.applicationKey=${applicationKey} AND x.paidAt IS NOT NULL AND x.payerTotal IS NOT NULL
 UNION ALL
 SELECT CONCAT('recharge-refund-',r.id),o.id,o.userId,o.kind,JSON_UNQUOTE(JSON_EXTRACT(o.product,'$.name')),
 -r.payerRefund,x.currency,'refunded',r.succeededAt,p.nickname,p.avatar,r.refundId,x.provider,x.id,x.sequence,x.currentSlot,'recharge',
 CASE WHEN r.source='compensation' THEN 'compensation_refund' ELSE 'refund' END
 FROM PaymentRefund r JOIN PaymentRecord x ON x.id=r.paymentId
 JOIN RechargeOrder o ON o.id=x.orderId AND o.tenantId=x.tenantId AND o.applicationKey=x.applicationKey AND o.userId=x.userId
 LEFT JOIN ConsumerProfile p ON p.tenantId=x.tenantId AND p.applicationKey=x.applicationKey AND p.userId=x.userId
 WHERE x.tenantId=${tenantId} AND x.applicationKey=${applicationKey} AND r.state='SUCCESS' AND r.succeededAt IS NOT NULL AND r.payerRefund IS NOT NULL`;
