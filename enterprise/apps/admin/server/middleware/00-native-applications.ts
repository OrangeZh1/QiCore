import {installedWebApplications,applicationRenderer} from '../utils/native-applications'
import {consoleRenderContext} from '../../app/utils/console-render-context'

export default defineEventHandler(async event=>{
 const url=getRequestURL(event),path=url.pathname.replace(/\/+$/,'')
 if(/^\/tenant(?:\/|$)/i.test(path))throw createError({statusCode:404,statusMessage:'页面不存在'})
 if(!/^\/admin\/[a-z][a-z0-9-]{1,63}$/.test(path))return
 const candidates=(await installedWebApplications()).filter(app=>app.web.admin?.routes.some(route=>route.path===path))
 if(!candidates.length)return
 if(candidates.length!==1)throw createError({statusCode:403,statusMessage:'应用页面归属冲突'})
 if(!['GET','HEAD'].includes(event.method))throw createError({statusCode:405})
 const headers={cookie:getRequestHeader(event,'cookie')||'','X-Console-Portal':'tenant'},base=String(useRuntimeConfig().apiInternalBase)
 let session:any,entry:any
 try{
  session=(await $fetch<any>(base+'/admin/auth/me',{headers})).data
  if(session.role!=='tenant'||session.delegated||session.tenantIds?.length!==1)throw createError({statusCode:403})
  const tenantId=session.tenantIds[0]
  if(!tenantId||(session.tenantId&&session.tenantId!==tenantId))throw createError({statusCode:403})
  for(const key of ['tenantId','siteId'])if(url.searchParams.getAll(key).some(value=>value!==tenantId))throw createError({statusCode:403})
  entry=(await $fetch<any>(base+'/admin/tenant-entry',{headers,query:{tenantId}})).data
  if(entry?.tenant?.id!==tenantId||entry.tenant.enabled!==true||(entry.tenant.expiresAt&&!(Date.parse(entry.tenant.expiresAt)>Date.now())))throw createError({statusCode:403})
 }catch(error:any){if(error.statusCode===401||error.status===401)return sendRedirect(event,'/admin/login',302);throw error}
 const available=(entry.applications||[]).filter((item:any)=>item.state==='available')
 if(available.length>1)throw createError({statusCode:403,statusMessage:'应用归属冲突'})
 const app=candidates[0]!
 const owner=available.find((item:any)=>(app.applicationKey==='*'||item.key===(app.applicationKey||app.key))&&
   item.consoleRoutes?.some((route:any)=>route.path===path&&(app.applicationKey?route.pluginKey===app.key:!route.pluginKey)))
 const system=!available.length&&app.applicationKey==='*'&&entry.tenant.consoleRoutes?.some((route:any)=>
   route.path===path&&route.pluginKey===app.key&&route.applicationKey==='system')
 if(!owner&&!system){
   if(path==='/admin/workbench')return
   throw createError({statusCode:403,statusMessage:'当前站点无权访问此应用页面'})
 }
 setHeader(event,'cache-control','no-store, private');setHeader(event,'x-content-type-options','nosniff')
 if(app.adminOrigin)return proxyRequest(event,app.adminOrigin+path+url.search)
 // The renderer receives the public URL. Forward only this request's verified binding.
 const request=event.node.req as typeof event.node.req&{[consoleRenderContext]?:unknown}
 Object.defineProperty(request,consoleRenderContext,{value:{applicationKey:owner?.key||'system',path,session,entry},configurable:true})
 try{await (await applicationRenderer(app))(request,event.node.res)}finally{delete request[consoleRenderContext]}
})
