import {api,consumerScope,getToken,isH5,sessionStorageKey,startOfficialLogin,ApiError} from './api'
import {runtimeConfig} from './runtime-config'
import {assertVirtualPaymentIdentity,invokeVirtualPayment,type VirtualPaymentParams} from './virtual-payment'

const scope=()=>runtimeConfig().apiBase+'|'+consumerScope()
function paymentGuard(){const own=scope(),token=getToken();return()=>{if(!token||scope()!==own)throw new ApiError('PAYMENT_IDENTITY_CHANGED','登录身份已变化，请重新打开订单',409)}}
type PaymentResult={state:string;orderId:string;provider?:string;paymentId?:string;previousPaymentId?:string|null;switchStatus?:'waiting'|'settled'|'completed';redirectUrl?:string;virtualPaymentParams?:VirtualPaymentParams;paymentParams?:{appId:string;timeStamp:string;nonceStr:string;package:string;signType:'RSA'|'HMAC-SHA256';paySign:string}}
type PaymentOptions={provider?:'balance'|'wechat'|'alipay'|'wechat-virtual';switchPaymentId?:string;onSwitch?:(status:'waiting'|'settled'|'completed')=>void;isCurrent?:()=>boolean}
async function officialPayment(params:NonNullable<PaymentResult['paymentParams']>,current:()=>void){
 const session=uni.getStorageSync(sessionStorageKey('zjz-session'));if(session?.appId!==params.appId)throw new ApiError('PAYMENT_APPID_MISMATCH','支付参数与当前公众号身份不一致',409)
 const bridge=await new Promise<any>((resolve,reject)=>{const bridge=(window as any).WeixinJSBridge;if(bridge)return resolve(bridge);const ready=()=>{clearTimeout(timer);resolve((window as any).WeixinJSBridge)},timer=setTimeout(()=>{document.removeEventListener('WeixinJSBridgeReady',ready);reject(new ApiError('WECHAT_BROWSER_REQUIRED','请在微信中完成支付',409))},8000);document.addEventListener('WeixinJSBridgeReady',ready,{once:true})})
 current();await new Promise<void>(resolve=>bridge.invoke('getBrandWCPayRequest',params,()=>resolve()))
}
const activePayments=new Map<string,{kind:string;operation:Promise<unknown>}>()
export function payOrder<T extends {id:string;status:string;kind?:string;amountCents?:number;amount?:number}>(order:T,options:PaymentOptions={}):Promise<T>{
 const key=scope()+':'+order.id,previous=activePayments.get(key),kind=(options.switchPaymentId||'pay')+':'+(options.provider||'wechat')
 if(previous)return previous.kind===kind?previous.operation as Promise<T>:Promise.reject(new ApiError('PAYMENT_BUSY','原支付操作尚未完成，请稍后查询',409))
 const guard=paymentGuard(),current=()=>{guard();if(options.isCurrent&&!options.isCurrent())throw new ApiError('PAYMENT_CONTEXT_CHANGED','页面已关闭，请重新打开原订单查询',409)}
 const operation=(async()=>{
  current()
  if(options.switchPaymentId&&(!/^[a-f0-9]{32}$/.test(options.switchPaymentId)||!options.provider))throw new ApiError('PAYMENT_INPUT_INVALID','原支付编号或目标方式无效，请重新读取',409)
  const submit=async(body:Record<string,string>)=>{
   const switching=!!options.switchPaymentId,result=await api<PaymentResult>('/orders/'+encodeURIComponent(order.id)+(switching?'/payment/switch':'/pay'),'POST',switching?{...body,paymentId:options.switchPaymentId,provider:options.provider}:body);current()
   if(result.orderId!==order.id)throw new ApiError('PAYMENT_RESULT_UNKNOWN','支付结果与原订单不匹配，请查询原订单',409)
   if(switching){if(!['waiting','settled','completed'].includes(result.switchStatus||'')||!result.paymentId||!/^[a-f0-9]{32}$/.test(result.paymentId)||result.switchStatus!=='completed'&&result.paymentId!==options.switchPaymentId||result.switchStatus==='completed'&&(result.previousPaymentId!==options.switchPaymentId||result.paymentId===options.switchPaymentId||result.provider!==options.provider))throw new ApiError('PAYMENT_RESULT_UNKNOWN','支付切换结果待确认，请查询原订单',409);options.onSwitch?.(result.switchStatus!)}return result
  }
  const read=async()=>{const result=await api<T>('/orders/'+encodeURIComponent(order.id));current();return result}
  if(options.provider==='wechat-virtual'){
   assertVirtualPaymentIdentity();if(!['points_recharge','balance_recharge'].includes(order.kind||''))throw new ApiError('PAYMENT_ORDER_UNSUPPORTED','当前订单不支持微信虚拟支付',409)
   const result=await submit({provider:'wechat-virtual'});if(options.switchPaymentId&&result.switchStatus!=='completed')return read()
   if(result.state==='READY')await invokeVirtualPayment(order,result,current)
   current();return queryOrder(order)
  }
  if(options.provider==='balance'){await submit({provider:'balance'});return read()}
  const inWechat=isH5&&/MicroMessenger/i.test(navigator.userAgent)
  if(options.provider==='alipay'){
   if(!isH5||inWechat)throw new ApiError('PAYMENT_CLIENT_UNSUPPORTED','支付宝仅支持普通 H5 浏览器收银台',409)
   const result=await submit({provider:'alipay',channel:'h5'});if(options.switchPaymentId&&result.switchStatus!=='completed')return read()
   if(result.redirectUrl){const url=new URL(result.redirectUrl);if(url.protocol!=='https:'||url.hostname!=='openapi.alipay.com'||url.pathname!=='/gateway.do'||url.username||url.password||url.port)throw new ApiError('PAYMENT_URL_INVALID','支付地址无效',409);location.assign(url.href);return order}
   return queryOrder(order)
  }
  if(inWechat&&uni.getStorageSync(sessionStorageKey('zjz-session'))?.mode!=='official'){
   if(options.switchPaymentId)throw new ApiError('WECHAT_LOGIN_REQUIRED','请先完成当前公众号身份授权',401)
   const result=await uni.showModal({title:'微信授权',content:'微信内支付需要绑定当前公众号身份。授权后可继续支付原订单。',confirmText:'授权微信'});current();if(result.confirm)await startOfficialLogin('/pages/orders/index?orderId='+encodeURIComponent(order.id));return order
  }
  const result=await submit(isH5&&!inWechat?{channel:'h5'}:{});if(options.switchPaymentId&&result.switchStatus!=='completed')return read()
  if(isH5&&result.redirectUrl){const url=new URL(result.redirectUrl);if(url.protocol!=='https:'||url.hostname!=='wx.tenpay.com'||url.username||url.password||url.port)throw new ApiError('PAYMENT_URL_INVALID','支付地址无效',409);location.assign(url.href);return order}
  if(result.paymentParams){
   const {appId,...params}=result.paymentParams
   if(!isH5&&uni.getAccountInfoSync().miniProgram.appId!==appId)throw new ApiError('PAYMENT_APPID_MISMATCH','支付参数与当前小程序不匹配',409)
   // The SDK callback is not a receipt. Reconcile the original order after success or cancellation.
   if(isH5)await officialPayment(result.paymentParams,current);else await new Promise<void>(resolve=>uni.requestPayment({provider:'wxpay',...params,success:()=>resolve(),fail:()=>resolve()}))
   current()
  }
  return queryOrder(order)
 })()
 activePayments.set(key,{kind,operation});void operation.finally(()=>{if(activePayments.get(key)?.operation===operation)activePayments.delete(key)}).catch(()=>{});return operation
}
export async function queryOrder<T extends {id:string}>(order:T){
 const current=paymentGuard();current()
 try{await api('/orders/'+encodeURIComponent(order.id)+'/reconcile','POST',{})}catch(e){if(!(e instanceof ApiError)||e.code!=='PAYMENT_NOT_STARTED')throw e}
 current();const result=await api<T>('/orders/'+encodeURIComponent(order.id));current();return result
}
