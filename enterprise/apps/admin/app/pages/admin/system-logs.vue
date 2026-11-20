<script setup lang="ts">
import {dateTime as formatTime} from '../../utils/update-center'
import ConsoleQueryButton from '../../components/console/ConsoleQueryButton.vue'
const loadAction=ref<'search'|'reset'|'refresh'|'page'|'mutation'|'retry'>('refresh')
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleListDateRange from '@orangezh1/qisvc-console-ui/components/ConsoleListDateRange'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import AdminConsole from '../../components/console/AdminConsole.vue'
definePageMeta({layout:'admin'})
type Log={id:string;action:string;actionLabel:string;group:string;createdAt:string;actor:{id:string;username:string|null;name:string;deleted:boolean};target:{name:string;id:string|null}}
type Detail=Log&{fields:{label:string;value:string}[];changes:{label:string;before:string;after:string}[]}
type Listing={items:Log[];total:number;actions:{value:string;label:string;group:string}[]}
const auth=useApi(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('audit.read'))throw createError({statusCode:403,statusMessage:'没有系统日志查看权限'})
const actor=ref(''),action=ref('all'),start=ref(''),end=ref(''),applied=ref({actor:'',action:'all',start:'',end:''}),page=ref(1),pageSize=ref(20),busy=ref(false),error=ref(''),filterError=ref(''),detailOpen=ref(false),detail=ref<Detail|null>(null),detailBusy=ref(false),detailError=ref(''),detailId=ref('')
const params=()=>new URLSearchParams({...applied.value,page:String(page.value),pageSize:String(pageSize.value)})
const initial=await useAsyncData('platform-system-logs',()=>auth.api<Listing>('/admin/system-logs?'+params()))
const rows=ref<Listing>(initial.data.value??{items:[],total:0,actions:[]});if(initial.error.value)error.value='系统日志读取失败，请重试'
const toast=useToast(),exporting=ref(false)
const actions=computed(()=>[{value:'all',label:'全部操作类型'},...rows.value.actions]),filtered=computed(()=>applied.value.actor||applied.value.action!=='all'||applied.value.start||applied.value.end)
const columns=[{id:'actor',header:'操作人'},{id:'action',header:'操作类型'},{id:'target',header:'操作对象'},{id:'time',header:'操作时间'},{id:'actions',header:'操作'}]
let sequence=0,detailSequence=0
onBeforeUnmount(()=>{sequence++;detailSequence++})
async function load(source:typeof loadAction.value='refresh'){const n=++sequence;loadAction.value=source;busy.value=true;error.value='';try{const result=await auth.api<Listing>('/admin/system-logs?'+params());if(n===sequence)rows.value=result}catch(e){if(n===sequence)error.value=e instanceof Error?e.message:'读取失败'}finally{if(n===sequence)busy.value=false}}
function filter(source:'search'|'reset'='search'){filterError.value='';if(start.value&&end.value&&start.value>end.value){filterError.value='开始日期不能晚于结束日期';return}applied.value={actor:actor.value.trim(),action:action.value,start:start.value,end:end.value};page.value=1;void load(source)}
function reset(){actor.value='';action.value='all';start.value='';end.value='';filter('reset')}
async function showDetail(id:string){detailId.value=id;detail.value=null;detailError.value='';detailOpen.value=true;detailBusy.value=true;const n=++detailSequence;try{const result=await auth.api<Detail>('/admin/system-logs/'+encodeURIComponent(id));if(n===detailSequence)detail.value=result}catch(e){if(n===detailSequence)detailError.value=e instanceof Error?e.message:'日志详情读取失败'}finally{if(n===detailSequence)detailBusy.value=false}}
watch(detailOpen,value=>{if(!value){detailSequence++;detailBusy.value=false;detail.value=null}})
async function exportLogs(){if(exporting.value)return;if(start.value&&end.value&&start.value>end.value){filterError.value='开始日期不能晚于结束日期';return}exporting.value=true;try{const result=await auth.api<{filename:string;content:string;total:number}>('/admin/system-logs/export?'+new URLSearchParams({actor:actor.value.trim(),action:action.value,start:start.value,end:end.value}));const url=URL.createObjectURL(new Blob([result.content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);toast.add({title:'已导出 '+result.total+' 条日志',color:'success'})}catch(e){toast.add({title:e instanceof Error?e.message:'导出失败',color:'error'})}finally{exporting.value=false}}
</script>
<template><AdminConsole :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading title="系统日志"/>
  <form class="space-y-3" @submit.prevent="filter('search')">
    <ConsoleListFilters>
      <div class="flex w-full min-w-0 items-center gap-2 sm:w-auto"><label for="log-actor" class="shrink-0 text-sm text-muted">操作人</label><ConsoleListSearch id="log-actor" v-model="actor" class="!w-full min-w-0 sm:!w-60" placeholder="账号、名称或编号" :maxlength="100"/></div>
      <div class="flex w-full min-w-0 items-center gap-2 sm:w-auto"><label for="log-action" class="shrink-0 text-sm text-muted">操作类型</label><USelect id="log-action" v-model="action" :items="actions" aria-label="操作类型" class="w-full sm:!w-44"/></div>
      <ConsoleListDateRange v-model:start="start" v-model:end="end" label="操作日期"/>
      <div class="flex items-center gap-3"><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="busy&&loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="busy&&loadAction==='reset'" @click="reset">重置</ConsoleQueryButton></div><UButton color="neutral" variant="outline" :loading="exporting" @click="exportLogs">导出</UButton></div>
    </ConsoleListFilters>
    <UAlert v-if="filterError" color="error" :title="filterError"/>
  </form>
  <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" :empty-title="filtered?'未找到匹配的日志':'暂无系统日志'" :empty-description="filtered?'请调整操作人、操作类型或日期条件。':'已记录的平台操作将在这里显示。'" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
    <template #actor-cell="{row}"><p class="max-w-40 truncate font-medium text-highlighted" :title="row.original.actor.name">{{row.original.actor.name}}<span v-if="row.original.actor.deleted" class="ml-1 text-xs text-muted">已删除</span></p><p class="mt-1 max-w-40 truncate text-xs text-muted" :title="row.original.actor.username||row.original.actor.id">{{row.original.actor.username||row.original.actor.id}}</p></template>
    <template #action-cell="{row}"><p>{{row.original.actionLabel}}</p><p class="mt-1 text-xs text-muted">{{row.original.group}}</p></template>
    <template #target-cell="{row}"><span class="block max-w-40 truncate" :title="row.original.target.name">{{row.original.target.name}}</span></template>
    <template #time-cell="{row}"><span class="text-xs text-muted">{{formatTime(row.original.createdAt)}}</span></template>
    <template #actions-cell="{row}"><UButton class="px-0" variant="link" size="sm" @click="showDetail(row.original.id)">详情</UButton></template>
  </ConsoleDataTable>
  <UModal v-model:open="detailOpen" title="日志详情" description="查看已记录的平台操作与变更内容。" :ui="{content:'sm:max-w-2xl max-h-[85dvh]',body:'overflow-y-auto'}"><template #body>
    <p v-if="detailBusy" role="status" class="text-sm text-muted">正在读取日志…</p>
    <UAlert v-else-if="detailError" :title="detailError" color="error"><template #actions><UButton color="neutral" variant="outline" size="sm" @click="showDetail(detailId)">重试</UButton></template></UAlert>
    <div v-else-if="detail" class="space-y-6"><dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2"><div><dt class="text-muted">操作人</dt><dd class="mt-1 break-all">{{detail.actor.name}}{{detail.actor.deleted?'（已删除）':''}}<span v-if="detail.actor.username">（{{detail.actor.username}}）</span></dd></div><div><dt class="text-muted">操作时间（北京时间）</dt><dd class="mt-1">{{formatTime(detail.createdAt)}}</dd></div><div><dt class="text-muted">操作类型</dt><dd class="mt-1">{{detail.actionLabel}}</dd></div><div><dt class="text-muted">操作对象</dt><dd class="mt-1 break-all">{{detail.target.name}}</dd></div><div class="sm:col-span-2"><dt class="text-muted">日志编号</dt><dd class="mt-1 break-all text-xs">{{detail.id}}</dd></div><div><dt class="text-muted">操作人编号</dt><dd class="mt-1 break-all text-xs">{{detail.actor.id}}</dd></div><div v-if="detail.target.id"><dt class="text-muted">对象编号</dt><dd class="mt-1 break-all text-xs">{{detail.target.id}}</dd></div></dl>
      <section v-if="detail.fields.length" class="border-t border-default pt-5"><h3 class="mb-4 text-sm font-semibold">记录内容</h3><dl class="space-y-3 text-sm"><div v-for="field in detail.fields" :key="field.label" class="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-4"><dt class="text-muted">{{field.label}}</dt><dd class="break-words">{{field.value}}</dd></div></dl></section>
      <section v-if="detail.changes.length" class="border-t border-default pt-5"><h3 class="mb-4 text-sm font-semibold">变更内容</h3><div v-for="change in detail.changes" :key="change.label" class="mb-4 rounded-lg border border-default p-4"><p class="mb-3 text-sm font-medium">{{change.label}}</p><div class="grid gap-3 text-sm sm:grid-cols-2"><div><p class="mb-1 text-xs text-muted">变更前</p><p class="break-words">{{change.before}}</p></div><div><p class="mb-1 text-xs text-muted">变更后</p><p class="break-words">{{change.after}}</p></div></div></div></section>
      <p v-if="!detail.fields.length&&!detail.changes.length" class="border-t border-default pt-4 text-sm text-muted">该记录未保存可展示的变更内容。</p>
    </div>
  </template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="detailOpen=false">关闭</UButton></ConsoleFormActions></template></UModal>
</div></AdminConsole></template>
