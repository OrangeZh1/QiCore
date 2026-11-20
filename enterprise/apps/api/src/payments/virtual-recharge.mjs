import {createHash} from 'node:crypto';
import {application} from '../applications/registry.mjs';
import {fail} from '../core/errors.mjs';

export const virtualRechargeId=(asset,id)=>'recharge-'+asset+'-'+id;
export const virtualRechargeSnapshot=(asset,id,price,base,gift)=>({asset,id,price,base,gift});
export const virtualRechargeHash=snapshot=>createHash('sha256').update(JSON.stringify([snapshot.asset,snapshot.id,snapshot.price,snapshot.base,snapshot.gift])).digest('hex');
export async function virtualRechargeSources(db,tenantId,applicationKey){
 if(!application(applicationKey).virtualRecharge)return[];
 const row=await db.rechargeSetting.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey}}});if(!row)return[];
 return [...row.config.points.filter(p=>p.enabled).map(p=>({asset:'points',id:p.id,price:p.priceCents,base:p.points,gift:p.giftPoints,name:p.name,image:p.image})),...row.config.balance.tiers.filter(p=>p.enabled).map(p=>({asset:'balance',id:p.id,price:p.amountCents,base:p.amountCents,gift:p.giftCents,name:'余额充值 '+(p.amountCents/100).toFixed(2)+'元',image:p.image}))].map(p=>({localId:virtualRechargeId(p.asset,p.id),name:p.name,price:p.price,image:p.image,remark:p.asset==='points'?`${p.base} 积分，赠送 ${p.gift} 积分，长期有效`:`本站虚拟服务余额 ${p.base} 分，赠送 ${p.gift} 分，长期有效`,rechargeSnapshot:virtualRechargeSnapshot(p.asset,p.id,p.price,p.base,p.gift)}));
}
export function virtualRechargeOrder(o){
 if(!o._recharge||!application(o.applicationKey).virtualRecharge||!o.product?.id||!['points','balance'].includes(o.product.asset))fail('VIRTUAL_ORDER_UNSUPPORTED','微信虚拟支付仅支持已配置的积分套餐和固定余额充值档位',409);
 return{localId:virtualRechargeId(o.product.asset,o.product.id),snapshot:virtualRechargeSnapshot(o.product.asset,o.product.id,o.amount,o.product.base,o.product.gift)};
}
