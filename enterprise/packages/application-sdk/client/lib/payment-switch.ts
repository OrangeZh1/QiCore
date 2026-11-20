import {identityScope,ApiError} from './api'
import {runtimeConfig} from './runtime-config'

export type PaymentSwitch={paymentId:string;provider:'balance'|'wechat'|'alipay'|'wechat-virtual';client:'mini'|'official'|'h5';phase:'unknown'|'waiting'|'completed'}
function storageKey(orderId:string){const r=runtimeConfig();return 'zjz-payment-switch:'+encodeURIComponent(r.apiBase)+':'+r.tenantId+':'+r.applicationKey+':'+identityScope()+':'+encodeURIComponent(orderId)}
function same(a:PaymentSwitch,b:PaymentSwitch){return a.paymentId===b.paymentId&&a.provider===b.provider&&a.client===b.client}
export function readPaymentSwitch(orderId:string):PaymentSwitch|null{
 const value=uni.getStorageSync(storageKey(orderId));if(!value)return null
 if(typeof value!=='object'||!/^[a-f0-9]{32}$/.test(value.paymentId)||!['balance','wechat','alipay','wechat-virtual'].includes(value.provider)||!['mini','official','h5'].includes(value.client)||!['unknown','waiting','completed'].includes(value.phase))throw new ApiError('PAYMENT_RECOVERY_INVALID','支付恢复记录无效，请重新查询原订单',409)
 return{paymentId:value.paymentId,provider:value.provider,client:value.client,phase:value.phase}
}
export function rememberPaymentSwitch(orderId:string,value:PaymentSwitch){const old=readPaymentSwitch(orderId);if(old&&!same(old,value))throw new ApiError('PAYMENT_SWITCH_PENDING','请先查询并完成原支付切换',409);uni.setStorageSync(storageKey(orderId),{...value})}
export function forgetPaymentSwitch(orderId:string,value:PaymentSwitch){const old=readPaymentSwitch(orderId);if(old&&same(old,value))uni.removeStorageSync(storageKey(orderId))}
