const brandingLoads=new WeakMap<object,Promise<SiteBranding>>()
export type PlatformBrand={name:string;favicon:string|null;logo:string|null;loginImage:string|null;defaultAvatar:string|null;loginTitle:string;loginDescription:string}
export type TenantBrand={name:string;favicon:string|null;logo:string|null;loginImage:string|null;defaultAvatar:string|null;loginTitle:string;loginDescription:string}
export type SiteBranding={version:number;platform:PlatformBrand;tenant:TenantBrand;copyright:string;filing:{icpNumber:string;icpLink:string;policeNumber:string;policeLink:string}}
export type TenantSiteBranding={tenantId:string;version:number;tenant:TenantBrand;copyright:string;filing:SiteBranding['filing']}
export function useSiteBranding(target?:{path:string}){
  const site=useState<SiteBranding|null>('site-branding',()=>null),config=useRuntimeConfig(),route=target??useRoute(),nuxt=useNuxtApp()
  const tenantBrand=useState<(TenantSiteBranding&{accountId:string;sessionKey?:string})|null>('tenant-site-branding',()=>null)
  const account=useState<{id:string}|null>('tenant-session',()=>null),context=useState<{accountId:string;site:{id:string}}|null>('tenant-current-site',()=>null)
  const resolvedSite=computed(()=>{
    const base=site.value,own=tenantBrand.value
    if(!base||!own||!route.path.startsWith('/admin/')||route.path==='/admin/login'||context.value?.accountId!==account.value?.id||own.accountId!==account.value?.id||own.tenantId!==context.value?.site.id)return base
    return{...base,tenant:own.tenant,copyright:own.copyright,filing:own.filing}
  })
  function load(){
    const existing=brandingLoads.get(nuxt);if(existing)return existing
    const pending=$fetch<{data:SiteBranding}>(String(import.meta.server?config.apiInternalBase:config.public.apiBase)+'/public/site',{timeout:8000}).then(response=>{site.value=response.data;return response.data}).finally(()=>brandingLoads.delete(nuxt))
    brandingLoads.set(nuxt,pending);return pending
  }
  return{site,load,resolvedSite,tenantBrand}
}
