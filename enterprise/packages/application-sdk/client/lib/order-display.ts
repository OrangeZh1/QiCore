export type OrderPaymentState='pending'|'processing'|'paid'|'failed'|'cancelled'|'unknown'|'refunded'|'partial_refund'|'compensation'|'refunding'|'switching'
export type ConsumerAfterSale={id:string;state:string;reason:string;reviewReason:string|null;createdAt:string;sequence:number;source?:string;requestedCents?:number|null;payerRefundCents?:number|null;provider?:string;paymentId?:string;reviewedAt?:string|null;succeededAt?:string|null}
export function refundAmount(value:number|null|undefined){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?'¥'+(value/100).toFixed(2):'暂未提供'}
export function paymentProvider(provider?:string|null){return({wechat:'微信支付',wechat_virtual:'微信虚拟支付','wechat-virtual':'微信虚拟支付',alipay:'支付宝',balance:'余额支付'} as Record<string,string>)[provider||'']||'暂未提供'}
export type ConsumerOrder={id:string;number?:string;name:string;kind?:string;status:string;amountCents:number;payerTotalCents:number|null;createdAt:string;paidAt?:string|null;method?:string|null;paymentState?:OrderPaymentState;demo?:boolean;canApply:boolean;canDelete:boolean;afterSale:ConsumerAfterSale|null}
export type ConsumerOrderDetail=ConsumerOrder&{originalAmountCents?:number;refundedCents?:number;fulfillment?:string;product?:{name?:string;kind?:string;points?:number;bonus?:number;rechargeCents?:number;bonusCents?:number;base?:number;gift?:number;asset?:'points'|'balance';quota?:number;membershipHours?:number|null};payment?:{state:string;paymentId?:string;previousPaymentId?:string|null;closeReason?:string|null;provider?:string;paidAt?:string|null;payerTotalCents?:number|null}}
export function normalizeOrder(value:any,fallback:Partial<ConsumerOrderDetail>={}):ConsumerOrderDetail{
 const amount=value.amountCents??value.amount??fallback.amountCents
 if(!value.id||!Number.isSafeInteger(amount)||amount<0)throw Error('订单金额暂不可用，请重新读取')
 const product=value.product?{...value.product}:fallback.product,kind=value.kind||product?.kind||fallback.kind
 if(product&&kind==='points_recharge'){product.points=product.base??product.points;product.bonus=product.gift??product.bonus}
 if(product&&kind==='balance_recharge'){product.rechargeCents=product.base??product.rechargeCents;product.bonusCents=product.gift??product.bonusCents}
 return{...fallback,...value,kind,product,amountCents:amount,name:product?.name||value.name||fallback.name||'订单',payerTotalCents:value.payment?.payerTotalCents??value.payerTotalCents??fallback.payerTotalCents??null}
}
export const paymentStates:Record<OrderPaymentState,{title:string;note:string;icon:string}>={
 pending:{title:'待支付',note:'请核对订单内容与应付金额。',icon:'wallet'},
 processing:{title:'支付处理中',note:'支付正在处理中，请勿重复付款。',icon:'clock'},
 switching:{title:'等待完成支付切换',note:'原订单已保留，请查询状态或继续原切换。',icon:'clock'},
 paid:{title:'支付成功',note:'可在订单详情中查看本次购买内容。',icon:'badge-check'},
 failed:{title:'支付失败',note:'本次支付未完成，请核对原订单状态后再继续。',icon:'circle-x'},
 cancelled:{title:'订单已取消',note:'该订单已关闭，不再继续支付。',icon:'circle-x'},
 unknown:{title:'支付结果待确认',note:'暂未取得明确结果，请稍后重新查询，避免重复付款。',icon:'circle-help'},
 partial_refund:{title:'部分退款',note:'订单已部分退款，具体处理情况可查看订单与售后记录。',icon:'rotate-ccw'},
 refunded:{title:'已退款',note:'退款结果以原支付渠道的实际记录为准。',icon:'rotate-ccw'},
 compensation:{title:'到账待处理',note:'付款结果已记录，到账或退款仍在处理中，请勿重复付款。',icon:'clock'},
 refunding:{title:'退款处理中',note:'退款结果尚未确认，请以原支付渠道的实际记录为准。',icon:'rotate-ccw'},
}
export function paymentState(order:ConsumerOrderDetail):OrderPaymentState{
 if(order.demo&&order.paymentState&&paymentStates[order.paymentState])return order.paymentState
 if(order.status==='compensation_due')return 'compensation'
 if(order.status==='refund_pending')return 'refunding'
 const state=order.payment?.state
 if(state){if(state==='PAID')return 'paid';if(state==='PARTIAL_REFUND')return 'partial_refund';if(state==='REFUNDED')return 'refunded';if(state==='CLOSED')return order.status==='pending'&&order.payment?.closeReason==='switch'?'pending':'cancelled';if(['NEW','READY'].includes(state))return 'pending';if(state==='PREPARING')return 'processing';return 'unknown'}
 return order.status==='paid'?'paid':order.status==='partial_refund'?'partial_refund':order.status==='cancelled'?'cancelled':order.status==='refunded'?'refunded':order.status==='pending'?'pending':'unknown'
}
export function orderKind(order:ConsumerOrderDetail){return({points_recharge:'积分套餐充值',balance_recharge:'余额充值',member:'历史订阅套餐',pack:'历史积分包',single:'应用服务'} as Record<string,string>)[order.kind||order.product?.kind||'']||'应用订单'}
export function paymentMethod(order:ConsumerOrderDetail){const provider=paymentProvider(order.method||order.payment?.provider);return provider==='暂未提供'&&['pending','cancelled'].includes(order.status)?'未支付':provider}
