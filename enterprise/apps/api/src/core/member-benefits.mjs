import {z} from 'zod';
import {neutralMemberBenefits,readDefaultMemberLevel} from './member-defaults.mjs';
import {fail} from './errors.mjs';

// Framework-owned policies. Applications quote orders through this contract, not by grade name.
export const memberBenefitsSchema=z.object({discountBps:z.number().int().min(100).max(10000).multipleOf(100),growthMultiplierBps:z.number().int().min(10000).max(1000000).multipleOf(1000)}).strict();
export const memberBenefitDefinitions=[
 {key:'discountBps',label:'购买折扣',unit:'折',scale:1000,min:0.1,max:10,step:0.1,defaultValue:10000,help:'10 折为原价，支持 0.1–10 折。按分计算，不足 1 分向上取整。'},
 {key:'growthMultiplierBps',label:'消费成长值倍率',unit:'倍',scale:10000,min:1,max:100,step:0.1,defaultValue:10000,help:'在消费赠送成长值的基础比例上计算，1 倍为原倍率；不影响注册赠送。'}
];
export const memberBenefits=value=>memberBenefitsSchema.parse({...neutralMemberBenefits(),...value});
export async function memberBenefitSnapshot(db,tenantId,applicationKey,userId){
 const profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId,applicationKey,userId}},include:{memberLevel:true}});
 if(profile?.deletedAt||profile?.enabled===false)fail('MEMBER_DISABLED','用户已停用，不能使用等级权益',403);
 const current=profile?.memberLevel||await readDefaultMemberLevel(db,tenantId,applicationKey);
 return{levelId:current.id,levelName:current.name,levelVersion:current.version||0,...memberBenefits(current.benefits)};
}
export function memberOrderPrice(amount,snapshot){
 if(!Number.isSafeInteger(amount)||amount<1)fail('MEMBER_INPUT_INVALID','订单金额无效');
 const {discountBps}=memberBenefits({discountBps:snapshot.discountBps});
 return Number((BigInt(amount)*BigInt(discountBps)+9999n)/10000n);
}
