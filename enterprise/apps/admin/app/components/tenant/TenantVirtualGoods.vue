<script setup lang="ts">
import ConsoleDiscardChangesDialog from '../console/ConsoleDiscardChangesDialog.vue'
import PackageThumbnail from './PackageThumbnail.vue'
import ConsoleDrawer from '../console/ConsoleDrawer.vue'
import AccountImageInput from '../console/AccountImageInput.vue'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import {dateTime} from '../../utils/update-center'
const props=defineProps<{applicationKey:string;settingsVersion:number;settingsDirty:boolean;settingsBusy:boolean;standalone?:boolean}>()
type Defaults={name:string;image:string|null;price:number;productId:string}
type Item=Defaults&{sourceType?:string;priceLocked?:boolean;localId:string;sourceName:string;draftVersion:number;defaults:Defaults;reason:string;uploadState:string;publishState:string;message:string;updatedAt:string|null}
type Task={operationId:string;action:'upload'|'publish';state:string;completed:number;total:number;message:string;updatedAt:string}
type View={version:number;catalogHash:string;env:number;canWrite:boolean;ready:boolean;message:string;sharedBusy:boolean;items:Item[];task:Task|null}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value
const endpoint=()=>'/admin/tenants/'+encodeURIComponent(tenantId)+'/payment-settings/'+encodeURIComponent(props.applicationKey)+'/wechat-virtual/goods'
const exposedReady=ref(false)
// Expose the public handle before async setup yields; methods wait for local state.
defineExpose({refresh:(source?:'refresh'|'context'|'page-refresh')=>exposedReady.value?refresh(source):undefined,requestLeave:(next:()=>void)=>exposedReady.value?requestLeave(next):next(),get refreshing(){return exposedReady.value&&action.value==='page-refresh'}})
const initial=await useAsyncData<View>('virtual-goods:'+auth.session.value?.id+':'+tenantId+':'+props.applicationKey,(_nuxt,{signal})=>auth.api<View>(endpoint(),'GET',undefined,{signal}))
const data=ref<View|null>(initial.data.value??null),error=ref(initial.error.value?.message||''),action=ref<'upload'|'publish'|'refresh'|'query'|'poll'|'context'|'page-refresh'|'save'|null>(null),confirmAction=ref<'upload'|'publish'|null>(null)
const editBaseline=ref(''),discard=useDiscardChanges(()=>!!action.value||imageBusy.value)
const editOpen=ref(false),editing=ref<Item|null>(null),editError=ref(''),imageBusy=ref(false),editForm=reactive({name:'',image:null as string|null,price:'',productId:''})
const labels:Record<string,string>={PENDING:'未处理',RUNNING:'处理中',UNKNOWN:'待确认',SUCCESS:'成功',FAILED:'失败',CONFLICT:'需核对'}
const columns=[{accessorKey:'name',header:'虚拟商品'},{accessorKey:'sourceType',header:'业务类型'},{accessorKey:'price',header:'售价'},{accessorKey:'productId',header:'微信商品 ID'},{accessorKey:'uploadState',header:'上传状态'},{accessorKey:'publishState',header:'发布状态'},{id:'message',header:'处理说明'},{accessorKey:'updatedAt',header:'更新时间'},{id:'actions',header:'操作'}]
const taskActive=computed(()=>!!data.value?.task&&['RUNNING','UNKNOWN'].includes(data.value.task.state))
const blocked=computed(()=>!!action.value||props.settingsBusy||props.settingsDirty||!data.value?.canWrite)
const uploadCount=computed(()=>data.value?.items.filter(i=>!i.reason&&['PENDING','FAILED'].includes(i.uploadState)).length||0)
const publishCount=computed(()=>data.value?.items.filter(i=>!i.reason&&i.uploadState==='SUCCESS'&&['PENDING','FAILED'].includes(i.publishState)).length||0)
const color=(state:string)=>state==='SUCCESS'?'success' as const:state==='FAILED'||state==='CONFLICT'?'error' as const:state==='PENDING'?'neutral' as const:'warning' as const
const controller=new AbortController();let disposed=false,sequence=0,timer:ReturnType<typeof setTimeout>|undefined,pendingOperation:string|null=null
function schedule(){if(timer)clearTimeout(timer);if(!disposed&&data.value?.task?.state==='RUNNING'&&!props.settingsDirty&&!props.settingsBusy)timer=setTimeout(()=>{void query('poll')},2000)}
async function refresh(source:'refresh'|'context'|'page-refresh'='refresh'){
 if(disposed||action.value)return;const current=++sequence;action.value=source;error.value=''
 try{const value=await auth.api<View>(endpoint(),'GET',undefined,{signal:controller.signal});if(!disposed&&current===sequence)data.value=value}catch(e:any){if(!disposed&&current===sequence)error.value=e.message||'商品读取失败'}finally{if(!disposed&&current===sequence){action.value=null;schedule()}}
}
function closeConfirm(value:boolean){if(!value)confirmAction.value=null}
function fillEditor(value:Defaults){editForm.name=value.name;editForm.image=value.image;editForm.price=(value.price/100).toFixed(2);editForm.productId=value.productId}
function openEditor(row:Item){if(blocked.value||taskActive.value)return;editing.value={...row,defaults:{...row.defaults}};fillEditor(row);editBaseline.value=JSON.stringify(editForm);editError.value='';editOpen.value=true}
function requestLeave(next:()=>void){if(action.value||imageBusy.value)return;const leave=()=>{editOpen.value=false;discard.keep();next()};if(editOpen.value&&JSON.stringify(editForm)!==editBaseline.value){discard.request(leave);return}leave()}
function closeEditor(){requestLeave(()=>{})}
function useOriginal(){if(editing.value&&!action.value&&!imageBusy.value)fillEditor(editing.value.defaults)}
async function saveEditor(){
 if(blocked.value||imageBusy.value||!editing.value)return
 if(editing.value.priceLocked)editForm.image=editing.value.image
 const price=editForm.price.trim();if(!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(price)){editError.value='价格最多保留两位小数';return}
 const [whole,fraction='']=price.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 if(!editForm.name.trim()||[...editForm.name.trim()].length>20||!cents||cents>100000000||!/^[A-Za-z0-9_-]{1,20}$/.test(editForm.productId)){editError.value='请检查名称、微信商品 ID 和价格';return}
 const current=++sequence,row=editing.value;action.value='save';editError.value=''
 try{const value=await auth.api<View>(endpoint()+'/'+encodeURIComponent(row.localId),'PUT',{version:row.draftVersion,name:editForm.name.trim(),image:editForm.image,price:cents,productId:editForm.productId},{signal:controller.signal});if(!disposed&&current===sequence){data.value=value;editOpen.value=false}}
 catch(e:any){if(!disposed&&current===sequence)editError.value=e.message||'虚拟套餐保存失败，修改已保留'}finally{if(!disposed&&current===sequence)action.value=null}
}
function askUpload(){if(!blocked.value&&!taskActive.value&&data.value?.ready&&!data.value.sharedBusy&&uploadCount.value)confirmAction.value='upload'}
function askPublish(){if(!blocked.value&&!taskActive.value&&data.value?.ready&&!data.value.sharedBusy&&publishCount.value)confirmAction.value='publish'}
async function start(){
 const mode=confirmAction.value;if(!mode||blocked.value||!data.value)return;const current=++sequence;action.value=mode;error.value='';if(!pendingOperation)pendingOperation=crypto.randomUUID()
 try{const value=await auth.api<View>(endpoint(),'POST',{operationId:pendingOperation,version:data.value.version,catalogHash:data.value.catalogHash,action:mode},{signal:controller.signal});if(!disposed&&current===sequence){data.value=value;confirmAction.value=null;pendingOperation=null}}
 catch(e:any){if(!disposed&&current===sequence)error.value=e.message||'任务提交结果未确认，请重新读取后查看原任务'}finally{if(!disposed&&current===sequence){action.value=null;schedule()}}
}
async function query(source:'query'|'poll'='query'){
 if(disposed||blocked.value||!data.value?.task||!taskActive.value)return;const operationId=data.value.task.operationId,current=++sequence;action.value=source;error.value=''
 try{const value=await auth.api<View>(endpoint()+'/advance','POST',{operationId},{signal:controller.signal});if(!disposed&&current===sequence)data.value=value}catch(e:any){if(!disposed&&current===sequence){error.value=e.message||'进度读取失败，请稍后查询原任务';if(timer)clearTimeout(timer)}}finally{if(!disposed&&current===sequence){action.value=null;if(!error.value)schedule()}}
}
watch(()=>[props.applicationKey,props.settingsVersion],()=>{if(timer)clearTimeout(timer);sequence++;action.value=null;data.value=null;confirmAction.value=null;editOpen.value=false;pendingOperation=null;void refresh('context')})
watch(()=>[props.settingsBusy,props.settingsDirty],()=>schedule())
watch(confirmAction,()=>{if(!action.value)pendingOperation=null})
exposedReady.value=true
usePageLeaveGuard(to=>{if(action.value==='save'||imageBusy.value)return false;if(editOpen.value&&JSON.stringify(editForm)!==editBaseline.value){return discard.decide(()=>{editOpen.value=false})}})
onMounted(schedule)
onBeforeUnmount(()=>{disposed=true;sequence++;controller.abort();if(timer)clearTimeout(timer);action.value=null})
</script>
<template><section class="space-y-4" :class="props.standalone?'':'border-t border-default pt-5'">
 <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="text-sm font-semibold">微信虚拟商品</h3><p class="mt-1 text-xs leading-5 text-muted">积分套餐与固定余额档位来自充值配置，到账数量和价格以购买快照为准。套餐名称、价格和封面在充值配置维护；微信商品 ID 在此管理，上传后另行发布。</p></div><div class="flex flex-wrap gap-2">
  <UButton type="button" color="neutral" variant="outline" :disabled="!!action" @click="refresh()"><template #leading><UIcon name="i-lucide-refresh-cw" class="size-4" :class="{'animate-spin':action==='refresh'}"/></template>重新读取</UButton>
  <UButton type="button" icon="i-lucide-upload" :loading="action==='upload'&&!confirmAction" :disabled="blocked||taskActive||!data?.ready||data?.sharedBusy||!uploadCount" @click="askUpload">一键上传商品</UButton>
  <UButton type="button" color="neutral" variant="outline" :loading="action==='publish'&&!confirmAction" :disabled="blocked||taskActive||!data?.ready||data?.sharedBusy||!publishCount" @click="askPublish">一键发布商品</UButton>
 </div></div>
 <p class="text-xs text-muted">当前环境：{{data?.env===0?'现网':'沙箱'}}。微信每次只接收一个商品，系统按顺序处理。离开页面后可回来查询原任务继续处理。</p>
 <UAlert v-if="props.settingsDirty" color="warning" title="请先保存或取消支付配置的修改，再操作商品。"/>
 <UAlert v-if="data&&!data.ready" color="warning" :title="data.message"/>
 <UAlert v-if="data?.sharedBusy" color="warning" title="同一小程序的当前环境已有任务，请稍后重新读取。"/>
 <UAlert v-if="error" color="error" :title="error"/>
 <div v-if="data?.task" class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-3"><div class="text-sm"><p>{{data.task.action==='upload'?'商品上传':'商品发布'}}：{{data.task.completed}} / {{data.task.total}}</p><p class="mt-1 text-xs text-muted">{{data.task.message}} · {{dateTime(data.task.updatedAt)}}</p></div><UButton v-if="taskActive" type="button" color="neutral" variant="outline" :loading="action==='query'" :disabled="blocked" @click="query('query')">查询进度</UButton></div>
 <ConsoleDataTable class="virtual-goods-table" :data="data?.items||[]" :columns="columns" :total="data?.items.length||0" :page="1" :page-size="200" :pagination="false" row-key="productId" empty-title="暂无已启用商品，请先在充值配置中添加档位。">
  <template #name-cell="{row}"><div class="flex min-w-56 items-center gap-4"><PackageThumbnail :image="row.original.image" :name="row.original.name"/><div class="min-w-0"><p class="max-w-44 truncate font-medium" :title="row.original.name">{{row.original.name}}</p><p class="mt-1 text-xs text-muted">原套餐：{{row.original.sourceName||row.original.localId}}</p></div></div></template>
  <template #sourceType-cell="{row}">{{row.original.sourceType==='points'?'积分充值':row.original.sourceType==='balance'?'余额充值':'历史套餐'}}</template>
  <template #price-cell="{row}">¥{{(row.original.price/100).toFixed(2)}}</template>
  <template #productId-cell="{row}"><span class="font-mono text-xs">{{row.original.productId}}</span></template>
  <template #uploadState-cell="{row}"><UBadge :color="color(row.original.uploadState)" variant="subtle">{{labels[row.original.uploadState]}}</UBadge></template>
  <template #publishState-cell="{row}"><UBadge :color="color(row.original.publishState)" variant="subtle">{{labels[row.original.publishState]}}</UBadge></template>
  <template #message-cell="{row}"><span class="block max-w-64 whitespace-normal text-xs" :class="row.original.reason?'text-warning':'text-muted'">{{row.original.reason||row.original.message||'—'}}</span></template>
  <template #updatedAt-cell="{row}">{{dateTime(row.original.updatedAt)}}</template>
  <template #actions-cell="{row}"><UButton v-if="data?.canWrite" type="button" size="sm" variant="link" class="px-0" :disabled="blocked||taskActive" @click="openEditor(row.original)">编辑</UButton><span v-else class="text-xs text-muted">只读</span></template>
 </ConsoleDataTable>
 <ConsoleDrawer :open="editOpen" @update:open="!$event&&closeEditor()" title="编辑虚拟套餐" description="仅保存虚拟支付的配置，原套餐及已经上传的商品记录保持不变。" wide :dismissible="!action&&!imageBusy" :close="!action&&!imageBusy"><template #body><form id="virtual-goods-form" class="space-y-6" @submit.prevent="saveEditor"><UAlert v-if="editError" color="error" :title="editError"/><ConsoleSettingsField label="原套餐"><div class="flex flex-wrap items-center justify-between gap-3"><span>{{editing?.sourceName||editing?.localId}}</span><UButton type="button" color="neutral" variant="outline" :disabled="!!action||imageBusy" @click="useOriginal">使用原套餐数据</UButton></div></ConsoleSettingsField><ConsoleSettingsField label="套餐封面"><div v-if="editing?.priceLocked" class="flex items-center gap-3"><PackageThumbnail :image="editForm.image" :name="editForm.name"/><UButton to="/admin/recharge" variant="link">在充值配置维护封面</UButton></div><AccountImageInput v-else v-model="editForm.image" label="虚拟套餐封面" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/'+encodeURIComponent(props.applicationKey)" fit="contain" :image-size="512" fallback="" :disabled="!!action" @busy="imageBusy=$event"/></ConsoleSettingsField><ConsoleSettingsField label="套餐名称" input-id="virtual-name"><ConsoleInput id="virtual-name" v-model="editForm.name" :maxlength="20" required :disabled="!!action||editing?.priceLocked"/></ConsoleSettingsField><ConsoleSettingsField label="微信商品 ID" input-id="virtual-product-id"><ConsoleInput id="virtual-product-id" v-model="editForm.productId" :maxlength="20" pattern="[A-Za-z0-9_-]{1,20}" required :disabled="!!action"/><p class="mt-2 text-xs text-muted">1–20 位字母、数字、下划线或短横线。已上传商品更改名称、封面或价格时，需要使用新 ID。</p></ConsoleSettingsField><ConsoleSettingsField label="售价（元）" input-id="virtual-price"><ConsoleInput id="virtual-price" v-model="editForm.price" inputmode="decimal" required :disabled="!!action||editing?.priceLocked"/><p class="mt-2 text-xs text-muted">{{editing?.priceLocked?'价格由充值配置决定；赠送数量与到账资产使用原充值快照。':'最低 0.01 元，最多两位小数。权益使用历史套餐快照。'}}</p></ConsoleSettingsField></form></template><template #footer><ConsoleFormActions><UButton type="button" color="neutral" variant="outline" :disabled="!!action||imageBusy" @click="closeEditor">取消</UButton><UButton type="submit" form="virtual-goods-form" :loading="action==='save'" :disabled="!!action||imageBusy">保存虚拟套餐</UButton></ConsoleFormActions></template></ConsoleDrawer>
 <UModal :open="!!confirmAction" :title="confirmAction==='upload'?'上传商品到微信？':'发布微信商品？'" :description="`将处理当前${data?.env===0?'现网':'沙箱'}环境的 ${confirmAction==='upload'?uploadCount:publishCount} 个商品。${confirmAction==='upload'?'不符合要求的套餐会跳过，并在列表标明原因。':'仅发布已上传成功的商品，平台同步需要一定时间。'}`" :dismissible="!action" :close="!action" @update:open="closeConfirm"><template #body><UAlert v-if="error" color="error" :title="error"/></template><template #footer><div class="flex w-full justify-end gap-3"><UButton type="button" color="neutral" variant="outline" :disabled="!!action" @click="confirmAction=null">取消</UButton><UButton type="button" :loading="action==='upload'||action==='publish'" :disabled="blocked" @click="start">{{confirmAction==='upload'?'确认上传':'确认发布'}}</UButton></div></template></UModal>
<ConsoleDiscardChangesDialog :controller="discard"/></section></template>

<style scoped>.virtual-goods-table{border:0;border-radius:0;box-shadow:none}</style>
