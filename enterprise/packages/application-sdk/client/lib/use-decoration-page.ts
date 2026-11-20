import {useMaintenanceReload} from './maintenance'
import {computed,ref} from 'vue'
import {runtimeConfig} from './runtime-config'
import {onShow,onHide,onUnload} from '@dcloudio/uni-app'
import {decorationScope,loadDecoration,navigateDecoration} from './decoration'
import {consumerLogin,message,isH5} from './api'
import type {DecorationLink} from '@qicore/application-sdk/browser/decoration-types'

export function useDecorationPage(page:'home'|'profile'){
 const runtime=isH5?runtimeConfig():null
 const initialTitle=runtime&&'homeTitle' in runtime&&'profileTitle' in runtime?String(page==='home'?runtime.homeTitle:runtime.profileTitle):''
 const data=ref<Awaited<ReturnType<typeof loadDecoration>>>(),error=ref(''),action=ref(''),needsLogin=ref(false)
 const title=computed(()=>data.value?.scheme[page].title||initialTitle)
 let sequence=0,disposed=false,requestScope=''
 async function load(source='initial'){
  if(disposed)return
  let scope:string
  try{scope=decorationScope()}catch(e){sequence++;data.value=undefined;action.value='';needsLogin.value=false;error.value=message(e);return}
  if(action.value&&requestScope===scope)return
  if(data.value?.scope!==scope)data.value=undefined
  const attempt=++sequence;requestScope=scope;action.value=source;needsLogin.value=false;if(source!=='retry')error.value=''
  try{
   const value=await loadDecoration(page);if(disposed||attempt!==sequence)return
   if(value.scope!==decorationScope())throw Error('登录或站点状态已变化，请重新读取页面')
   data.value=value;error.value='';uni.setNavigationBarTitle({title:value.scheme[page].title})
  }catch(e:any){
   if(disposed||attempt!==sequence)return
   let currentScope='';try{currentScope=decorationScope()}catch{}
   if(data.value?.scope!==currentScope||[401,403,404].includes(e.status))data.value=undefined
   needsLogin.value=e.status===401;error.value=e.code==='NETWORK_UNKNOWN'?'网络连接失败，请检查网络后重试':e.code==='API_RESPONSE_INVALID'?'页面暂时无法加载，请稍后重试':message(e)
  }finally{if(!disposed&&attempt===sequence)action.value=''}
 }
 function navigate(target:DecorationLink,root=false){if(!data.value)return;if(data.value.scope!==decorationScope()){data.value=undefined;void load('scope');return}navigateDecoration(target,page,data.value.targets,root)}
 function share(){const value=data.value?.scope===decorationScope()?data.value:undefined;return{title:value?.sharing.title||(page==='home'?'首页':'个人中心'),imageUrl:value?.sharing.imageUrl}}
 useMaintenanceReload(()=>load('maintenance'),()=>!!action.value)
 onShow(()=>{void load(data.value?'background':'initial')})
 onHide(()=>{sequence++;action.value=''})
 onUnload(()=>{disposed=true;sequence++;data.value=undefined;action.value=''})
 return{data,title,error,action,needsLogin,load,navigate,share,login:consumerLogin}
}
