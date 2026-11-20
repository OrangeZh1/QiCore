import {useMaintenanceReload} from './maintenance'
import {ref} from 'vue'
import {onShow,onUnload} from '@dcloudio/uni-app'
import {api,getToken,identityScope,message,consumerLogin} from './api'
import {runtimeConfig} from './runtime-config'
import {consumerReady,consumerScope,readWallet,rechargeKey,type Wallet,type RechargeCatalog,type RechargeInput} from './wallet'

type Pending={input:RechargeInput&{requestKey:string};id?:string}
export function useRecharge(asset:'points'|'balance'){
 const wallet=ref<Wallet|null>(null),catalog=ref<RechargeCatalog|null>(null),guest=ref(!getToken()),action=ref(''),error=ref(''),createAction=ref(''),createError=ref(''),pending=ref<Pending|null>(null)
 let alive=true,sequence=0,scope='',site=''
 const siteScope=()=>{const c=runtimeConfig();return[c.apiBase,c.tenantId,c.applicationKey].join('|')}
 const storage=()=> 'zjz-recharge:'+identityScope()+':'+asset
 const sameContext=(n:number,own:string)=>alive&&n===sequence&&site===siteScope()&&consumerScope()===own
 const current=(n:number,own:string)=>sameContext(n,own)&&!!getToken()
 function clearPrivate(){wallet.value=null;catalog.value=null;pending.value=null;createError.value='';createAction.value=''}
 function invalidate(cause:{scope:string;message:string}){
  if(!alive||scope!==cause.scope)return
  sequence++;clearPrivate();action.value='';scope=consumerScope();guest.value=!getToken();error.value=guest.value?'':cause.message
 }
 async function load(source='initial'){
  if(!alive||(createAction.value||action.value)&&scope===consumerScope()&&site===siteScope())return
  const n=++sequence;let own=consumerScope();action.value=source;if(source!=='retry')error.value='';if(source!=='reload')createError.value=''
  if(scope!==own||site!==siteScope()){clearPrivate();scope=own;site=siteScope();error.value=''}
  async function publicOffers(){
   clearPrivate();guest.value=true;own=consumerScope();scope=own;error.value=''
   if(asset!=='points')return
   const c=runtimeConfig()
   try{
    const offers=await api<RechargeCatalog>('/public/client/recharge-catalog?tenantId='+encodeURIComponent(c.tenantId)+'&applicationKey='+encodeURIComponent(c.applicationKey))
    if(sameContext(n,own)&&!getToken())catalog.value=offers
   }catch(e){if(sameContext(n,own))error.value=message(e)}
  }
  try{
   const ready=await consumerReady().catch(e=>{if(e?.status===401)return false;throw e})
   if(!alive||n!==sequence||site!==siteScope())return
   if(!ready){await publicOffers();return}
   guest.value=false;own=consumerScope();if(scope!==own){clearPrivate();scope=own}
   const key=storage(),saved=uni.getStorageSync(key) as Pending|undefined;pending.value=saved?.input?.requestKey?saved:null
   const recovery=saved?api<{id:string;status:string}|null>(saved.id?'/recharge/orders/'+encodeURIComponent(saved.id):'/recharge/orders/by-request/'+encodeURIComponent(saved.input.requestKey)).then(order=>order?['paid','cancelled','refunded','partial_refund','refund_pending'].includes(order.status)?null:{...saved,id:order.id}:saved,e=>{if([401,403].includes(e?.status))throw e;return saved}):Promise.resolve(null)
   const [account,offers,recovered]=await Promise.all([readWallet(),api<RechargeCatalog>('/recharge/catalog'),recovery])
   if(current(n,own)){wallet.value=account;catalog.value=offers;pending.value=recovered;error.value='';createError.value='';if(saved&&!recovered)uni.removeStorageSync(key);else if(recovered)uni.setStorageSync(key,recovered)}
  }catch(e){if(alive&&n===sequence&&site===siteScope()){if((e as any)?.status===401&&!getToken())await publicOffers();else if([401,403].includes((e as any)?.status))invalidate({scope:own,message:message(e)});else if(consumerScope()===own)error.value=message(e)}}
  finally{if(alive&&n===sequence){action.value='';if(site!==siteScope()||consumerScope()!==own||!getToken()&&!guest.value)invalidate({scope:own,message:'登录状态已变化，请重新读取账户'})}}
 }
 async function submit(input?:RechargeInput){
  if(!alive||createAction.value||action.value)return
  if(guest.value){consumerLogin();return}
  if(consumerScope()!==scope||site!==siteScope()){await load();return}
  const own=scope,key=storage(),n=sequence;createAction.value=input?'create':'resume';createError.value=''
  let saved=pending.value
  try{
   if(saved&&!saved.id){const existing=await api<{id:string}|null>('/recharge/orders/by-request/'+encodeURIComponent(saved.input.requestKey));if(!current(n,own))return;if(existing){saved={...saved,id:existing.id};pending.value=saved;uni.setStorageSync(key,saved)}}
   if(saved?.id){
    let existing:{id:string;status:string}|null=null
    try{existing=await api<{id:string;status:string}>('/recharge/orders/'+encodeURIComponent(saved.id))}catch(e){if((e as any)?.status!==404)throw e}
    if(!current(n,own))return
    if(existing&&(!input||!['paid','cancelled','refunded','partial_refund'].includes(existing.status))){open(existing.id);return}
    uni.removeStorageSync(key);saved=null;pending.value=null
    if(!input){createError.value='原订单已移除，请重新选择充值内容';return}
   }
   if(!saved){if(!input)return;saved={input:{...input,requestKey:rechargeKey()}};uni.setStorageSync(key,saved);pending.value=saved}
   // Only this explicit user action may retry the original idempotent request, after a lookup.
   const order=await api<{id:string}>('/recharge/orders','POST',saved.input)
   if(consumerScope()!==own||!getToken())return
   uni.setStorageSync(key,{...saved,id:order.id})
   if(current(n,own)){pending.value={...saved,id:order.id};open(order.id)}
  }catch(e){if(current(n,own)){
   if([401,403].includes((e as any)?.status)){invalidate({scope:own,message:message(e)});return}
   const code=(e as any)?.code
   if(['RECHARGE_CONFLICT','RECHARGE_UNAVAILABLE','RECHARGE_AMOUNT_INVALID','WALLET_INPUT_INVALID'].includes(code)){uni.removeStorageSync(key);pending.value=null}
   createError.value=(e as any)?.status===0?'订单结果待确认，请继续原订单，避免重复下单。':message(e)
  }}finally{if(alive&&n===sequence){createAction.value='';if(consumerScope()!==own||!getToken())invalidate({scope:own,message:'登录状态已变化，请重新读取账户'})}}
 }
 function open(id:string){uni.navigateTo({url:'/pages/orders/index?orderId='+encodeURIComponent(id)+'&view=payment'})}
 useMaintenanceReload(()=>load('maintenance'),()=>!!action.value||!!createAction.value)
 onShow(()=>void load());onUnload(()=>{alive=false;sequence++;clearPrivate()})
 return{wallet,catalog,guest,action,error,createAction,createError,pending,load,submit,invalidate}
}
