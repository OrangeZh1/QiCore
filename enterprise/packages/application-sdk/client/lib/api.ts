import {maintenance} from './maintenance'
import {runtimeConfig} from './runtime-config'
import {h5PagePath} from '@qicore/application-sdk/browser/h5-routes.mjs'
export const isH5=import.meta.env.UNI_PLATFORM==='h5'
export const isClientPreview=isH5&&import.meta.env.DEV&&import.meta.env.VITE_CLIENT_PREVIEW==='true'
export const sessionStorageKey=(key:string)=>{const runtime=runtimeConfig();return key+':'+runtime.tenantId+':'+runtime.applicationKey}
export const getToken=()=>String(uni.getStorageSync(sessionStorageKey('zjz-token'))||'')
export const isSignedOut=()=>!!uni.getStorageSync(sessionStorageKey('zjz-signed-out'))
export const consumerScope=()=>identityScope()+'|'+getToken()
export async function consumerReady(){if(!getToken()&&!isClientPreview)return false;await ensureSession({redirect:false});return !!getToken()}
export function consumerLogin(){openLogin()}
export const requestKey=()=>`k${Date.now().toString(36)}${Math.random().toString(36).slice(2,12)}`
export class ApiError extends Error {constructor(public code:string,message:string,public status:number){super(message)}}
export function apiUrl(path:string){
 const runtime=runtimeConfig();if(!path.startsWith('/')||path.startsWith('//'))throw new ApiError('API_PATH_INVALID','接口路径无效',400)
 if(path.startsWith('/consumer/auth/')||path.startsWith('/public/'))return runtime.apiBase+path
 const prefix='/apps/'+encodeURIComponent(runtime.applicationKey)
 if(path.startsWith('/apps/')){if(!path.startsWith(prefix+'/'))throw new ApiError('APPLICATION_MISMATCH','接口不属于当前应用',403);return runtime.apiBase+path}
 return runtime.apiBase+prefix+path
}
export function api<T>(url:string,method:'GET'|'POST'|'PUT'|'DELETE'='GET',data?:unknown,headers:Record<string,string>={}):Promise<T>{
  const token=getToken(),scope=sessionStorageKey('zjz-token'),sequence=authSequence,base=runtimeConfig().apiBase
  return new Promise((resolve,reject)=>{
   const timeout=method==='GET'?15000:60000,networkError=(reason:string)=>{
    maintenance.probe()
    if(import.meta.env.DEV)console.warn('[QiCore request failed]',method,url.split('?')[0],reason)
    return new ApiError('NETWORK_UNKNOWN','网络暂不可用；已有任务、订单或解锁请先查状态再重试',0)
   }
   let settled=false,task:UniApp.RequestTask|undefined
   const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(watchdog);action()}
   // Native/debug bridges can stall without delivering either callback.
   const watchdog=setTimeout(()=>{finish(()=>reject(networkError('request:timeout (no callback)')));try{task?.abort()}catch{}},timeout)
   try{task=uni.request({url:apiUrl(url),method,timeout,data:data as any,header:{...(!url.startsWith('/consumer/auth/')&&!url.startsWith('/public/')?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json',...headers},
    success:r=>finish(()=>{
     try{
      const body=r.data as any
      if(r.statusCode>=200&&r.statusCode<300){
        if(!body||typeof body!=='object'||Array.isArray(body)||!Object.prototype.hasOwnProperty.call(body,'data')){reject(new ApiError('API_RESPONSE_INVALID','服务响应异常；已有任务或订单请先查状态再重试',r.statusCode));return}
        resolve(body.data)
      }else {
        if(r.statusCode>=500)maintenance.probe()
        if(r.statusCode===401&&!url.startsWith('/consumer/auth/')&&!url.startsWith('/public/')&&url!=='/dev/session'&&token&&sequence===authSequence&&scope===sessionStorageKey('zjz-token')&&base===runtimeConfig().apiBase&&getToken()===token)clearSession()
        reject(new ApiError(body?.error?.code||'HTTP_ERROR',body?.error?.message||'请求失败',r.statusCode))
      }
     }catch{reject(new ApiError('API_RESPONSE_INVALID','服务响应异常；已有任务或订单请先查状态再重试',r.statusCode))}
    }),
    fail:e=>finish(()=>reject(networkError(e.errMsg||'request:fail')))})}catch(e){finish(()=>reject(e))}
  })
}
export const isDevelopmentLogin=false
type LoginSession={token:string;tenantId:string;applicationKey:string;userId:string;expiresAt?:string;authAppId?:string}
let authSequence=0,inFlight:Promise<unknown>|null=null
export function clearSession(){authSequence++;uni.removeStorageSync(sessionStorageKey('zjz-token'));uni.removeStorageSync(sessionStorageKey('zjz-session'));uni.removeStorageSync(sessionStorageKey('zjz-identity'))}
export function signOut(){clearSession();uni.setStorageSync(sessionStorageKey('zjz-signed-out'),true)}
function remember(s:LoginSession,mode:'development'|'wechat'|'password'|'official'|'preview'|'sms',attempt:number,expectedAppId?:string){const runtime=runtimeConfig();if(attempt!==authSequence||(s.tenantId!==runtime.tenantId||s.applicationKey!==runtime.applicationKey)||!isH5&&expectedAppId!==undefined&&expectedAppId!==runtime.appId||mode==='wechat'&&(!runtime.appId||s.authAppId!==runtime.appId))throw new ApiError('SESSION_CHANGED','登录状态已变化，请重新进入',409);uni.removeStorageSync(sessionStorageKey('zjz-signed-out'));uni.setStorageSync(sessionStorageKey('zjz-token'),s.token);uni.setStorageSync(sessionStorageKey('zjz-identity'),{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId});uni.setStorageSync(sessionStorageKey('zjz-session'),{tenantId:s.tenantId,applicationKey:s.applicationKey,mode,appId:mode==='wechat'?s.authAppId:!isH5?expectedAppId||'':s.authAppId||'',apiBase:runtime.apiBase,expiresAt:s.expiresAt||new Date(Date.now()+8*3600000).toISOString()});return s}
export async function loginPassword(account:string,password:string,register=false,consent?:Record<string,number>,loginType:'account'|'phone'|'auto'='auto'){const attempt=++authSequence,{tenantId,applicationKey,appId}=runtimeConfig(),s=await api<LoginSession>('/consumer/auth/'+(register?'register':'login'),'POST',{tenantId,applicationKey,account,password,...(!register&&loginType!=='account'?{loginType}:{}),...(consent?{consent}:{})});return remember(s,'password',attempt,appId)}
export async function loginSms(phone:string,code:string,consent?:Record<string,number>){const attempt=++authSequence,{tenantId,applicationKey,appId}=runtimeConfig(),s=await api<LoginSession>('/consumer/auth/sms/login','POST',{tenantId,applicationKey,phone,code,...(consent?{consent}:{})});return remember(s,'sms',attempt,appId)}
export async function exchangeOfficial(ticket:string){const attempt=++authSequence,s=await api<LoginSession&{returnPath:string}>('/consumer/auth/official/exchange','POST',{ticket});remember(s,'official',attempt);return s.returnPath}
export async function startOfficialLogin(returnPath='/',consent?:Record<string,number>){if(!isH5)return;const {tenantId,applicationKey}=runtimeConfig(),token=getToken(),sequence=authSequence;const flow=token?await api<{url:string}>('/official-account/connect','POST',{host:location.host,returnPath:h5PagePath(returnPath)}):await api<{url:string}>('/consumer/auth/official/start','POST',{host:location.host,tenantId,applicationKey,returnPath:h5PagePath(returnPath),...(consent?{consent}:{})});if(token!==getToken()||sequence!==authSequence)throw new ApiError('SESSION_CHANGED','登录状态已变化，请重新进入',409);location.assign(flow.url)}
let openingLogin=false
export function openLogin(){
 if(openingLogin)return;const pages=getCurrentPages(),current=pages[pages.length-1] as any;if(current?.route==='pages/login/index')return;
 let query='';
 if(isH5){const value=new URLSearchParams(location.search);value.delete('application');value.delete('previewReload');query=value.toString()}
 else query=Object.entries(current?.options||{}).filter(([key,value])=>!['application','previewReload'].includes(key)&&['string','number','boolean'].includes(typeof value)).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(String(value))).join('&');
 const path=current?.route?'/'+current.route:'/pages/home/index',returnPath=(isH5?h5PagePath(path):path)+(query?'?'+query:'');
 openingLogin=true;uni.navigateTo({url:'/pages/login/index?returnPath='+encodeURIComponent(returnPath),complete:()=>{openingLogin=false}})
}
export async function login(_tenantId?:string,_userId?:string):Promise<never>{throw new ApiError('DEVELOPMENT_LOGIN_DISABLED','请使用框架提供的登录入口',403)}
export async function loginWechat(consent?:Record<string,number>){
 const {tenantId,applicationKey,appId}=runtimeConfig();if(!tenantId)throw new ApiError('TENANT_REQUIRED','小程序尚未配置所属站点',409)
 if(!appId)throw new ApiError('WECHAT_ENV_REQUIRED','请在微信小程序中登录',409)
 const attempt=++authSequence,setting=await api<{enabled:boolean;appId:string|null}>('/consumer/auth/wechat/settings?tenantId='+encodeURIComponent(tenantId)+'&applicationKey='+encodeURIComponent(applicationKey));if(!setting.enabled)throw new ApiError('MINI_NOT_CONFIGURED','该站点尚未启用微信登录',409);if(setting.appId!==appId)throw new ApiError('MINI_APPID_MISMATCH','当前小程序与站点配置不一致',409)
 const code=await new Promise<string>((resolve,reject)=>uni.login({provider:'weixin',success:value=>value.code?resolve(value.code):reject(new ApiError('WECHAT_LOGIN_FAILED','未取得微信登录凭证，请重试',401)),fail:()=>reject(new ApiError('WECHAT_LOGIN_FAILED','微信登录未完成，请重试',401))}))
 const s=await api<LoginSession>('/consumer/auth/wechat/login','POST',{tenantId,applicationKey,code,...(consent?{consent}:{})});return remember(s,'wechat',attempt)
}
export async function loginPreview(){if(!isClientPreview)throw new ApiError('PREVIEW_UNAVAILABLE','当前版本不开放开发预览',403);const attempt=++authSequence,value=await api<LoginSession&{mock:boolean}>('/consumer/auth/preview','POST');if(!value.mock)throw new ApiError('PREVIEW_UNAVAILABLE','开发访问模式不可用',403);return remember(value,'preview',attempt)}
export async function ensureSession({redirect=true}={}){
 const required=()=>{if(redirect)consumerLogin();throw new ApiError('LOGIN_REQUIRED','请先登录',401)}
 if(isClientPreview){if(isSignedOut())return required();const runtime=runtimeConfig(),session=uni.getStorageSync(sessionStorageKey('zjz-session'));if(getToken()&&['preview','password','official','sms'].includes(session?.mode)&&session.tenantId===runtime.tenantId&&session.applicationKey===runtime.applicationKey&&session.apiBase===runtime.apiBase&&Date.parse(session.expiresAt)>Date.now())return;if(!inFlight)inFlight=loginPreview().finally(()=>{inFlight=null});await inFlight;return}
 if(isH5){const runtime=runtimeConfig(),session=uni.getStorageSync(sessionStorageKey('zjz-session'));if(getToken()&&['password','official','sms'].includes(session?.mode)&&session.tenantId===runtime.tenantId&&session.applicationKey===runtime.applicationKey&&session.apiBase===runtime.apiBase&&Date.parse(session.expiresAt)>Date.now())return;clearSession();return required()}
 if(uni.getStorageSync(sessionStorageKey('zjz-signed-out')))return required()
 const runtime=runtimeConfig(),session=uni.getStorageSync(sessionStorageKey('zjz-session'))
 if(getToken()&&['wechat','password','sms'].includes(session?.mode)&&session.tenantId===runtime.tenantId&&session.applicationKey===runtime.applicationKey&&!!runtime.appId&&session.appId===runtime.appId&&session.apiBase===runtime.apiBase&&Date.parse(session.expiresAt)>Date.now())return
 clearSession();return required()
}
export function identityScope(){const value=uni.getStorageSync(sessionStorageKey('zjz-identity'))||{};return[value.tenantId,value.applicationKey,value.userId].map(v=>encodeURIComponent(v||'')).join(':')}
export const message=(e:unknown)=>e instanceof Error?e.message:'操作未完成，请重试'
export const date=(s:string)=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})
export const money=(n:number)=>(n/100).toFixed(2)
