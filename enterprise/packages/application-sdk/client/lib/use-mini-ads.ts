import {ref} from 'vue'
import {onShow,onHide,onUnload} from '@dcloudio/uni-app'
import {api} from './api'
import {runtimeConfig} from './runtime-config'

type AdView={appId:string;mode:'wechat-managed'|'manual';homeBanner:string;profileBanner:string;homeInterstitial:string}
const unit=(value:unknown)=>typeof value==='string'&&/^adunit-[a-zA-Z0-9]{8,64}$/.test(value)?value:''

export function useMiniAds(page:'home'|'profile'){
 const bannerId=ref('')
 let sequence=0,visible=false,disposed=false,interstitialAttempted=false,interstitial:ReturnType<typeof uni.createInterstitialAd>|null=null
 function context(){
  const runtime=runtimeConfig(),appId=uni.getAccountInfoSync().miniProgram.appId
  if(!/^wx[a-fA-F0-9]{16}$/.test(appId)||appId==='wx0000000000000000'||runtime.appId&&runtime.appId!==appId)return null
  return{tenantId:runtime.tenantId,applicationKey:runtime.applicationKey,appId,scope:runtime.apiBase+'|'+runtime.tenantId+'|'+runtime.applicationKey+'|'+appId}
 }
 function release(){const ad=interstitial;interstitial=null;if(ad){ad.offError(onAdError);ad.offClose(onAdClose);ad.destroy()}}
 function onAdError(){release()}
 function onAdClose(){release()}
 async function load(){
  // Native advertising never makes a configuration request or invokes an SDK in H5.
  if(import.meta.env.UNI_PLATFORM!=='mp-weixin'||disposed)return
  const attempt=++sequence;bannerId.value=''
  try{
   const current=context();if(!current)return
   const value=await api<AdView>('/public/mini-ads?tenantId='+encodeURIComponent(current.tenantId)+'&applicationKey='+encodeURIComponent(current.applicationKey)+'&appId='+encodeURIComponent(current.appId))
   if(disposed||!visible||attempt!==sequence||context()?.scope!==current.scope||value.appId!==current.appId||value.mode!=='manual')return
   bannerId.value=unit(page==='home'?value.homeBanner:value.profileBanner)
   const adUnitId=unit(value.homeInterstitial)
   if(page==='home'&&adUnitId&&!interstitialAttempted&&typeof uni.createInterstitialAd==='function'){
    interstitialAttempted=true
    const ad=uni.createInterstitialAd({adUnitId});interstitial=ad;ad.onError(onAdError);ad.onClose(onAdClose)
    // One attempt per page lifetime. Inventory/loading errors do not interrupt the page.
    try{await ad.show()}catch{if(interstitial===ad)release()}
   }
  }catch{if(attempt===sequence)bannerId.value=''}
 }
 onShow(()=>{visible=true;void load()})
 onHide(()=>{visible=false;sequence++;bannerId.value=''})
 onUnload(()=>{disposed=true;visible=false;sequence++;bannerId.value='';release()})
 return{bannerId}
}
