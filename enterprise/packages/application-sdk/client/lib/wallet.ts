import {api,isH5} from './api'
export {consumerScope,consumerReady,consumerLogin} from './api'

export type Wallet={points:{amount:number;version:number;unit:'POINT'};balance:{amount:number;version:number;unit:'CNY_CENT'}}
export type PointOffer={id:string;name:string;points:number;giftPoints:number;priceCents:number}
export type BalanceOffer={id:string;amountCents:number;giftCents:number}
export type RechargeCatalog={version:number;points:PointOffer[];balance:{tiers:BalanceOffer[];customEnabled:boolean;minCents:number;maxCents:number}}
export type RechargeInput=({kind:'points_recharge';packageId:string}|{kind:'balance_recharge';tierId:string}|{kind:'balance_custom';amountCents:number})&{version:number}
export type PaymentMethod={provider:string;available:boolean;reason:string|null;requiresSwitch?:boolean}
export function walletSummary(value:Wallet){if(!['points','balance'].every(key=>{const item=value?.[key as keyof Wallet];return Number.isSafeInteger(item?.amount)&&item.amount>=0&&item.unit===(key==='points'?'POINT':'CNY_CENT')}))throw Error('账户数据暂不可用，请重试');return value}
export async function readWallet(){return walletSummary(await api<Wallet>('/wallet'))}
export const rechargeClient=()=>!isH5?'mini':/MicroMessenger/i.test(navigator.userAgent)?'official':'h5'
export const rechargeKey=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==='x'?n:n&3|8).toString(16)})
