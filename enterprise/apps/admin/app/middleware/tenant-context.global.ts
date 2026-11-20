import {tenantLandingUrl,type TenantEntryView} from '../utils/tenant-entry'
import type {TenantSiteBranding} from '../composables/useSiteBranding'
import {isTenantPage,legacyTenantRoute} from '../utils/tenant-routes'
export default defineNuxtRouteMiddleware(async (to,from)=>{
 const sequence=useState<number>('tenant-navigation-sequence',()=>0),attempt=++sequence.value
 // Canonicalize before verifying identity and resolving the enterprise landing page.
 if(/^\/admin(?:\/|$)/.test(to.path)&&to.path.endsWith('/'))return navigateTo({path:to.path.replace(/\/+$/,''),query:to.query,hash:to.hash},{replace:true,redirectCode:302})
 if((to.path!=='/admin'&&!to.path.startsWith('/admin/'))||to.path==='/admin/login')return
 // An application's router cannot render host pages. Hand off before loading
 // context that the destination SSR must validate again anyway.
 const nativeRoutes=(useRuntimeConfig().public as {nativeApplication?:{routes:string[]}}).nativeApplication?.routes
 const outsideApplication=!!nativeRoutes&&!nativeRoutes.includes(to.path)
 // Component leave guards have already accepted this navigation. Hand installed
 // application routes to their server renderer before legacy tenant-ID parsing.
 if(import.meta.client&&(outsideApplication||!nativeRoutes&&useTenantContext().current.value?.site.consoleRoutes?.some(route=>route.path===to.path))){
  window.addEventListener('beforeunload',event=>event.stopImmediatePropagation(),{capture:true,once:true})
  useNuxtApp().$consoleDocumentNavigation?.()
  return navigateTo(prepareConsoleMenuNavigation('tenant',to.fullPath),{external:true})
 }
 const legacy=nativeRoutes?.includes(to.path)?null:legacyTenantRoute(to.path),legacyId=legacy?.tenantId||''
 if(!legacy&&!isTenantPage(to.path)&&!nativeRoutes?.includes(to.path))throw createError({statusCode:404,statusMessage:'页面不存在'})
 const oldQuery=to.path==='/admin'&&typeof to.query.tenant==='string'?to.query.tenant:''
 const entryPath=legacy?.path||(oldQuery?'/admin/applications':to.path),applicationEntry=/^\/admin\/apps\/[^/]+$/.test(entryPath)
 const auth=useApi('tenant');if(!auth.session.value)await auth.restore();if(attempt!==sequence.value)return false;if(!auth.session.value)return navigateTo('/admin/login',{replace:true})
 const context=useTenantContext(),account=auth.session.value
 const identity=(session:typeof account)=>JSON.stringify([session.id,session.csrfToken,session.delegated,session.tenantId])
 const accountIdentity=identity(account)
 // One installation serves one enterprise; only the server-authenticated binding selects its resources.
 const id=account.tenantId||(account.tenantIds.length===1?account.tenantIds[0]:null)
 if(account.role!=='tenant'||account.delegated||!id||account.tenantIds.length!==1||account.tenantIds[0]!==id){
  context.current.value=null
  throw createError({statusCode:403,statusMessage:'当前账号无后台访问权限'})
 }
 if(legacyId&&legacyId!==id||oldQuery&&oldQuery!==id)throw createError({statusCode:404,statusMessage:'页面不存在'})
 const branding=useSiteBranding(to),brand=branding.tenantBrand.value
 const site=context.current.value?.site
 const sameScope=context.tenantId.value===id&&context.current.value?.accountId===account.id&&brand?.accountId===account.id&&brand.tenantId===id&&Date.parse(account.expiresAt)>Date.now()&&site?.enabled&&(!site.expiresAt||Date.parse(site.expiresAt)>Date.now())
 if(import.meta.client&&sameScope&&!legacy&&!oldQuery&&to.path!=='/admin'&&entryPath!=='/admin/applications'&&!applicationEntry){
  const app=useNuxtApp()
  // Reuse this document's server-verified state during hydration. Query-only UI
  // changes do not change its identity; data APIs continue to enforce permissions.
  const queryScope=(query:typeof to.query)=>JSON.stringify(Object.entries(query).filter(([key])=>!['tab','page','__qicore_menu'].includes(key)).sort(([a],[b])=>a.localeCompare(b)))
  if(app.isHydrating&&app.payload.serverRendered||to.path===from?.path&&queryScope(to.query)===queryScope(from.query))return
 }
 let entry:TenantEntryView
 const reuseBrand=import.meta.client&&sameScope&&brand?.sessionKey===accountIdentity
 const [entryResult,brandResult]=await Promise.allSettled([
  auth.api<TenantEntryView>('/admin/tenant-entry?tenantId='+encodeURIComponent(id)),
  reuseBrand?Promise.resolve(brand):auth.api<TenantSiteBranding>('/admin/tenants/'+encodeURIComponent(id)+'/branding')
 ])
 // A later navigation/login owns the view, even when this earlier read finishes last.
 if(attempt!==sequence.value||auth.session.value&&identity(auth.session.value)!==accountIdentity)return false
 if(!auth.session.value)return navigateTo('/admin/login',{replace:true})
 if(entryResult.status==='rejected'){const e=entryResult.reason;if(e.status===401)return navigateTo('/admin/login',{replace:true});throw createError({statusCode:e.status||503,statusMessage:'暂时无法读取当前站点，请重试'})}
 entry=entryResult.value
 if(!entry.tenant||entry.tenant.id!==id||!entry.tenants.some(site=>site.id===id)){context.current.value=null;throw createError({statusCode:403,statusMessage:'后台不可用，请联系管理员'})}
 let tenantBrand:TenantSiteBranding|null=null
 if(!['tenant-disabled','tenant-expired','system-unavailable'].includes(entry.access)){
  if(brandResult.status==='rejected'){const e=brandResult.reason;if(e.status===401)return navigateTo('/admin/login',{replace:true});throw createError({statusCode:e.status||503,statusMessage:'暂时无法读取站点品牌，请重试'})}
  tenantBrand=brandResult.value
  if(tenantBrand.tenantId!==id)throw createError({statusCode:503,statusMessage:'站点品牌范围不匹配'})
 }
 if(entry.permissions&&auth.session.value)auth.session.value={...auth.session.value,permissionsByTenant:{...auth.session.value.permissionsByTenant,[id]:entry.permissions}}
 context.choose(entry.tenant);branding.tenantBrand.value=tenantBrand?{...tenantBrand,accountId:account.id,sessionKey:accountIdentity}:null
 if(['forbidden','tenant-disabled','tenant-expired','system-unavailable'].includes(entry.access)){
  throw createError({statusCode:entry.access==='system-unavailable'?503:403,statusMessage:'后台当前不可用，请联系管理员'})
 }
 if(to.path==='/admin'||entryPath==='/admin/applications'||applicationEntry){
  const target=tenantLandingUrl(entry)||'/admin/profile'
  const query={...to.query};delete query.tenant;delete query.switch;delete query.from
  return navigateTo({path:target,query,hash:to.hash},{replace:true,redirectCode:302,external:entry.tenant.consoleRoutes?.some(item=>item.path===target)===true})
 }
 if(legacy||oldQuery){const path=entryPath,query={...to.query};delete query.tenant;delete query.from;return navigateTo({path,query,hash:to.hash},{replace:true,redirectCode:302})}
})
