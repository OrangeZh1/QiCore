import { z } from 'zod'

export const neutralMemberBenefits=()=>({discountBps:10000,growthMultiplierBps:10000});
export function defaultMemberLevel(config){
 return{id:null,name:config?.deleted?'未设置等级':config?.name||'普通会员',threshold:0,rank:-1,upgradeMode:'all',conditions:{},description:config?.description||'',benefits:config?.deleted?neutralMemberBenefits():{...neutralMemberBenefits(),...config?.benefits},version:config?.version||0,updatedAt:config?.updatedAt||null,deleted:!!config?.deleted};
}
export const memberBenefitsSchema=z.object({discountBps:z.number().int().min(100).max(10000).multipleOf(100),growthMultiplierBps:z.number().int().min(10000).max(1000000).multipleOf(1000)}).strict();
export const memberBenefitDefinitions=[
 {key:'discountBps',label:'购买折扣',unit:'折',scale:1000,min:0.1,max:10,step:0.1,defaultValue:10000,help:'10 折为原价，支持 0.1–10 折。按分计算，不足 1 分向上取整。'},
 {key:'growthMultiplierBps',label:'消费成长值倍率',unit:'倍',scale:10000,min:1,max:100,step:0.1,defaultValue:10000,help:'在消费赠送成长值的基础比例上计算，1 倍为原倍率；不影响注册赠送。'}
];
export const memberBenefits=value=>memberBenefitsSchema.parse({...neutralMemberBenefits(),...value});
export function upgradeDescription(row){const c=row.conditions||{growth:row.threshold},parts=[];if(c.growth!==undefined)parts.push('成长值达到 '+c.growth);if(c.paidCents!==undefined){const cents=BigInt(c.paidCents);parts.push('累计实付达到 '+(cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0')+' 元')}if(c.paidOrders!==undefined)parts.push('有效订单达到 '+c.paidOrders+' 笔');return parts.join(row.upgradeMode==='any'?' 或 ':' 且 ')}
export function upgradedLevel(levels,growth,current=null,metrics={paidCents:'0',paidOrders:0}){
 return levels.filter(l=>{if(current&&(l.rank??l.threshold)<=(current.rank??current.threshold))return false;const c=l.conditions||{growth:l.threshold},checks=[];if(c.growth!==undefined)checks.push(growth>=c.growth);if(c.paidCents!==undefined)checks.push(BigInt(metrics.paidCents)>=BigInt(c.paidCents));if(c.paidOrders!==undefined)checks.push(metrics.paidOrders>=c.paidOrders);return checks.length>0&&(l.upgradeMode==='any'?checks.some(Boolean):checks.every(Boolean))}).sort((a,b)=>(b.rank??b.threshold)-(a.rank??a.threshold))[0]||current;
}
