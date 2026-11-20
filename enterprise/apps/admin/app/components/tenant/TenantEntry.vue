<script setup lang="ts">
import {dateTime} from '../../utils/update-center'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
import ConsolePage from '../console/AdminConsole.vue'
import {tenantWorkbenchUrl,tenantEntryUrl,tenantLandingUrl,tenantCanEnter,tenantAccessCopy,type TenantEntryView} from '../../utils/tenant-entry'
const route=useRoute(),auth=useApi('tenant')
const context=useTenantContext(),isSelector=route.path==='/admin',tenantId=isSelector?'':context.tenantId.value
const previousId=computed(()=>context.recent.value?.accountId===auth.session.value?.id?context.recent.value?.tenantId||'':'')
const query=new URLSearchParams(tenantId?{tenantId}:{})
const endpoint='/admin/tenant-entry'+(query.size?'?'+query.toString():'')
const initial=await useAsyncData<TenantEntryView>('tenant-entry:'+auth.session.value?.id+':'+tenantId,(_nuxt,{signal})=>auth.api<TenantEntryView>(endpoint,'GET',undefined,{signal}))
if(initial.error.value&&!auth.session.value)await navigateTo('/admin/login',{replace:true})
const data=ref<TenantEntryView|null>(initial.data.value??null),error=ref(initial.error.value?'暂时无法读取租户和应用，请重试。':''),loadAction=ref<'refresh'|'retry'|null>(null),navigating=ref<string|null>(null)
let controller:AbortController|undefined,requestNumber=0,alive=true
const search=ref('')
const visibleTenants=computed(()=>data.value?.tenants.filter(site=>site.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))||[])
function siteState(site:{enabled:boolean;expiresAt:string|null}){return !site.enabled?'已停用':site.expiresAt&&Date.parse(site.expiresAt)<=Date.now()?'已到期':'正常'}
const notice=computed(()=>{const value=data.value;if(!value)return null;const bound=value.applications.filter(app=>app.state!=='not-open');return tenantAccessCopy[value.access==='no-applications'&&bound.length===1?bound[0]!.state:value.access]||{title:'暂无可访问的后台页面',description:'请联系平台管理员核对应用配置及账号权限。',color:'warning' as const}})
function date(value:string|null){return value?dateTime(value):'未设置到期时间'}
async function load(source:'refresh'|'retry'){
  if(navigating.value)return
  controller?.abort();controller=new AbortController();const current=controller,number=++requestNumber
  loadAction.value=source;error.value=''
  try{const result=await auth.api<TenantEntryView>(endpoint,'GET',undefined,{signal:current.signal});if(alive&&number===requestNumber){data.value=result;const target=!isSelector?tenantLandingUrl(result):null;if(target)await open(target)}}
  catch(e:any){if(alive&&number===requestNumber&&!current.signal.aborted){data.value=null;error.value=e.message||'读取未完成，请重试';if(e.status===401)await navigateTo('/admin/login',{replace:true})}}
  finally{if(alive&&number===requestNumber)loadAction.value=null}
}
async function open(target:string,siteId?:string){
  if(navigating.value)return
  controller?.abort();requestNumber++;loadAction.value=null;navigating.value=siteId||target;error.value=''
  try{const site=data.value?.tenants.find(row=>row.id===(siteId||tenantId));if(site)context.choose(site);await navigateTo(target)}catch(e){if(alive)error.value=e instanceof Error?e.message:'切换未完成，请重试'}finally{if(alive)navigating.value=null}
}
onBeforeUnmount(()=>{alive=false;requestNumber++;controller?.abort()})
</script>
<template>
  <ConsolePage :refreshing="loadAction==='refresh'" @refresh="load('refresh')">
    <ConsolePageHeading class="mb-7" :title="isSelector?'选择租户站点':'站点状态'"><template #actions><UButton v-if="isSelector" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="loadAction==='refresh'" :disabled="navigating!==null" @click="load('refresh')">刷新站点</UButton><UButton v-else color="neutral" variant="outline" :loading="navigating==='/admin?switch=1'" :disabled="navigating!==null" @click="open('/admin?switch=1')">返回站点列表</UButton></template></ConsolePageHeading>
    <ConsoleErrorState v-if="error" title="加载未完成" :description="error"><template #actions><UButton :loading="loadAction==='retry'" :disabled="navigating!==null" @click="load('retry')">重试</UButton></template></ConsoleErrorState>
    <div v-if="data" class="space-y-6">
      <section v-if="isSelector&&data.tenants.length" aria-label="选择租户站点" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-sm font-medium text-muted">我的站点 <span class="ml-1">{{data.tenants.length}}</span></h2><UInput v-if="data.tenants.length>1" v-model="search" icon="i-lucide-search" placeholder="搜索站点名称" aria-label="搜索站点" class="w-full sm:w-64"/></div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article v-for="tenant in visibleTenants" :key="tenant.id" class="rounded-lg border border-default bg-default p-5" :class="{'border-primary/40':tenant.id===previousId}">
            <div class="flex items-center gap-3"><div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon name="i-lucide-building-2" class="size-5"/></div><div class="min-w-0 flex-1"><h3 class="truncate font-medium" :title="tenant.name">{{tenant.name}}</h3></div><UButton size="sm" variant="outline" :loading="navigating===tenant.id" :disabled="navigating!==null||!tenantCanEnter(tenant)" :aria-label="'进入站点 '+tenant.name" @click="open((tenant.canViewOverview??data.canViewOverview)?tenantWorkbenchUrl(tenant.id):tenantEntryUrl(tenant.id),tenant.id)">{{tenantCanEnter(tenant)?'进入后台':siteState(tenant)}}</UButton></div>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{{tenant.expiresAt?'有效期至 '+date(tenant.expiresAt):'长期有效'}}</span><span v-if="tenant.id===previousId" class="text-primary">刚刚访问</span><span v-else :class="siteState(tenant)==='正常'?'text-success':''">{{siteState(tenant)}}</span></div>
          </article>
        </div>
        <p v-if="!visibleTenants.length" class="py-8 text-center text-sm text-muted">没有匹配的站点，请尝试其他名称。</p>
      </section>
      <section v-if="!isSelector&&data.tenant" aria-label="当前访问范围" class="surface-card p-5 sm:p-6"><dl class="grid gap-6 sm:grid-cols-3"><div><dt class="text-xs text-muted">当前租户</dt><dd class="mt-2 break-words font-semibold">{{data.tenant.name}}</dd></div><div><dt class="text-xs text-muted">当前账号</dt><dd class="mt-2 break-words font-medium">{{auth.session.value?.nickname}}</dd></div><div><dt class="text-xs text-muted">账号角色</dt><dd class="mt-2 font-medium">{{auth.session.value?.roleName}}</dd></div></dl></section>
      <UAlert v-if="notice&&(!isSelector||data.tenants.length===0)" :color="notice.color" variant="subtle" :title="notice.title" :description="notice.description"/>
    </div>
  </ConsolePage>
</template>
