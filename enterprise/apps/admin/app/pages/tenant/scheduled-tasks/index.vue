<script setup lang="ts">
import {dateTime as time} from '../../../utils/update-center'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleActionConfirmationDialog from '@orangezh1/qisvc-console-ui/components/ConsoleActionConfirmationDialog'
import AdminConsole from '../../../components/console/AdminConsole.vue'
definePageMeta({layout:'tenant'})
type Task={id:string;name:string;command:string;params:string;rule:string;enabled:boolean;remark:string;version:number;running:boolean;lastStatus:string|null;lastError:string|null;lastRunAt:string|null;durationMs:number|null;maxDurationMs:number|null}
type Listing={items:Task[];total:number;commands:{value:string;label:string;grantable:boolean}[]}
const auth=useApi('tenant'),toast=useToast(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='tenant'||session.delegated||!session.permissions.includes('tenant:tasks.read'))throw createError({statusCode:403,statusMessage:'没有定时任务访问权限'})
const page=ref(1),pageSize=ref(20),busy=ref(false),loadAction=ref<'refresh'|'retry'|'page'|'mutation'|'poll'>('refresh'),active=ref<string|null>(null),error=ref(''),target=ref<Task|null>(null),confirmKind=ref<'delete'|'toggle'|'execute'>('delete'),confirmOpen=ref(false)
const params=()=>new URLSearchParams({page:String(page.value),pageSize:String(pageSize.value)})
const initial=await useAsyncData('scheduled-tasks',()=>auth.api<Listing>('/admin/scheduled-tasks?'+params()))
const rows=ref<Listing>(initial.data.value??{items:[],total:0,commands:[]})
if(initial.error.value)error.value='任务列表读取失败，请重试'
const canWrite=computed(()=>!!auth.session.value?.permissions.includes('tenant:tasks.write'))
const canDelete=computed(()=>auth.session.value?.permissions.includes('tenant:tasks.delete')===true)
const canExecute=computed(()=>auth.session.value?.permissions.includes('tenant:tasks.execute')===true)
const knownCommand=(row:Task)=>rows.value.commands.some(c=>c.value===row.command&&c.grantable)
const editable=(row:Task)=>canWrite.value&&knownCommand(row)

const columns=[{accessorKey:'name',header:'名称'},{id:'type',header:'类型'},{accessorKey:'command',header:'命令'},{id:'params',header:'参数'},{accessorKey:'rule',header:'规则'},{id:'status',header:'状态'},{id:'error',header:'错误原因'},{id:'lastRun',header:'最后执行时间'},{id:'duration',header:'时长'},{id:'maxDuration',header:'最大时长'},{id:'actions',header:'操作'}]
const duration=(n:number|null)=>n===null?'—':(n/1000).toFixed(2)+' 秒'
const status=(r:Task)=>r.running?'执行中':!r.enabled?'已停用':r.lastStatus==='error'?'错误':r.lastStatus==='success'?'正常':'待执行'
let seq=0,disposed=false,timer:ReturnType<typeof setInterval>|undefined
onMounted(()=>{timer=setInterval(()=>{if(!busy.value&&!active.value&&!confirmOpen.value&&document.visibilityState==='visible')void load('poll')},10000)})
onBeforeUnmount(()=>{disposed=true;seq++;clearInterval(timer)})
async function load(source:typeof loadAction.value='refresh'){const current=++seq;busy.value=true;loadAction.value=source;try{const next=await auth.api<Listing>('/admin/scheduled-tasks?'+params());if(current===seq&&!disposed){rows.value=next;error.value=''}}catch(e){if(current===seq&&!disposed)error.value=e instanceof Error?e.message:'读取失败'}finally{if(current===seq&&!disposed)busy.value=false}}
function allowed(row:Task,kind:'delete'|'toggle'|'execute'){
 if(row.running)return false
 if(kind==='delete')return canDelete.value
 if(kind==='execute')return canExecute.value&&knownCommand(row)
 return editable(row)&&(row.enabled||canExecute.value)
}
function ask(row:Task,kind:'delete'|'toggle'|'execute'){
 if(active.value||!allowed(row,kind))return
 target.value=row;confirmKind.value=kind;confirmOpen.value=true}
