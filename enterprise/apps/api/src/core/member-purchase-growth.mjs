import {createHash} from 'node:crypto';
import {upgradeMemberFromOrder} from './member-management.mjs';
import {fail} from './errors.mjs';
import {readDefaultMemberLevel} from './member-defaults.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const level=async(db,tenantId,applicationKey,row)=>row?{id:row.id,name:row.name,rank:row.rank}:readDefaultMemberLevel(db,tenantId,applicationKey);
export function purchaseGrowth(cents,perYuan,multiplierBps=10000){return BigInt(cents)*BigInt(perYuan)*BigInt(multiplierBps)/1000000n}
export async function memberPurchaseSnapshot(db,tenantId,applicationKey){
 const rule=await db.memberRule.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});
 return{perYuan:rule?.purchaseGrowthPerYuan||0};
}
// Called by trusted settlement with actual payer cents, inside the tenant-locked transaction.
export async function awardMemberPurchase(db,tenantId,applicationKey,userId,orderId,{paidCents,perYuan=0,multiplierBps=10000}){
 const scope={tenantId,applicationKey},receiptKey={...scope,orderId},receiptWhere={tenantId_applicationKey_orderId:receiptKey},paid=BigInt(paidCents);
 if(paid<0n||!Number.isInteger(perYuan)||perYuan<0||perYuan>2147483647||!Number.isInteger(multiplierBps)||multiplierBps<10000||multiplierBps>1000000)fail('MEMBER_INPUT_INVALID','消费成长值规则无效');
 const receipt=await db.memberPurchaseGrowth.findUnique({where:receiptWhere});
 if(receipt){if(receipt.userId!==userId||receipt.paidCents!==paid||receipt.perYuan!==perYuan||receipt.multiplierBps!==multiplierBps)fail('MEMBER_REQUEST_CONFLICT','消费成长值记录与订单不一致',409);return}
 const where={tenantId_applicationKey_userId:{...scope,userId}};let profile=await db.consumerProfile.findUnique({where,include:{memberLevel:true}});
 if(profile?.deletedAt||profile?.enabled===false)return;
 const before=profile?.growth||0,calculated=purchaseGrowth(paid,perYuan,multiplierBps),earned=Number(calculated>BigInt(2147483647-before)?BigInt(2147483647-before):calculated);
 await db.memberPurchaseGrowth.create({data:{...receiptKey,userId,perYuan,multiplierBps,paidCents:paid,earned}});
 if(earned){
  if(!profile)profile=await db.consumerProfile.create({data:{...scope,userId,nickname:userId},include:{memberLevel:true}});
  await db.consumerProfile.update({where,data:{growth:before+earned,version:{increment:1}}});
  await db.memberGrowthRecord.create({data:{...scope,userId,requestId:'purchase:'+hash(orderId).slice(0,48),payloadHash:hash(JSON.stringify({orderId,paidCents:paid.toString(),perYuan,multiplierBps})),kind:'purchase',before,after:before+earned,levelBefore:await level(db,tenantId,applicationKey,profile.memberLevel),levelAfter:await level(db,tenantId,applicationKey,profile.memberLevel),reason:'消费赠送成长值',actor:'system'}});
 }
 await upgradeMemberFromOrder(db,tenantId,applicationKey,userId,orderId);
}
// Successful cumulative payer refunds only; a replay cannot deduct again or lower a level.
export async function returnMemberPurchase(db,tenantId,applicationKey,userId,orderId,refundedCents){
 const scope={tenantId,applicationKey},where={tenantId_applicationKey_orderId:{...scope,orderId}},receipt=await db.memberPurchaseGrowth.findUnique({where});if(!receipt)return;
 const refunded=BigInt(refundedCents);if(receipt.userId!==userId||refunded<0n||refunded>receipt.paidCents)fail('MEMBER_INPUT_INVALID','退款成长值范围无效');
 if(refunded<=receipt.refundedCents)return;
 const remaining=purchaseGrowth(receipt.paidCents-refunded,receipt.perYuan,receipt.multiplierBps),returned=receipt.earned-Number(remaining>BigInt(receipt.earned)?BigInt(receipt.earned):remaining),delta=returned-receipt.returned;
 const profileKey={tenantId_applicationKey_userId:{...scope,userId}},profile=await db.consumerProfile.findUnique({where:profileKey,include:{memberLevel:true}});
 if(delta&&profile){
  const before=profile.growth,after=Math.max(0,before-delta);
  await db.consumerProfile.update({where:profileKey,data:{growth:after,version:{increment:1}}});
  await db.memberGrowthRecord.create({data:{...scope,userId,requestId:'return:'+hash(orderId+':'+refunded).slice(0,48),payloadHash:hash(JSON.stringify({orderId,refundedCents:refunded.toString()})),kind:'purchase_refund',before,after,levelBefore:await level(db,tenantId,applicationKey,profile.memberLevel),levelAfter:await level(db,tenantId,applicationKey,profile.memberLevel),reason:before<delta?'退款扣回成长值，余额不足部分不追扣':'退款扣回消费赠送成长值',actor:'system'}});
 }
 await db.memberPurchaseGrowth.update({where,data:{refundedCents:refunded,returned}});
}
