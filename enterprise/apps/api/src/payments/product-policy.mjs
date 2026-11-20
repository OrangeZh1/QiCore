import {fail} from '../core/errors.mjs';

export function assertPaymentClient(session,client){
 if(session.authProvider==='wechat'&&client!=='mini')fail('PAYMENT_CLIENT_MISMATCH','小程序登录身份不能改用其他端的支付通道',409);
}

// Product classification belongs to the trusted application adapter, never the request.
export function paymentProductKind(adapter,order){
 const kind=adapter.paymentKind?.(order);
 return ['virtual','physical'].includes(kind)?kind:'unknown';
}
export function miniPaymentProductReason(kind,provider){
 if(!['wechat','wechat-virtual'].includes(provider))return null;
 if(kind==='unknown')return '当前商品尚未声明支付类型，请联系管理员';
 if(kind==='virtual'&&provider==='wechat')return '小程序虚拟商品须使用微信虚拟支付';
 if(kind==='physical'&&provider==='wechat-virtual')return '实物商品不能使用微信虚拟支付';
 return null;
}
export function assertMiniPaymentProduct(kind,provider){
 const reason=miniPaymentProductReason(kind,provider);
 if(reason)fail('PAYMENT_PRODUCT_UNSUPPORTED',reason,409);
}
export async function miniSubjectType(db,scope,revisions){
 const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope}});
 if(mini?.config.subjectType!==undefined)return ['personal','business'].includes(mini.config.subjectType)?mini.config.subjectType:'unknown';
 if(!mini?.config.appId)return 'unknown';
 const virtual=revisions!==undefined?revisions.find(row=>row.provider==='wechat-virtual'):await db.tenantPaymentRevision.findFirst({where:{...scope,provider:'wechat-virtual'},orderBy:{version:'desc'}});
 return mini?.config.appId&&virtual?.config.appId===mini.config.appId&&['personal','business'].includes(virtual.config.subjectType)?virtual.config.subjectType:'unknown';
}
