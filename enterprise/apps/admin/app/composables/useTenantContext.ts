import type {TenantChoice,TenantEntryView} from '../utils/tenant-entry'
export function useTenantContext(){
 const auth=useApi('tenant'),current=useState<{accountId:string;site:TenantChoice}|null>('tenant-current-site',()=>null)
 const recent=computed(()=>current.value ? {accountId:current.value.accountId,tenantId:current.value.site.id} : null)
 const tenantId=computed(()=>current.value?.accountId===auth.session.value?.id&&current.value?.site.id===(auth.session.value?.tenantId||auth.session.value?.tenantIds[0])?current.value?.site.id||'':'')
 function choose(site:TenantChoice){const accountId=auth.session.value?.id;if(!accountId||(auth.session.value?.tenantId||auth.session.value?.tenantIds[0])!==site.id)return;current.value={accountId,site}}
 async function refresh(signal?:AbortSignal){
  const accountId=auth.session.value?.id,id=tenantId.value;if(!accountId||!id)return null
  const entry=await auth.api<TenantEntryView>('/admin/tenant-entry?tenantId='+encodeURIComponent(id),'GET',undefined,{signal})
  if(signal?.aborted||auth.session.value?.id!==accountId||tenantId.value!==id)return null
  if(!entry.tenant||entry.tenant.id!==id){current.value=null;return entry}
  if(entry.permissions)auth.session.value={...auth.session.value,permissionsByTenant:{...auth.session.value.permissionsByTenant,[id]:entry.permissions}}
  choose(entry.tenant);return entry
 }
 return{current,recent,tenantId,choose,refresh}
}
