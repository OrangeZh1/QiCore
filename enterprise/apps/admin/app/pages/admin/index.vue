<script setup lang="ts">
import {dateTime as time} from '../../utils/update-center'
const loadAction=ref<'refresh'|'retry'>('refresh')
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleWorkbench from '../../components/console/ConsoleWorkbench.vue'
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
import AdminConsole from '../../components/console/AdminConsole.vue'
definePageMeta({layout:'admin',keepalive:true})

type ServiceStatus={id:string;name:string;status:'ready'|'error'|'pending';description:string}
type SystemStatus={allowed:boolean;provider:string;integration:string;license:{state:string;label:string;permanent?:boolean;expiryKnown?:boolean;verified?:boolean;lastCheckFailed?:boolean;companyName:string|null;expiresAt:string|null;checkedAt:string|null;description:string};update:{state:string;label:string;currentVersion:string;latestVersion:string|null;checkedAt:string|null;description:string};canCheck:boolean}
type Overview={system:SystemStatus;updatedAt:string;counts:{tenants:number;accounts:number;roles:number;newTenants:number;logins:number;activeTenants:number;todayOperations:number;tenantTotalOperations:number};activity:{day:string;total:number;activeTenants:number}[];services:ServiceStatus[];monitor:{apiMs:number;databaseMs:number;redisMs:number|null;memoryMb:number;uptimeSeconds:number}}
const auth=useApi(),data=ref<Overview|null>(null),busy=ref(false),error=ref(''),automaticStatusError=ref(''),checkingLicense=reactive({authorization:false,updates:false})
const restrictedAuthorization=computed(()=>data.value?.system.allowed===false)
const authorizationColor=computed(()=>data.value?.system.license.state==='active'?'success':data.value?.system.license.state==='suspended'?'error':'warning')
const permitted=computed(()=>auth.session.value?.role==='root')
const activeTenantSeries=computed(()=>({label:'活跃租户',unit:'户',data:data.value?.activity.map(day=>({day:day.day,total:day.activeTenants}))||[]}))
function latency(value:number|null|undefined){return typeof value==='number'?`${value.toFixed(1)} ms`:'—'}
function serviceTiming(id:string){const monitor=data.value?.monitor;return latency(id==='api'?monitor?.apiMs:id==='database'?monitor?.databaseMs:monitor?.redisMs)}
function uptime(seconds:number|undefined){if(seconds===undefined)return '—';const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return days?`${days}天 ${hours}小时`:hours?`${hours}小时 ${minutes}分`:`${minutes}分钟`}
const cards=computed(()=>[
  {label:'租户总数',value:data.value?.counts.tenants,icon:'i-lucide-building-2',detail:'平台已开通的租户'},
  {label:'可用管理员',value:data.value?.counts.accounts,icon:'i-lucide-users',detail:'已启用的平台账号'},
  {label:'平台角色',value:data.value?.counts.roles,icon:'i-lucide-shield-check',detail:'已启用的权限角色'},
  {label:'今日活跃租户',value:data.value?.counts.activeTenants,icon:'i-lucide-building-2',detail:'今日发生操作的租户去重数'},
  {label:'今日新增租户',value:data.value?.counts.newTenants,icon:'i-lucide-building-2',detail:'按今日开通记录统计'},
  {label:'今日登录',value:data.value?.counts.logins,icon:'i-lucide-log-in',detail:'今日平台账号登录次数'},
  {label:'今日租户操作',value:data.value?.counts.todayOperations,icon:'i-lucide-activity',detail:'已记录的租户后台操作'},
  {label:'租户累计操作',value:data.value?.counts.tenantTotalOperations,icon:'i-lucide-chart-no-axes-combined',detail:'已记录的租户历史操作总量'}
])
function expiryDate(value:string|null){if(!value&&data.value?.system.license.verified&&data.value.system.license.permanent)return '长期有效';return value?time(value):'暂未获取'}
async function load(source:typeof loadAction.value='refresh'){
  if(busy.value||checkingLicense.authorization||checkingLicense.updates)return
  loadAction.value=source;busy.value=true;error.value=''
  try{data.value=await auth.api<Overview>('/admin/overview')}
  catch(e){error.value=e instanceof Error?e.message:'工作台加载失败';if(!auth.session.value)await navigateTo('/admin/login',{replace:true})}
  finally{busy.value=false}
}
async function checkLicense(kind:'authorization'|'updates'){
  if(busy.value||checkingLicense[kind])return;checkingLicense[kind]=true;error.value=''
  try{const system=await auth.api<SystemStatus>('/admin/license/check','POST',{kind});const overview=await auth.api<Overview>('/admin/overview');if(data.value)overview.system={...data.value.system,...(kind==='authorization'?{license:system.license,allowed:system.allowed}:{update:system.update})};data.value=overview;automaticStatusError.value='';if(system.license.lastCheckFailed)error.value='本次授权核验未完成，保留上次可信状态';}
  catch(e){error.value=e instanceof Error?e.message:'校验未完成'}finally{checkingLicense[kind]=false}
}
let statusTimer:ReturnType<typeof setInterval>|undefined,watchingStatus=false,statusInFlight=false,lastStatusPoll=0
async function refreshLicenseStatus(){
  if(!watchingStatus||document.visibilityState!=='visible'||busy.value||(checkingLicense.authorization||checkingLicense.updates)||statusInFlight||!auth.session.value||Date.now()-lastStatusPoll<10000)return
  statusInFlight=true;lastStatusPoll=Date.now();const accountId=auth.session.value.id
  try{
    const system=await auth.api<SystemStatus>('/admin/license/status')
    if(!watchingStatus||busy.value||(checkingLicense.authorization||checkingLicense.updates)||auth.session.value?.id!==accountId)return
    if(system.allowed&&(!data.value||data.value.system.allowed===false)){
      const overview=await auth.api<Overview>('/admin/overview')
      if(!watchingStatus||busy.value||(checkingLicense.authorization||checkingLicense.updates)||auth.session.value?.id!==accountId)return
      data.value=overview
    }else if(data.value)data.value={...data.value,system}
    automaticStatusError.value=system.license.lastCheckFailed?'自动授权检查暂未成功，当前按上次可信回执判断；系统将自动重试。':''
  }catch{
    if(watchingStatus){if(!auth.session.value)await navigateTo('/admin/login',{replace:true});else automaticStatusError.value='授权状态暂时无法刷新，恢复连接后将自动重试。'}
  }finally{statusInFlight=false}
}
function startStatusRefresh(){if(watchingStatus)return;watchingStatus=true;void refreshLicenseStatus();statusTimer=setInterval(()=>void refreshLicenseStatus(),30000);document.addEventListener('visibilitychange',refreshLicenseStatus);window.addEventListener('focus',refreshLicenseStatus)}
function stopStatusRefresh(){watchingStatus=false;if(statusTimer)clearInterval(statusTimer);statusTimer=undefined;document.removeEventListener('visibilitychange',refreshLicenseStatus);window.removeEventListener('focus',refreshLicenseStatus)}
onMounted(startStatusRefresh)
onActivated(startStatusRefresh)
onDeactivated(stopStatusRefresh)
onBeforeUnmount(()=>{if(import.meta.client)stopStatusRefresh()})
const session=auth.session.value??await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
if(session?.role==='root'){
  const initial=await useAsyncData('platform-overview',()=>auth.api<Overview>('/admin/overview'))
  data.value=initial.data.value??null
  if(initial.error.value)error.value='工作台数据加载失败，请重试'
  if(!auth.session.value)await navigateTo('/admin/login',{replace:true})
}

