import {consoleRenderData} from '../utils/console-render-context'
export type AdminSession={permissionsByTenant?:Record<string,string[]>;id:string;userId:string;username:string;nickname:string;avatar:string|null;profileVersion:number;tenantId:string|null;tenantIds:string[];role:'root'|'tenant';roleName:string;permissions:string[];csrfToken:string;expiresAt:string;delegated?:boolean;delegatedBy?:string;tenantName?:string}
export function useApi(portal:'admin'|'tenant'='admin'){
  const storedSession=useState<AdminSession|null>(portal==='tenant'?'tenant-session':'admin-session',()=>null),config=useRuntimeConfig(),nuxt=useNuxtApp(),requestHeaders=import.meta.server?useRequestHeaders(['cookie']):{}
  const current=useState<{accountId:string;site:{id:string}}|null>('tenant-current-site',()=>null)
  const request=import.meta.server?useRequestEvent()?.node.req:undefined
  const sessionRevision=useState<number>(portal+'-session-revision',()=>0)
  const session=computed({get:()=>{const value=storedSession.value,site=current.value;if(portal==='tenant'&&value?.permissionsByTenant&&site?.accountId===value.id)return {...value,permissions:value.permissionsByTenant[site.site.id]||[]};return value},set:(value:AdminSession|null)=>{sessionRevision.value++;storedSession.value=value}})
  async function api<T>(url:string,method:'GET'|'POST'|'PUT'|'DELETE'='GET',body?:unknown,options:{signal?:AbortSignal}={}){
    if(import.meta.server&&portal==='tenant'&&method==='GET'&&!options.signal?.aborted){
      const verified=consoleRenderData(request,(config.public as {nativeApplication?:{key:string}}).nativeApplication?.key,url)
      if(verified!==undefined)return verified as T
    }
    const revision=sessionRevision.value,original=storedSession.value
    try{const r=await $fetch<{data:T}>(String(import.meta.server?config.apiInternalBase:config.public.apiBase)+url,{method,signal:options.signal,body:body as any,credentials:'include',timeout:url.includes('/subscription-settings/')&&url.endsWith('/select')?135000:url.includes('/mini-program/')?60000:url.includes('/image-ai/tests')?135000:/^\/admin\/(?:tenants\/[^/]+\/)?materials(?:\/|$)/.test(url)?120000:url.startsWith('/admin/backups')?120000:url.startsWith('/admin/environment')?20000:url.startsWith('/admin/system-logs/export')?30000:/^\/admin\/(?:tenants\/[^/]+\/)?storage\/[^/]+\/test$/.test(url)?120000:(url==='/admin/license/check'||url==='/admin/updates/check')?35000:8000,headers:{...requestHeaders,'X-Console-Portal':portal,...(session.value&&method!=='GET'?{'X-CSRF-Token':session.value.csrfToken}:{})}});return r.data}
    catch(e:any){if(options.signal?.aborted)throw e;if(e.status===401&&revision===sessionRevision.value&&original===storedSession.value)session.value=null;throw Object.assign(new Error(e.data?.error?.message||'服务暂不可用，请重试'),{status:e.status,code:e.data?.error?.code})}
  }
  async function restore(){
    // Layouts, pages and hydration share this document's verified session.
    // Later client navigations still fetch live permissions.
    const verified=storedSession.value
    if((import.meta.server||nuxt.isHydrating&&nuxt.payload.serverRendered)&&verified?.role===(portal==='admin'?'root':'tenant')&&Date.parse(verified.expiresAt)>Date.now())return session.value
    const revision=sessionRevision.value,original=storedSession.value;try{const value=await api<AdminSession>('/admin/auth/me');if(revision===sessionRevision.value&&original===storedSession.value)session.value=value;return session.value}catch{if(revision===sessionRevision.value&&original===storedSession.value)session.value=null;return session.value}
  }
  async function login(username:string,password:string,portal:'admin'|'tenant'){session.value=await api<AdminSession>('/admin/auth/login','POST',{username,password,portal});return session.value}
  async function demoLogin(portal:'admin'|'tenant'){session.value=await api<AdminSession>('/admin/auth/demo-login','POST',{portal});return session.value}
  async function logout(){try{await api('/admin/auth/logout','POST')}finally{session.value=null}}
  return {session,api,restore,login,demoLogin,logout}
}
