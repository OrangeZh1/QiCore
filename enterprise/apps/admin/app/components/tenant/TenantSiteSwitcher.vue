<script setup lang="ts">
import {tenantWorkbenchUrl,tenantEntryUrl,tenantCanEnter,type TenantEntryView} from '../../utils/tenant-entry'
const auth=useApi('tenant'),route=useRoute(),toast=useToast(),switching=ref(false)
const context=useTenantContext()
const selector=computed(()=>route.path==='/admin')
const currentId=context.tenantId
const recent=useCookie<{accountId:string;tenantId:string}|null>('qicore_last_tenant_site',{default:()=>null,sameSite:'lax',path:'/',maxAge:30*86400})
// Inside a site the verified context already supplies its label. Only the
// selector needs the full list to resolve its return button.
const {data,execute}=await useAsyncData<TenantEntryView>('tenant-sites:'+auth.session.value?.id+':'+(auth.session.value?.delegated?auth.session.value.tenantId:'normal'),(_nuxt,{signal})=>auth.api('/admin/tenant-entry','GET',undefined,{signal}),{server:false,lazy:true,immediate:selector.value&&!auth.session.value?.delegated})
watch(selector,value=>{if(value&&!auth.session.value?.delegated)void execute()})
const label=computed(()=>currentId.value&&context.current.value?.site.name||data.value?.tenants.find(site=>site.id===currentId.value)?.name||'选择站点')
// This preference is not authorization: resolve it against the current account's available sites.
const rememberedId=computed(()=>recent.value?.accountId===auth.session.value?.id?recent.value?.tenantId:undefined)
const available=computed(()=>data.value?.tenants?.filter(tenantCanEnter)||[])
const previous=computed(()=>{const id=rememberedId.value;return id?available.value.find(site=>site.id===id):available.value.length===1?available.value[0]:undefined})
const returnLabel=computed(()=>previous.value?(rememberedId.value?'返回站点':'进入站点'):'请选择站点')
watch([currentId,()=>data.value,()=>auth.session.value?.id],()=>{
 const accountId=auth.session.value?.id
 if(accountId&&!auth.session.value?.delegated&&available.value.some(site=>site.id===currentId.value)&&(recent.value?.accountId!==accountId||recent.value?.tenantId!==currentId.value))recent.value={accountId,tenantId:currentId.value}
},{immediate:true})
async function openSelector(){
 if(switching.value)return
 const target=selector.value?(previous.value?((previous.value.canViewOverview??data.value?.canViewOverview)?tenantWorkbenchUrl(previous.value.id):tenantEntryUrl(previous.value.id)):null):'/admin?switch=1'
 if(!target)return
 switching.value=true
 try{if(selector.value&&previous.value)context.choose(previous.value);await navigateTo(target)}catch(e){toast.add({title:e instanceof Error?e.message:'切换站点失败',color:'error'})}finally{switching.value=false}
}
</script>
<template><UButton v-if="!auth.session.value?.delegated" color="neutral" :variant="selector?'outline':'ghost'" :icon="selector&&returnLabel==='返回站点'?'i-lucide-arrow-left':'i-lucide-building-2'" :trailing-icon="selector?undefined:'i-lucide-chevron-right'" :loading="switching" :disabled="switching||(selector&&!previous)" :aria-label="selector?returnLabel+(previous?'：'+previous.name:''):'切换租户站点：'+label" :title="selector?returnLabel+(previous?' '+previous.name:''):'切换站点'" @click="openSelector"><span class="max-w-32 truncate" :class="{'hidden sm:inline':!selector}">{{selector?returnLabel:label}}</span></UButton></template>
