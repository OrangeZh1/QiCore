<script setup lang="ts">
import {useMaintenanceReload} from '../lib/maintenance'
import {readLoadedPages} from '../lib/read-loaded-pages'
import ClientPageState from './ClientPageState.vue'
import {computed,ref,onMounted,onBeforeUnmount} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import ClientDialog from './ClientDialog.vue'
import {api,date,getToken,isH5,message,money} from '../lib/api'
import {consumerReady,consumerScope,consumerLogin} from '../lib/wallet'
const props=defineProps<{kind:'points'|'balance'}>()
const emit=defineEmits<{unavailable:[cause:{scope:string;message:string}]}>()
const points=props.kind==='points',label=points?'积分':'余额'
type Entry={id:string;kind:string;reference:string;delta:number;beforeAmount:number;afterAmount:number;createdAt:string}
const tabs=[{id:'all',label:'全部'},{id:'recharge',label:'充值'},{id:'spend',label:'消费'},{id:'return',label:'退回'},{id:'gift',label:'赠送'},{id:'adjust',label:'调整'},{id:'refund',label:'退款'}]
const titles:Record<string,string>={'recharge.paid':'充值到账','recharge.gift':'充值赠送',spend:'消费扣除',return:'消费退回',gift:points?'积分赠送':'余额赠送',adjust:'账户调整','refund.revoke':'退款回收'}
const filter=ref<string>('all'),rows=ref<Entry[]>([]),selected=ref<Entry|null>(null),loadAction=ref(''),error=ref(''),loaded=ref(false),guest=ref(false),page=ref(1),total=ref(0)
const entries=computed(()=>rows.value)
const groups=computed(()=>{
 const result:{month:string;items:Entry[]}[]=[]
 for(const entry of [...entries.value].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))){
  const month=date(entry.createdAt).slice(0,7);let group=result.find(item=>item.month===month)
  if(!group){group={month,items:[]};result.push(group)}group.items.push(entry)
 }
 return result
})
const icons:Record<string,string>={'recharge.paid':'wallet','recharge.gift':'gift',spend:'shopping-bag',return:'rotate-ccw',gift:'gift',adjust:'coins','refund.revoke':'rotate-ccw'}
const title=(entry:Entry)=>titles[entry.kind]||'账户变动'
const icon=(name:string)=>(isH5?'/h5-assets':'')+'/static/decoration/framework/icons/'+name+'.svg'
const number=(value:number)=>points?value.toLocaleString():money(value)
const amount=(entry:Entry)=>(entry.delta>0?'+':entry.delta<0?'−':'')+number(Math.abs(entry.delta))
const shortDate=(value:string)=>date(value).replace(/^\d{4}\//,'')
let alive=true,sequence=0,scope=''
const failedPage=ref(1)
function clearRecords(){rows.value=[];selected.value=null;total.value=0;page.value=1;loaded.value=false;failedPage.value=1}
function unavailable(own:string,reason=''){
 if(!alive)return
 sequence++;clearRecords();scope=consumerScope();loadAction.value='';guest.value=!getToken();error.value=guest.value?'':reason
 emit('unavailable',{scope:own,message:error.value})
}
async function load(source='initial',next=1){
 if(!alive||loadAction.value&&!source.startsWith('filter:')&&scope===consumerScope())return
 const attempt=++sequence;let own=consumerScope();loadAction.value=source;if(source!=='retry')error.value=''
 if(scope!==own){clearRecords();next=1;scope=own;error.value=''}
 try{
  const ready=await consumerReady();if(!alive||attempt!==sequence)return
  if(!ready){unavailable(own);return}
  guest.value=false;own=consumerScope();if(scope!==own){clearRecords();next=1;scope=own}
  failedPage.value=next
  const readPage=(next:number)=>api<{items:Entry[];page:number;pageSize:number;total:number}>('/wallet/'+props.kind+'/records?page='+next+'&pageSize=20&type='+filter.value)
  const result=source==='maintenance'?await readLoadedPages(readPage,page.value,()=>alive&&attempt===sequence&&own===consumerScope()):await readPage(next);if(!result)return
  if(alive&&attempt===sequence&&own===consumerScope()&&getToken()){rows.value=source!=='maintenance'&&next>1&&result.page===next?[...rows.value,...result.items]:result.items;page.value=result.page;total.value=result.total;loaded.value=true;error.value='';if(source==='maintenance'&&selected.value)selected.value=rows.value.find(item=>item.id===selected.value?.id)||null}
 }catch(cause){if(alive&&attempt===sequence){if([401,403].includes((cause as any)?.status))unavailable(own,message(cause));else if(own===consumerScope()&&getToken())error.value=message(cause)}}
 finally{if(alive&&attempt===sequence){loadAction.value='';if(own!==consumerScope()||!getToken())unavailable(own,'登录状态已变化，请重新读取明细')}}
}
function retry(){return load('retry',failedPage.value)}
function openRecord(entry:Entry){if(scope!==consumerScope()||!getToken()){unavailable(scope,'登录状态已变化，请重新读取明细');return}selected.value=entry}
function changeFilter(value:string){if(filter.value!==value&&tabs.some(tab=>tab.id===value)){filter.value=value;selected.value=null;rows.value=[];page.value=1;total.value=0;loaded.value=false;void load('filter:'+value)}}
onMounted(()=>void load())
onShow(()=>{if(loaded.value||guest.value||error.value)void load(loaded.value?'background':'initial')})
onBeforeUnmount(()=>{alive=false;sequence++;clearRecords()})
useMaintenanceReload(()=>load('maintenance'),()=>!!loadAction.value)
</script>
<template>
 <view class="balance-page asset-records">
  <scroll-view enhanced scroll-x :show-scrollbar="false" class="filter-scroll"><view class="balance-tabs" role="tablist" :aria-label="label+'记录类型'"><button v-for="tab in tabs" :key="tab.id" role="tab" :aria-selected="filter===tab.id" :aria-busy="loadAction==='filter:'+tab.id" :class="{active:filter===tab.id}" @click="changeFilter(tab.id)">{{tab.label}}<view v-if="loadAction==='filter:'+tab.id" class="filter-loading"/></button></view></scroll-view>
  <scroll-view enhanced class="balance-scroll" scroll-y :show-scrollbar="false"><view class="balance-body">
   <ClientPageState v-if="guest" :title="'登录后查看'+label+'明细'" :description="'查看每笔'+label+'变动的来源和记录'" @action="consumerLogin"/>
   <view v-if="loadAction&&!loaded&&!error" class="balance-state" role="status">正在读取明细…</view>
   <template v-if="entries.length">
    <view v-for="group in groups" :key="group.month" class="month-group">
     <view class="month-heading"><text>{{group.month.replace('/',' 年 ')}} 月</text><text>{{group.items.length}} 笔</text></view>
     <view class="entry-list">
      <button v-for="entry in group.items" :key="entry.id" role="button" class="entry-row" :aria-label="title(entry)+'，'+amount(entry)+(points?'积分':'元')+'，查看详情'" @click="openRecord(entry)">
       <view class="entry-icon" :class="entry.kind"><image :src="icon(icons[entry.kind]||'receipt-text')" mode="aspectFit"/></view>
       <view class="entry-copy"><text class="entry-title">{{title(entry)}}</text><text class="entry-time">{{shortDate(entry.createdAt)}}</text></view>
       <view class="entry-amount"><text :class="{income:entry.delta>0}">{{amount(entry)}}</text><text class="entry-balance">{{label}} {{number(entry.afterAmount)}}</text></view>
      </button>
     </view>
    </view>
    <button v-if="rows.length<total&&!error" role="button" class="load-more" :loading="loadAction==='more'" :aria-disabled="!!loadAction" :disabled="!!loadAction" @click="load('more',page+1)">加载更多</button><view v-else-if="!error" class="list-end">已显示全部记录</view>
   </template>
   <view v-else-if="!guest&&!error&&!loadAction" class="balance-state"><image :src="icon('receipt-text')" mode="aspectFit"/><text>{{filter==='all'?'暂无'+label+'记录':'暂无'+tabs.find(tab=>tab.id===filter)?.label+'记录'}}</text><text class="state-hint">{{label}}变动后，记录会显示在这里</text></view>
   <view v-if="error" class="balance-error" role="alert"><text>{{error}}</text><button role="button" :loading="loadAction==='retry'" :aria-disabled="!!loadAction" :disabled="!!loadAction" @click="retry">重新加载</button></view>
  </view></scroll-view>
  <ClientDialog v-if="selected" :title="label+'明细'" presentation="sheet" @close="selected=null">
   <view class="detail-heading"><view class="detail-icon"><image :src="icon(icons[selected.kind]||'receipt-text')" mode="aspectFit"/></view><text>{{title(selected)}}</text><view class="detail-amount" :class="{income:selected.delta>0}">{{amount(selected)}}<text>{{points?'积分':'元'}}</text></view></view>
   <view class="detail-fields"><view><text>交易时间</text><text>{{date(selected.createdAt)}}</text></view><view><text>变动来源</text><text>{{title(selected)}}</text></view><view><text>变动前{{label}}</text><text>{{number(selected.beforeAmount)}}</text></view><view><text>变动后{{label}}</text><text>{{number(selected.afterAmount)}}</text></view><view><text>流水编号</text><text>{{selected.id}}</text></view><view><text>关联编号</text><text>{{selected.reference}}</text></view></view>
   <template #footer><button role="button" class="detail-done" @click="selected=null">完成</button></template>
  </ClientDialog>
 </view>
</template>
<style scoped>
.balance-page{display:flex;flex-direction:column;flex:1;min-height:0;width:100%;overflow:hidden;background:var(--client-page-background, #f3f9ff);color:var(--client-text,#203450);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.balance-page view,.balance-page button{box-sizing:border-box}.balance-page button{margin:0;border:0;padding:0;background:transparent;color:inherit;font:inherit;line-height:1.5}.balance-page button::after{border:0}.balance-page button[disabled]{opacity:1}.preview-mode{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px var(--client-page-gutter, 10px) 8px;color:var(--client-muted,#718198);font-size:11px}.preview-mode button{min-height:30px;color:var(--client-primary,#3479f6);font-size:11px}.balance-tabs{display:flex;gap:4px;padding:0 var(--client-page-gutter, 10px)}.balance-tabs button{position:relative;flex:1;min-width:0;height:44px;color:var(--client-muted,#718198);font-size:14px}.balance-tabs button.active{color:var(--client-primary,#3479f6);font-weight:600}.balance-tabs button.active::before{content:'';position:absolute;left:50%;bottom:2px;transform:translateX(-50%);width:20px;height:3px;border-radius:2px;background:var(--client-primary,#3479f6)}.balance-scroll{flex:1;min-height:0;height:0}.balance-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(24px + env(safe-area-inset-bottom))}.month-group+.month-group{margin-top:22px}.month-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 2px;font-size:13px;font-weight:600}.month-heading>text:last-child{font-size:11px;font-weight:400;color:var(--client-muted,#718198)}.entry-list{padding:0 14px;border:1px solid #e7edf6;border-radius:16px;background:var(--client-surface,#fff)}.balance-page .entry-row{display:flex;align-items:center;gap:12px;width:100%;padding:17px 0;text-align:left}.entry-row+.entry-row{border-top:1px solid #eef1f6}.entry-icon,.detail-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:34px;height:34px;border-radius:10px;background:var(--client-primary-soft,#edf4ff)}.entry-icon.payment{background:var(--client-background,#f6f8fc)}.entry-icon image,.detail-icon image{width:19px;height:19px;opacity:.7}.entry-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:6px}.entry-title{font-size:13px;font-weight:500;overflow-wrap:anywhere}.entry-time{font-size:10px;color:var(--client-muted,#718198);white-space:nowrap}.entry-amount{display:flex;flex-shrink:0;flex-direction:column;align-items:flex-end;gap:5px;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}.entry-amount>.entry-balance{font-size:10px;font-weight:400;color:var(--client-muted,#718198)}.income{color:var(--client-primary,#3479f6)}.list-end{padding-top:22px;text-align:center;color:var(--client-muted,#718198);font-size:11px}.balance-state{display:flex;flex-direction:column;align-items:center;gap:14px;padding:76px 10px;color:var(--client-muted,#718198);text-align:center}.balance-state image{width:46px;height:46px;opacity:.35}.state-hint{font-size:12px;line-height:1.7}.balance-error{padding:14px;border-radius:12px;background:#fff0ef;color:#b84039}.balance-error button{display:flex;align-items:center;justify-content:center;min-height:36px;margin-top:10px;padding:0 14px;border-radius:8px;background:#ffe5e1}.detail-heading{display:flex;align-items:center;flex-direction:column;gap:10px;padding:8px 0 24px;font-size:14px}.detail-icon{width:42px;height:42px;border-radius:13px}.detail-icon image{width:24px;height:24px}.detail-amount{display:flex;align-items:baseline;gap:5px;font-size:32px;line-height:1.3;font-weight:650;font-variant-numeric:tabular-nums}.detail-amount text{font-size:12px;font-weight:400;color:var(--client-muted,#718198)}.detail-fields{display:flex;flex-direction:column;gap:16px;padding-top:18px;border-top:1px solid #eef1f6}.detail-fields>view{display:flex;justify-content:space-between;gap:20px;font-size:12px}.detail-fields>view>text:first-child{flex-shrink:0;color:var(--client-muted,#718198)}.detail-fields>view>text:last-child{min-width:0;text-align:right;overflow-wrap:anywhere}.balance-page .detail-done{display:flex;align-items:center;justify-content:center;width:100%;height:44px;border-radius:12px;background:var(--client-primary,#3479f6);color:#fff;font-size:14px;font-weight:600}@media(max-width:350px){.balance-body{padding-inline:var(--client-page-gutter, 10px)}.entry-list{padding-inline:12px}.entry-row{gap:9px!important}.entry-icon{width:30px;height:30px}.entry-amount{font-size:16px}.entry-title{font-size:12px}}
</style>
<style scoped>.filter-scroll{flex-shrink:0;white-space:nowrap}.balance-tabs{display:inline-flex;width:max-content;min-width:100%;box-sizing:border-box;gap:2px;padding:0 var(--client-page-gutter, 10px)}.balance-tabs button{flex:1;min-width:44px;font-size:12px}.filter-loading{position:absolute;width:8px;height:8px;border:1px solid currentColor;border-top-color:transparent;border-radius:50%;right:0;top:3px;animation:ledger-spin .7s linear infinite}.load-more{width:100%;min-height:44px;color:var(--client-primary)!important}.balance-state button{color:var(--client-primary)}@keyframes ledger-spin{to{transform:rotate(360deg)}}</style>
