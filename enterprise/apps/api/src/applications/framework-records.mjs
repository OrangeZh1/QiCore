import {Prisma} from '@prisma/client';
import {walletPointsRows,rechargeTransactionRows,recordPaymentProviders} from '../core/financial-records.mjs';

// Framework projections contain only public wallet/recharge tables. Application
// orders and benefits continue to come from their own trusted adapters.
export function frameworkRecords(applicationKey,kind){
 const points=kind==='points',catalog=points?{types:[{key:'credit',label:'增加'},{key:'debit',label:'扣减'}],statuses:[]}:{types:[{key:'points_recharge',label:'积分充值'},{key:'balance_recharge',label:'余额充值'}],statuses:[{key:'paid',label:'已支付'},{key:'refunded',label:'已退款'},{key:'review',label:'待核查'},{key:'compensation_due',label:'待补偿'}],providers:recordPaymentProviders};
 const expose=row=>({id:row.id,userId:row.userId,user:{id:row.userId,nickname:row.nickname,avatar:row.avatar},name:points?row.reason||row.operationKind:row.name,type:points?(BigInt(row.delta)>=0n?'credit':'debit'):row.kind,typeLabel:points?'公共积分':row.kind==='points_recharge'?'积分充值':'余额充值',status:points?'recorded':row.status,statusLabel:points?'已记录':catalog.statuses.find(item=>item.key===row.status)?.label,change:String(points?row.delta:row.amount),unit:points?'积分':row.currency,occurredAt:row.occurredAt,reference:row.reference,reason:row.reason,actorName:row.actorName,beforeAmount:row.beforeAmount?.toString(),afterAmount:row.afterAmount?.toString(),remaining:row.remaining===undefined?undefined:Number(row.remaining),orderId:row.orderId,paymentId:row.paymentId,providerLabel:recordPaymentProviders.find(item=>item.key===row.provider)?.label,sequence:row.sequence,currentPayment:row.currentSlot===1,sourceLabel:'公共充值',flowLabel:row.flow==='receipt'?'收款':'退款'});
 const source=tenantId=>points?walletPointsRows(tenantId,applicationKey):rechargeTransactionRows(tenantId,applicationKey);
 async function list(db,tenantId,q){
  const text=q.q?'%'+q.q+'%':null;
  const filter=Prisma.sql`WHERE ${text?Prisma.sql`(r.userId LIKE ${text} OR r.nickname LIKE ${text} OR r.id LIKE ${text} OR r.reference LIKE ${text})`:Prisma.sql`TRUE`}
   AND ${q.type==='all'?Prisma.sql`TRUE`:points?(q.type==='credit'?Prisma.sql`r.delta>=0`:Prisma.sql`r.delta<0`):Prisma.sql`r.kind=${q.type}`}
   AND ${q.status==='all'||points?Prisma.sql`TRUE`:Prisma.sql`r.status=${q.status}`}
   AND ${q.provider==='all'||points?Prisma.sql`TRUE`:Prisma.sql`r.provider=${q.provider}`}
   AND ${q.start?Prisma.sql`r.occurredAt>=${q.start}`:Prisma.sql`TRUE`} AND ${q.end?Prisma.sql`r.occurredAt<${q.end}`:Prisma.sql`TRUE`}`;
  const [count,rows]=await Promise.all([db.$queryRaw(Prisma.sql`SELECT COUNT(*) total FROM (${source(tenantId)}) r ${filter}`),db.$queryRaw(Prisma.sql`SELECT * FROM (${source(tenantId)}) r ${filter} ORDER BY r.occurredAt DESC,r.id DESC LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}`)]);
  return{items:rows.map(expose),total:Number(count[0].total),page:q.page,pageSize:q.pageSize};
 }
 async function detail(db,tenantId,id){const rows=await db.$queryRaw(Prisma.sql`SELECT * FROM (${source(tenantId)}) r WHERE r.id=${id}`);return rows[0]?expose(rows[0]):null}
 return{catalog,list,detail};
}
