import {ApiError,isH5,sessionStorageKey} from './api'

export type VirtualPaymentParams={mode:'short_series_goods';signData:string;paySig:string;signature:string}
type VirtualSdk={canIUse?:(name:string)=>boolean;requestVirtualPayment?:(options:VirtualPaymentParams&{success:()=>void;fail:()=>void})=>void}
const sdk=()=>uni as unknown as VirtualSdk
export function virtualPaymentUnavailableReason(){
 if(isH5)return '请在微信小程序中使用'
 try{const api=sdk();if(typeof api.requestVirtualPayment!=='function'||api.canIUse&&!api.canIUse('requestVirtualPayment'))return '当前环境暂不支持微信虚拟支付'}catch{return '暂时无法确认虚拟支付能力，请重新打开页面'}
 return ''
}
export function assertVirtualPaymentIdentity(){
 const reason=virtualPaymentUnavailableReason();if(reason)throw new ApiError('PAYMENT_CLIENT_UNSUPPORTED',reason,409)
 const session=uni.getStorageSync(sessionStorageKey('zjz-session'));let appId=''
 try{appId=uni.getAccountInfoSync().miniProgram.appId}catch{}
 if(session?.mode!=='wechat'||!/^wx[a-zA-Z0-9]{16}$/.test(appId)||session.appId!==appId)throw new ApiError('WECHAT_LOGIN_REQUIRED','请使用当前小程序的微信身份重新登录',401)
}
export async function invokeVirtualPayment(order:{id:string;amountCents?:number;amount?:number},result:{orderId?:string;paymentId?:string;provider?:string;virtualPaymentParams?:VirtualPaymentParams},current:()=>void){
 current();assertVirtualPaymentIdentity()
 const params=result.virtualPaymentParams,amount=order.amountCents??order.amount,invalid=()=>new ApiError('VIRTUAL_PAYMENT_PARAMETERS_INVALID','虚拟支付信息不匹配，请查询原订单',409)
 if(result.orderId!==order.id||result.provider!=='wechat-virtual'||!result.paymentId||!/^[a-f0-9]{32}$/.test(result.paymentId)||!Number.isSafeInteger(amount)||!amount||amount<0||params?.mode!=='short_series_goods'||typeof params.signData!=='string'||params.signData.length>32768||!/^[a-f0-9]{64}$/i.test(params.paySig)||!/^[a-f0-9]{64}$/i.test(params.signature))throw invalid()
 let signed:any;try{signed=JSON.parse(params.signData)}catch{throw invalid()}
 if(!signed||signed.outTradeNo!==result.paymentId||signed.attach!==result.paymentId||signed.goodsPrice!==amount||signed.buyQuantity!==1||signed.currencyType!=='CNY'||![0,1].includes(signed.env)||typeof signed.offerId!=='string'||!/^\d{1,32}$/.test(signed.offerId)||typeof signed.productId!=='string'||!signed.productId||signed.productId.length>256)throw invalid()
 current()
 // Preserve the exact signed bytes. The SDK callback is never an account-credit receipt.
 await new Promise<void>(resolve=>{try{sdk().requestVirtualPayment!({mode:params.mode,signData:params.signData,paySig:params.paySig,signature:params.signature,success:()=>resolve(),fail:()=>resolve()})}catch{resolve()}})
 current()
}