async function confirm(){const row=target.value;if(!row||active.value||!allowed(row,confirmKind.value))return;const kind=confirmKind.value;active.value=kind+':'+row.id;try{if(kind==='execute')await auth.api('/admin/scheduled-tasks/'+row.id+'/run','POST',{version:row.version});else if(kind==='delete')await auth.api('/admin/scheduled-tasks/'+row.id,'DELETE',{version:row.version});else await auth.api('/admin/scheduled-tasks/'+row.id,'PUT',{name:row.name,command:row.command,params:row.params,rule:row.rule,enabled:!row.enabled,remark:row.remark,version:row.version});if(!disposed){confirmOpen.value=false;toast.add({title:kind==='execute'?'任务已提交执行':kind==='delete'?'任务已删除':row.enabled?'任务已停用':'任务已启用',color:'success'});if(kind==='delete'&&rows.value.items.length===1&&page.value>1)page.value--;await load('mutation')}}catch(e){if(!disposed)toast.add({title:e instanceof Error?e.message:'操作失败',color:'error'})}finally{if(!disposed)active.value=null}}
</script>
<template><AdminConsole :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading title="定时任务"><template #actions><UButton v-if="canWrite" icon="i-lucide-plus" to="/admin/scheduled-tasks/new">新增</UButton></template></ConsolePageHeading>
  <ConsoleDataTable :data="rows.items" :columns="columns" :show-sequence="false" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" :error="error" empty-title="暂无定时任务" empty-description="新增任务并设置执行规则后，系统将自动执行。" min-table-width="1260px" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
    <template #name-cell="{row}"><span class="inline-block max-w-44 whitespace-normal font-medium">{{row.original.name}}</span></template>
    <template #type-cell>定时任务</template>
    <template #params-cell="{row}">{{row.original.params||'—'}}</template>
    <template #status-cell="{row}"><UBadge :color="row.original.running?'primary':!row.original.enabled?'neutral':row.original.lastStatus==='error'?'error':'success'" variant="subtle">{{status(row.original)}}</UBadge></template>
    <template #error-cell="{row}"><span class="inline-block max-w-48 whitespace-normal text-xs text-error">{{row.original.lastError||'—'}}</span></template>
    <template #lastRun-cell="{row}"><span class="text-xs tabular-nums">{{time(row.original.lastRunAt)}}</span></template>
    <template #duration-cell="{row}">{{duration(row.original.durationMs)}}</template>
    <template #maxDuration-cell="{row}">{{duration(row.original.maxDurationMs)}}</template>
    <template #actions-cell="{row}"><UButton v-if="editable(row.original)" variant="link" size="sm" class="px-0" :disabled="row.original.running||!!active" :to="'/admin/scheduled-tasks/'+row.original.id">编辑</UButton><UButton v-if="editable(row.original)" variant="link" size="sm" class="px-0" :disabled="row.original.running||!!active||(!row.original.enabled&&!canExecute)" @click="ask(row.original,'toggle')">{{row.original.enabled?'停用':'启用'}}</UButton><UButton v-if="canExecute&&knownCommand(row.original)" variant="link" size="sm" class="px-0" :disabled="row.original.running||!!active" @click="ask(row.original,'execute')">立即执行</UButton><UButton v-if="canDelete" variant="link" color="error" size="sm" class="px-0" :disabled="row.original.running||!!active" @click="ask(row.original,'delete')">删除</UButton><span v-if="!editable(row.original)&&!canDelete&&!(canExecute&&knownCommand(row.original))" class="text-xs text-muted">仅查看</span></template>
  </ConsoleDataTable>
  <p class="text-xs text-muted">时长单位为秒。服务恢复后错过的周期只补执行一次。</p>
  <ConsoleActionConfirmationDialog v-model:open="confirmOpen" :title="confirmKind==='execute'?'立即执行定时任务？':confirmKind==='delete'?'删除定时任务？':target?.enabled?'停用定时任务？':'启用定时任务？'" :subject="target?.name" :description="confirmKind==='execute'?'任务将使用当前已保存的命令和参数运行。':confirmKind==='delete'?'删除后不再自动执行，已有系统日志保留。':'状态变更将影响后续自动执行。'" :confirm-label="confirmKind==='execute'?'立即执行':confirmKind==='delete'?'删除任务':target?.enabled?'停用':'启用'" :color="confirmKind==='delete'?'error':'primary'" :loading="!!active" @confirm="confirm"/>
</div></AdminConsole></template>
