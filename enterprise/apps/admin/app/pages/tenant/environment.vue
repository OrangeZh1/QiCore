<script setup lang="ts">
import {dateTime as checkedTime} from '../../utils/update-center'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import AdminConsole from '../../components/console/AdminConsole.vue'
import {dateTime} from '../../utils/update-center'
definePageMeta({layout:'tenant'})
type CheckId='database'|'redis'|'storage'
type Check={id:CheckId;status:'ready'|'warning'|'error';version:string|null;latencyMs:number|null;checkedAt:string;message:string;provider?:string|null;writeTest?:{status:string;checkedAt:string|null}}
type Usage={totalBytes:number;usedBytes:number;availableBytes:number;usedPercent:number}
type Environment={runtime:{version:string|null;node:string;nestjs:string|null;prisma:string|null;platform:string;architecture:string;osRelease:string;mode:string;uptimeSeconds:number};resources:{cpu:{percent:number|null;cores:number|null;sampleMs:number}|null;memory:(Usage&{processBytes:number})|null;disk:Usage|null};checks:Record<CheckId,Check>;canTestStorage:boolean;updatedAt:string}
const auth=useApi('tenant'),toast=useToast(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='tenant'||session.delegated||!session.permissions.includes('tenant:environment.read'))throw createError({statusCode:403,statusMessage:'没有系统环境访问权限'})
const initial=await useAsyncData('system-environment',()=>auth.api<Environment>('/admin/environment'))
const data=ref<Environment|null>(initial.data.value??null),error=ref(initial.error.value?'系统环境读取失败，请重试':''),active=ref<CheckId|'refresh'|'retry'|null>(null),checkErrors=reactive<Record<CheckId,string>>({database:'',redis:'',storage:''})
const checkMotion=reactive<Record<CheckId,number>>({database:0,redis:0,storage:0})
let disposed=false
onBeforeUnmount(()=>{disposed=true})
const names:Record<CheckId,string>={database:'MySQL 数据库',redis:'Redis 缓存',storage:'本地文件目录'}
const rows=computed(()=>data.value?Object.values(data.value.checks):[])
const columns=[{id:'name',header:'依赖服务'},{id:'state',header:'状态'},{id:'version',header:'版本 / 配置'},{id:'latency',header:'检测耗时'},{id:'checked',header:'检测时间'},{id:'actions',header:'操作'}]
const bytes=(value:number|undefined)=>{if(value===undefined)return '未获取';if(value>=1024**3)return(value/1024**3).toFixed(1)+' GB';return(value/1024**2).toFixed(1)+' MB'}
const percent=(value:number|null|undefined)=>value==null?'未获取':value.toFixed(1)+'%'
function duration(value:number){const days=Math.floor(value/86400),hours=Math.floor(value%86400/3600),minutes=Math.floor(value%3600/60);return days?`${days} 天 ${hours} 小时`:hours?`${hours} 小时 ${minutes} 分钟`:`${minutes} 分钟`}
const runtimeFields=computed(()=>{const r=data.value?.runtime;return r?[['系统版本',r.version?`v${r.version}`:'未获取'],['运行模式',r.mode],['操作系统',r.platform+' '+r.osRelease],['架构',r.architecture],['Node.js',r.node],['NestJS',r.nestjs||'未获取'],['Prisma',r.prisma||'未获取'],['持续运行',duration(r.uptimeSeconds)]]:[]})
const writeLabel=(status?:string)=>({passed:'读写校验通过',failed:'读写校验未通过',testing:'读写检测中',not_tested:'尚未进行读写检测',unavailable:'读写状态未获取'})[status||'unavailable']||'读写状态未获取'
async function load(source:'refresh'|'retry'='refresh'){if(active.value)return;active.value=source;try{const next=await auth.api<Environment>('/admin/environment');if(!disposed){data.value=next;error.value='';Object.assign(checkErrors,{database:'',redis:'',storage:''})}}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'读取失败'}finally{if(!disposed)active.value=null}}
const canCheck=computed(()=>auth.session.value?.permissions.includes('tenant:environment.check')===true)
async function check(id:CheckId){if(active.value||!data.value||!canCheck.value||(id==='storage'&&!data.value.canTestStorage))return;active.value=id;checkMotion[id]++;checkErrors[id]='';try{const next=await auth.api<Check>('/admin/environment/check','POST',{target:id});if(!disposed&&data.value){data.value.checks[id]=next;toast.add({title:names[id]+(next.status==='ready'?'检测通过':'检测未通过'),color:next.status==='ready'?'success':'warning'})}}catch(e){if(!disposed){checkErrors[id]=e instanceof Error?e.message:'检测未完成';toast.add({title:checkErrors[id],color:'error'})}}finally{if(!disposed)active.value=null}}
</script>
<template><AdminConsole :refreshing="active==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading title="系统环境"><template v-if="data" #actions><span class="text-xs text-muted">采样于 {{dateTime(data.updatedAt)}}</span></template></ConsolePageHeading>
  <UAlert v-if="error" :title="error" color="error"><template #actions><UButton color="neutral" variant="outline" :loading="active==='retry'" :disabled="!!active" @click="load('retry')">重试</UButton></template></UAlert>
  <template v-if="data">
    <div class="grid gap-4 md:grid-cols-3">
      <section class="surface-card p-5"><div class="flex items-center justify-between"><h2 class="text-sm text-muted">CPU 使用率</h2><UIcon name="i-lucide-activity" class="size-5 text-primary"/></div><p class="my-3 text-3xl font-semibold tabular-nums">{{percent(data.resources.cpu?.percent)}}</p><UProgress v-if="data.resources.cpu?.percent!=null" :model-value="data.resources.cpu.percent" size="xs" aria-label="CPU 使用率"/><p class="mt-3 text-xs text-muted">{{data.resources.cpu?.cores?data.resources.cpu.cores+' 个可见逻辑核心':'核心数未获取'}}</p></section>
      <section class="surface-card p-5"><div class="flex items-center justify-between"><h2 class="text-sm text-muted">内存使用率</h2><UIcon name="i-lucide-server" class="size-5 text-primary"/></div><p class="my-3 text-3xl font-semibold tabular-nums">{{percent(data.resources.memory?.usedPercent)}}</p><UProgress v-if="data.resources.memory" :model-value="data.resources.memory.usedPercent" size="xs" aria-label="内存使用率"/><p class="mt-3 text-xs text-muted">{{bytes(data.resources.memory?.usedBytes)}} / {{bytes(data.resources.memory?.totalBytes)}}</p><p class="mt-1 text-xs text-muted">当前服务进程：{{bytes(data.resources.memory?.processBytes)}}</p></section>
      <section class="surface-card p-5"><div class="flex items-center justify-between"><h2 class="text-sm text-muted">磁盘使用率</h2><UIcon name="i-lucide-database" class="size-5 text-primary"/></div><p class="my-3 text-3xl font-semibold tabular-nums">{{percent(data.resources.disk?.usedPercent)}}</p><UProgress v-if="data.resources.disk" :model-value="data.resources.disk.usedPercent" size="xs" aria-label="磁盘使用率"/><p class="mt-3 text-xs text-muted">{{bytes(data.resources.disk?.usedBytes)}} / {{bytes(data.resources.disk?.totalBytes)}}</p><p class="mt-1 text-xs text-muted">文件目录所在磁盘 · 可用 {{bytes(data.resources.disk?.availableBytes)}}</p></section>
    </div>
    <section class="surface-card p-5 sm:p-6"><h2 class="mb-5 text-sm font-semibold">运行信息</h2><dl class="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4"><div v-for="field in runtimeFields" :key="field[0]"><dt class="text-xs text-muted">{{field[0]}}</dt><dd class="mt-2 break-words text-sm font-medium">{{field[1]}}</dd></div></dl></section>
    <section class="space-y-3"><h2 class="text-sm font-semibold">依赖检测</h2><ConsoleDataTable :data="rows" :columns="columns" :pagination="false" :client-pagination="false" :show-sequence="false" min-table-width="760px">
      <template #name-cell="{row}"><p class="font-medium">{{names[row.original.id as CheckId]}}</p><p v-if="row.original.id==='storage'" class="mt-1 text-xs text-muted" :title="dateTime(row.original.writeTest?.checkedAt)">{{writeLabel(row.original.writeTest?.status)}}</p></template>
      <template #state-cell="{row}"><UBadge :color="row.original.status==='ready'?'success':row.original.status==='warning'?'warning':'error'" variant="subtle">{{row.original.status==='ready'?'正常':row.original.status==='warning'?'需检查':'异常'}}</UBadge><p v-if="checkErrors[row.original.id as CheckId]" class="mt-1 max-w-64 whitespace-normal text-xs text-error">{{checkErrors[row.original.id as CheckId]}}</p><p v-else-if="row.original.status!=='ready'" class="mt-1 max-w-64 whitespace-normal text-xs text-muted">{{row.original.message}}</p></template>
      <template #version-cell="{row}"><span class="text-xs text-muted">{{row.original.id==='storage'?(row.original.provider||'存储方式未获取'):(row.original.version||'版本未获取')}}</span></template>
      <template #latency-cell="{row}"><span class="text-xs tabular-nums">{{row.original.latencyMs===null?'未获取':row.original.latencyMs.toFixed(1)+' ms'}}</span></template>
      <template #checked-cell="{row}"><span class="text-xs text-muted">{{checkedTime(row.original.checkedAt)}}</span></template>
      <template #actions-cell="{row}"><UButton v-if="canCheck" class="px-0" variant="link" size="sm" :loading="active===row.original.id" :disabled="!!active||row.original.id==='storage'&&!data.canTestStorage" :title="row.original.id==='storage'&&!data.canTestStorage?'需要存储配置查看和修改权限':undefined" @click="check(row.original.id)"><template #leading><UIcon :key="checkMotion[row.original.id as CheckId]" name="i-lucide-refresh-cw" class="size-4" :class="active===row.original.id?'animate-spin':checkMotion[row.original.id as CheckId]?'environment-check-feedback':''"/></template>{{active===row.original.id?'检测中…':row.original.id==='storage'?'读写检测':'重新检测'}}</UButton></template>
    </ConsoleDataTable></section>
  </template>
</div></AdminConsole></template>
<style scoped>
/* Completion feedback remains visible for a fast response without extending the request's loading state. */
.environment-check-feedback{animation:environment-check-turn .65s ease-out}
@keyframes environment-check-turn{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.environment-check-feedback{animation:none}}
</style>