</script>

<template>
  <div v-if="!permitted" class="p-8"><ConsoleErrorState title="无法访问总后台工作台" description="请使用平台管理员账号登录。"/><UButton to="/admin/login" class="mt-4">返回登录页</UButton></div>
  <AdminConsole v-else :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')">
    <div class="workbench-content space-y-6">
      <ConsolePageHeading title="工作台"><template #actions><span v-if="data" class="text-xs text-dimmed">更新于 {{time(data.updatedAt)}}</span></template></ConsolePageHeading>
      <ConsoleErrorState v-if="error||automaticStatusError" title="状态更新提示" :description="error||automaticStatusError"><template #actions><UButton variant="soft" :disabled="busy" :loading="busy&&loadAction==='retry'" @click="load('retry')">重试</UButton></template></ConsoleErrorState>
      <template v-if="data">
        <section v-if="data.system" class="system-overview" aria-label="系统授权与版本">
          <div class="system-overview-item" title="服务端已核验的授权到期时间"><UIcon name="i-lucide-badge-check" class="system-overview-icon"/><span class="system-overview-label">授权到期时间</span><strong class="system-version">{{expiryDate(data.system.license.expiresAt)}}</strong><UBadge :color="authorizationColor" variant="soft" size="sm">{{data.system.license.label}}</UBadge><UButton v-if="data.system.canCheck" aria-label="检查授权" title="检查授权" size="xs" color="neutral" variant="outline" :aria-busy="checkingLicense.authorization" :disabled="busy||checkingLicense.authorization" :ui="{base:'disabled:opacity-100'}" class="ml-auto shrink-0" @click="checkLicense('authorization')"><UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{'animate-spin':checkingLicense.authorization}"/>检查授权</UButton></div>
          <div class="system-overview-item" :title="data.system.update.description"><UIcon name="i-lucide-package-check" class="system-overview-icon"/><span class="system-overview-label">当前系统版本</span><strong class="system-version">v{{data.system.update.currentVersion}}</strong><span class="system-version-state">{{data.system.update.label}}</span><UButton color="neutral" variant="outline" size="xs" :disabled="!data.system.canCheck||busy||checkingLicense.updates" :aria-busy="checkingLicense.updates" :ui="{base:'disabled:opacity-100'}" class="ml-auto shrink-0" :title="data.system.update.description" @click="checkLicense('updates')"><UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{'animate-spin':checkingLicense.updates}"/>检查更新</UButton><span class="sr-only">{{data.system.update.description}}</span></div>
        </section>
        <UAlert v-if="restrictedAuthorization" :color="authorizationColor" :title="data.system.license.label" :description="data.system.license.description" variant="subtle"/>
        <template v-else>
        <ConsoleWorkbench :cards="cards" :data="data.activity" :comparison="activeTenantSeries" series-label="租户操作总量" trend-title="租户操作趋势"><template #aside>
        <UCard class="monitor-card"><template #header><div class="workbench-section-title"><h2>系统监控</h2><span class="monitor-overall" :data-error="data.services.some(s=>s.status!=='ready')||undefined"><i/>{{data.services.every(s=>s.status==='ready')?'运行正常':'存在异常'}}</span></div></template>
          <div class="monitor-services"><div v-for="service in data.services" :key="service.id" class="monitor-service"><div class="monitor-service-name"><UIcon :name="service.id==='database'?'i-lucide-database':service.id==='cache'?'i-lucide-layers':'i-lucide-server'"/><div><h3>{{service.name}}</h3><small>{{service.id==='api'?'接口处理耗时':service.id==='database'?'数据库查询延迟':'缓存响应延迟'}}</small></div></div><strong :class="{'text-error':service.status!=='ready'}">{{service.status==='ready'?serviceTiming(service.id):'连接异常'}}</strong></div></div>
          <div class="monitor-resources"><div><span>进程内存</span><strong>{{data.monitor?.memoryMb??'—'}}<small> MB</small></strong></div><div><span>持续运行</span><strong>{{uptime(data.monitor?.uptimeSeconds)}}</strong></div></div><p class="monitor-sample">本次采样 {{time(data.updatedAt)}} · 服务端测量</p>
        </UCard>
        </template></ConsoleWorkbench>
        <p class="text-center text-xs text-dimmed">按租户后台操作记录统计，包含平台代登录后的操作</p>
        </template>
      </template>
    </div>
  </AdminConsole>
