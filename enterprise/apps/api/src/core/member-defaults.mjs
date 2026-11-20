// Called inside new tenant/application provisioning, never while reading customer profiles.
export const neutralMemberBenefits=()=>({discountBps:10000,growthMultiplierBps:10000});
export function defaultMemberLevel(config){
 return{id:null,name:config?.deleted?'未设置等级':config?.name||'普通会员',threshold:0,rank:-1,upgradeMode:'all',conditions:{},description:config?.description||'',benefits:config?.deleted?neutralMemberBenefits():{...neutralMemberBenefits(),...config?.benefits},version:config?.version||0,updatedAt:config?.updatedAt||null,deleted:!!config?.deleted};
}
export async function readDefaultMemberLevel(db,tenantId,applicationKey){
 const rule=await db.memberRule.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});return defaultMemberLevel(rule?.baseLevel);
}
export async function initializeMemberLevels(db,tenantId,applicationKey){
 await db.memberLevel.createMany({data:[['vip','VIP会员',1],['svip','SVIP会员',2]].map(([systemKey,name,rank])=>({tenantId,applicationKey,id:'00000000-0000-4000-8000-00000000000'+rank,systemKey,name,rank,threshold:0,conditions:{}}))});
}
