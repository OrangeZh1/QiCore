<script setup lang="ts">
import ConsoleDrawer from '../console/ConsoleDrawer.vue'
import ConsoleQueryButton from '../console/ConsoleQueryButton.vue'
import ConsumerIdentity from './ConsumerIdentity.vue'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import {dateTime} from '../../utils/update-center'
const props=defineProps<{applicationKey:string}>()
type Refund={id:string;source:string;state:string;requestedCents:number;payerRefundCents:number|null;createdAt:string;succeededAt:string|null;lastError:string|null}
type Payment={id:string;orderId:string;name:string;kind:string|null;sequence:number;current:boolean;previousPaymentId:string|null;user:{id:string;nickname:string|null;avatar:string|null};amountCents:number;payerTotalCents:number|null;state:string;channel:string;env:number|null;subjectType:string;createdAt:string;paidAt:string|null;delivery:string;lastError:string|null;businessStatus:string|null;refundedCents:number;observedRefundCents:number;refunds:Refund[]}
type Listing={items:Payment[];total:number;page:number;pageSize:number}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/payment-settings/'+encodeURIComponent(props.applicationKey)+'/wechat-virtual/orders'
const q=ref(''),state=ref('all'),channel=ref('all'),applied=ref({q:'',state:'all',channel:'all'}),page=ref(1),action=ref(''),error=ref('')
const params=()=>new URLSearchParams({...applied.value,page:String(page.value),pageSize:'20'})
const exposedReady=ref(false)
defineExpose({refresh:(source?:string)=>exposedReady.value?load(source):undefined,get refreshing(){return exposedReady.value&&action.value==='refresh'}})
const initial=await useAsyncData<Listing>('virtual-orders:'+auth.session.value?.id+':'+tenantId+':'+props.applicationKey,(_,{signal})=>auth.api<Listing>(endpoint+'?'+params(),'GET',undefined,{signal}))
const data=ref<Listing>(initial.data.value||{items:[],total:0,page:1,pageSize:20});error.value=initial.error.value?.message||''
const states:Record<string,string>={PREPARING:'待确认',READY:'待支付',PAID:'已支付',PARTIAL_REFUND:'部分退款',COMPENSATION:'待补偿',REFUNDED:'已退款',CLOSED:'已关闭',REVIEW:'待核查'}
const channels:Record<string,string>={standard:'普通支付',apple:'Apple 支付',unknown:'待确认'},businessStates:Record<string,string>={pending:'待付款',paid:'已支付',cancelled:'已取消',refunded:'已退款',partial_refund:'部分退款',refund_pending:'退款处理中',compensation_due:'待补偿'}
const refundStates:Record<string,string>={APPLIED:'待审核',REJECTED:'已拒绝',PENDING:'待处理',PROCESSING:'处理中',ABNORMAL:'待核查',CLOSED:'已关闭',SUCCESS:'已退款'}
const columns=[{id:'order',header:'订单'},{id:'user',header:'用户'},{id:'channel',header:'支付渠道'},{id:'amount',header:'应付 / 实付'},{id:'state',header:'支付状态'},{id:'createdAt',header:'发起时间'},{id:'actions',header:'操作'}]
const money=(value:number|null)=>value==null?'—':'¥ '+Math.trunc(value/100)+'.'+String(value%100).padStart(2,'0')
const lifetime=new AbortController();let disposed=false,listSequence=0,listController:AbortController|undefined,detailSequence=0,detailController:AbortController|undefined
const target=ref<Payment|null>(null),detail=ref<Payment|null>(null),detailAction=ref(''),detailError=ref('')
async function load(source='refresh'){
 if(disposed)return;listController?.abort();listController=new AbortController();const current=++listSequence;action.value=source
 try{const value=await auth.api<Listing>(endpoint+'?'+params(),'GET',undefined,{signal:AbortSignal.any([lifetime.signal,listController.signal])});if(!disposed&&current===listSequence){data.value=value;page.value=value.page;error.value=''}}catch(e:any){if(!disposed&&current===listSequence)error.value=e.message||'订单读取失败'}finally{if(!disposed&&current===listSequence)action.value=''}
}
function filter(source:'search'|'reset'){if(source==='reset'){q.value='';state.value='all';channel.value='all'}applied.value={q:q.value.trim(),state:state.value,channel:channel.value};page.value=1;void load(source)}
function setPage(value:number){if(value===page.value)return;page.value=value;void load('page')}
function open(row:Payment){target.value=row;detail.value=null;detailError.value='';void readDetail('open')}
async function readDetail(source='refresh'){
 if(!target.value||disposed)return;detailController?.abort();detailController=new AbortController();const current=++detailSequence,id=target.value.id;detailAction.value=source;detailError.value=''
 try{const value=await auth.api<Payment>(endpoint+'/'+id,'GET',undefined,{signal:AbortSignal.any([lifetime.signal,detailController.signal])});if(!disposed&&current===detailSequence&&target.value?.id===id)detail.value=value}catch(e:any){if(!disposed&&current===detailSequence&&target.value?.id===id)detailError.value=e.message||'详情读取失败'}finally{if(!disposed&&current===detailSequence)detailAction.value=''}
}
function close(){detailSequence++;detailController?.abort();target.value=null;detail.value=null;detailAction.value='';detailError.value=''}
onBeforeUnmount(()=>{disposed=true;listSequence++;detailSequence++;listController?.abort();detailController?.abort();lifetime.abort()})
exposedReady.value=true
</script>
<template><div class="space-y-5">
 <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索订单号、支付编号或账号"/><USelect v-model="channel" :items="[{value:'all',label:'全部支付渠道'},{value:'standard',label:'普通支付'},{value:'apple',label:'Apple 支付'}]" aria-label="支付渠道"/><USelect v-model="state" :items="[{value:'all',label:'全部支付状态'},...Object.entries(states).map(([value,label])=>({value,label}))]" aria-label="支付状态"/><div class="flex gap-3"><ConsoleQueryButton type="submit" :loading="action==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="action==='reset'" @click="filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
 <ConsoleDataTable :data="data.items" :columns="columns" :total="data.total" :page="page" :page-size="20" :client-pagination="false" :error="error" empty-title="暂无虚拟支付订单" min-table-width="1000px" @retry="load('retry')" @update:page="setPage">
  <template #order-cell="{row}"><p class="font-medium">{{row.original.name}}</p><p class="text-xs text-muted">{{row.original.orderId}}</p><p class="text-xs text-muted">第 {{row.original.sequence}} 次支付 · {{row.original.current?'当前支付':'已切换'}}</p></template>
  <template #user-cell="{row}"><ConsumerIdentity :user-id="row.original.user.id" :profile="row.original.user"/></template>
  <template #channel-cell="{row}">{{channels[row.original.channel]||'待确认'}}<p class="text-xs text-muted">{{row.original.env===0?'现网':row.original.env===1?'沙箱':'—'}}</p></template>
  <template #amount-cell="{row}"><p>{{money(row.original.amountCents)}}</p><p class="text-xs text-muted">实付 {{money(row.original.payerTotalCents)}}</p></template>
  <template #state-cell="{row}">{{states[row.original.state]||'待核查'}}<p v-if="row.original.refundedCents" class="text-xs text-muted">已退 {{money(row.original.refundedCents)}}</p></template>
  <template #createdAt-cell="{row}">{{dateTime(row.original.createdAt)}}</template>
  <template #actions-cell="{row}"><UButton variant="link" class="px-0" @click="open(row.original)">查看详情</UButton></template>
 </ConsoleDataTable>
 <ConsoleDrawer :open="!!target" title="虚拟支付订单详情" @update:open="!$event&&close()"><template #body>
  <UAlert v-if="detailError" color="error" :title="detailError"><template #actions><UButton :loading="detailAction==='retry'" @click="readDetail('retry')">重试</UButton></template></UAlert><p v-else-if="detailAction&&!detail" role="status" class="text-sm text-muted">正在读取订单详情…</p>
  <div v-if="detail" class="drawer-detail space-y-6"><section class="space-y-4"><div class="flex items-center justify-between gap-3"><h3 class="drawer-section-title">{{states[detail.state]||'待核查'}}</h3><UButton color="neutral" variant="outline" :disabled="!!detailAction" @click="readDetail()"><template #leading><UIcon name="i-lucide-refresh-cw" class="size-4" :class="{'animate-spin':detailAction==='refresh'}"/></template>刷新状态</UButton></div><ConsumerIdentity :user-id="detail.user.id" :profile="detail.user" prominent/></section>
   <section><dl class="drawer-facts"><dt>购买内容</dt><dd>{{detail.name}}</dd><dt>业务订单</dt><dd class="break-all">{{detail.orderId}}</dd><dt>业务订单状态</dt><dd>{{businessStates[detail.businessStatus||'']||'—'}}</dd><dt>支付编号</dt><dd class="break-all">{{detail.id}}</dd><dt>支付记录</dt><dd>第 {{detail.sequence}} 次 · {{detail.current?'当前支付':'已切换的历史支付'}}</dd><dt>支付渠道</dt><dd>{{channels[detail.channel]||'待确认'}}</dd><dt>主体类型</dt><dd>{{detail.subjectType==='personal'?'个人主体':'企业 / 个体户'}}</dd><dt>环境</dt><dd>{{detail.env===0?'现网':detail.env===1?'沙箱':'—'}}</dd><dt>应付金额</dt><dd>{{money(detail.amountCents)}}</dd><dt>实际支付</dt><dd>{{money(detail.payerTotalCents)}}</dd><dt>发起时间</dt><dd>{{dateTime(detail.createdAt)}}</dd><dt>到账时间</dt><dd>{{dateTime(detail.paidAt)}}</dd><dt>发货确认</dt><dd>{{!detail.paidAt?'—':detail.delivery==='delivered'?'已确认':'待确认'}}</dd></dl></section>
   <UAlert v-if="detail.state==='REVIEW'||detail.lastError" color="warning" :title="detail.lastError==='VIRTUAL_EXTERNAL_REFUND_REVIEW'?'平台退款待核查':'原支付结果待核查'" :description="detail.lastError==='VIRTUAL_EXTERNAL_REFUND_REVIEW'?'平台查单发现退款，请核对原订单资金与到账资产。系统保留证据，不扣除其他订单的资产。':'原支付记录已保留，请核对渠道结果。'"/>
   <section v-if="detail.refunds.length" class="space-y-3"><h3 class="drawer-section-title">退款记录</h3><div v-for="refund in detail.refunds" :key="refund.id" class="border-t border-default pt-3 text-sm"><div class="flex flex-wrap justify-between gap-2"><span>{{refund.source==='compensation'?'异常补偿':'订单退款'}}</span><span>{{refundStates[refund.state]||'待核查'}}</span></div><p class="mt-2 break-all text-xs text-muted">{{refund.id}}</p><p class="mt-2">申请 {{money(refund.requestedCents)}} · 实退 {{money(refund.payerRefundCents)}}</p><p class="mt-2 text-xs text-muted">{{dateTime(refund.succeededAt||refund.createdAt)}}</p></div></section>
  </div>
 </template></ConsoleDrawer>
</div></template>