</template>

<style scoped>
.workbench-content{width:100%;max-width:none}.workbench-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.workbench-section-title h2{font-size:16px;font-weight:600}.workbench-section-title>span{font-size:12px;color:var(--ui-text-muted)}
.workbench-section-title>.monitor-overall{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ui-success)}.monitor-overall i{width:6px;height:6px;border-radius:50%;background:currentColor}.workbench-section-title>.monitor-overall[data-error]{color:var(--ui-error)}.monitor-services{display:flex;flex-direction:column}.monitor-service{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:17px 0;border-bottom:1px solid var(--ui-border)}.monitor-service:first-child{padding-top:4px}.monitor-service-name{display:flex;align-items:center;gap:10px;min-width:0}.monitor-service-name>.iconify{font-size:18px;color:var(--ui-text-muted);flex:none}.monitor-service h3{font-size:13px;font-weight:500}.monitor-service small{display:block;font-size:10px;color:var(--ui-text-dimmed);margin-top:4px}.monitor-service>strong{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.monitor-resources{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-top:22px}.monitor-resources>div{padding:14px 12px;border-radius:8px;background:var(--ui-bg-elevated);min-width:0}.monitor-resources span{display:block;font-size:11px;color:var(--ui-text-muted);margin-bottom:8px}.monitor-resources strong{font-size:17px;font-weight:600;white-space:nowrap}.monitor-resources small{font-size:10px;font-weight:400;color:var(--ui-text-muted)}.monitor-sample{font-size:10px;color:var(--ui-text-dimmed);margin:18px 0 0}
.system-overview{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-bg)}.system-overview-item{display:flex;align-items:center;gap:10px;padding:11px 16px;min-width:0}.system-overview-item+div{border-left:1px solid var(--ui-border)}.system-overview-icon{width:18px;height:18px;flex:none;color:var(--ui-primary)}.system-overview-label{font-size:12px;line-height:20px;color:var(--ui-text-muted);white-space:nowrap}.system-version-state{font-size:12px;line-height:20px;color:var(--ui-text-dimmed);white-space:nowrap}.system-version{font-size:13px;line-height:20px;font-weight:600;white-space:nowrap}@media(max-width:900px){.system-overview{grid-template-columns:1fr}.system-overview-item+div{border-left:0;border-top:1px solid var(--ui-border)}}@media(max-width:480px){.system-overview-item{padding:10px 12px;gap:8px;flex-wrap:wrap}}
</style>
