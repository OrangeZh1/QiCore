<script setup lang="ts">
import {readLoadedPages} from '../../lib/read-loaded-pages'
import {useMaintenanceReload} from '../../lib/maintenance'
import {computed,ref} from 'vue'
import {onLoad,onShow,onUnload} from '@dcloudio/uni-app'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientPageState from '../../components/ClientPageState.vue'
import ClientChevron from '../../components/ClientChevron.vue'
import ClientDialog from '../../components/ClientDialog.vue'
import {clientThemeStyle} from '../../lib/client-theme'
import {api,date,getToken,consumerReady,consumerScope,consumerLogin,isClientPreview,isH5,message} from '../../lib/api'
type Level={id:string|null;name:string;rank:number|null;defined?:boolean}
type Entry={id:string;kind:string;before:number;after:number;levelBefore:Level|null;levelAfter:Level|null;event:'initial'|'upgrade'|null;reason:string;createdAt:string}
type View={growth:number;current:Level;items:Entry[];total:number;page:number;pageSize:number}
const data=ref<View|null>(null),tab=ref<'growth'|'levels'>('growth'),selected=ref<Entry|null>(null),demo=ref(false),action=ref(''),error=ref(''),guest=ref(false)
const detailTarget=ref(''),detailAction=ref(''),detailError=ref('')
const titles:Record<string,string>={registration:'注册赠送',purchase:'消费获得',purchase_refund:'退款扣回',growth:'成长值调整'}
const upgrade=(item:Entry)=>!!item.levelAfter&&item.kind!=='tags'&&(!item.levelBefore||item.levelAfter.id!==item.levelBefore.id&&item.levelAfter.rank!==null&&item.levelBefore.rank!==null&&item.levelAfter.rank>item.levelBefore.rank)
const records=computed(()=>data.value?.items||[])
const groups=computed(()=>{
 const result:{month:string;items:Entry[]}[]=[]
 for(const item of [...records.value].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))){const month=date(item.createdAt).slice(0,7);let group=result.find(value=>value.month===month);if(!group){group={month,items:[]};result.push(group)}group.items.push(item)}
 return result
})
const asset=(name:string)=>(isH5?'/h5-assets':'')+'/static/decoration/framework/icons/'+name+'.svg'
const title=(item:Entry)=>tab.value==='levels'?item.levelBefore?'升级为 '+item.levelAfter?.name:'获得 '+item.levelAfter?.name:titles[item.kind]||'成长值变动'
const delta=(item:Entry)=>(item.after>item.before?'+':item.after<item.before?'−':'')+Math.abs(item.after-item.before).toLocaleString()
const time=(value:string)=>date(value).replace(/^\d{4}\//,'')
let alive=true,sequence=0,detailSequence=0,scope='',retryPage=1
function unavailable(reason='',unauthenticated=false){sequence++;data.value=null;closeDetail();retryPage=1;scope=consumerScope();action.value='';guest.value=unauthenticated||!getToken();error.value=guest.value?'':reason}
async function load(source='initial',page=1){
 if(!alive||action.value&&!source.startsWith('tab:')&&scope===consumerScope())return
 const attempt=++sequence,preview=demo.value,type=tab.value;action.value=source;if(source!=='retry')error.value=''
 let own=consumerScope()
 if(scope!==own){data.value=null;closeDetail();page=1;scope=own;error.value=''}
 retryPage=page
 try{
  const ready=await consumerReady();if(!alive||attempt!==sequence)return;if(!ready){unavailable();return}
  guest.value=false;own=consumerScope();if(scope!==own){data.value=null;closeDetail();page=1;retryPage=1;scope=own}let value:View
  if(preview){const sample=await api<{demo:boolean;growth:number;current:Level;records:Entry[]}>('/dev/growth-records');if(sample.demo!==true)throw Error('演示记录读取失败');const items=sample.records.filter(item=>type==='growth'?item.after!==item.before:upgrade(item));value={growth:sample.growth,current:sample.current,items:items.slice((page-1)*20,page*20),total:items.length,page,pageSize:20}}
  else{const readPage=(page:number)=>api<View>('/growth-records?type='+type+'&page='+page+'&pageSize=20');const result=source==='maintenance'?await readLoadedPages(readPage,data.value?.page||1,()=>alive&&attempt===sequence&&own===consumerScope()):await readPage(page);if(!result)return;value=result}
  if(!alive||attempt!==sequence)return
  if(own!==consumerScope()){unavailable('登录状态已变化，请重新读取记录');return}
  if(preview!==demo.value)return
  data.value={...value,items:source!=='maintenance'&&page>1&&page===value.page?[...(data.value?.items||[]),...value.items]:value.items};error.value=''
 }catch(cause){if(alive&&attempt===sequence){if(own!==consumerScope())unavailable('登录状态已变化，请重新读取记录');else if([401,403].includes((cause as any)?.status))unavailable(message(cause),(cause as any)?.status===401);else error.value=message(cause)}}finally{if(alive&&attempt===sequence)action.value=''}
}
function changeTab(value:'growth'|'levels'){if(value===tab.value)return;tab.value=value;closeDetail();if(data.value)data.value={...data.value,items:[],total:0,page:1};void load('tab:'+value)}
function toggleDemo(){if(!isClientPreview)return;sequence++;action.value='';demo.value=!demo.value;data.value=null;closeDetail();error.value='';void load('mode')}
function closeDetail(){detailSequence++;detailTarget.value='';selected.value=null;detailAction.value='';detailError.value=''}
async function readDetail(source='initial'){
 if(!detailTarget.value||detailAction.value)return
 const id=detailTarget.value,n=++detailSequence,own=consumerScope();detailAction.value=source;if(source!=='retry')detailError.value=''
 try{const value=await api<Entry>('/growth-records/'+encodeURIComponent(id));if(!alive||n!==detailSequence)return;if(own!==consumerScope()){unavailable('登录状态已变化，请重新读取记录');return}if(value.id!==id)throw Error('记录内容不匹配');selected.value=value;detailError.value=''}catch(e){if(alive&&n===detailSequence){if(own!==consumerScope())unavailable('登录状态已变化，请重新读取记录');else if([401,403].includes((e as any)?.status))unavailable(message(e),(e as any)?.status===401);else detailError.value=message(e)}}finally{if(alive&&n===detailSequence)detailAction.value=''}
}
function openDetail(item:Entry){closeDetail();if(scope!==consumerScope()){data.value=null;void load();return}detailTarget.value=item.id;if(demo.value)selected.value=item;else void readDetail()}
function retry(){void load('retry',retryPage)}
onLoad(options=>{demo.value=!!isClientPreview&&options?.demo==='1';if(options?.type==='levels')tab.value='levels'})
onShow(()=>void load())
onUnload(()=>{alive=false;sequence++;data.value=null;closeDetail()})
useMaintenanceReload(async()=>{await load('maintenance');if(detailTarget.value)await readDetail('maintenance')},()=>!!action.value||!!detailAction.value)
</script>
<template><page-meta :page-style="clientThemeStyle"/>
 <view class="growth-page">
  <ClientNavigation title="成长记录" back fallback="/pages/levels/index"/>
  <view v-if="isClientPreview" class="preview-mode"><text>{{demo?'演示数据':'当前站点数据'}}</text><button role="button" :loading="action==='mode'" :disabled="!!action" @click="toggleDemo">{{demo?'切换站点数据':'查看演示数据'}}</button></view>
  <view v-if="data&&!guest" class="growth-summary"><view><text class="summary-label">当前成长值</text><text class="summary-number">{{data.growth.toLocaleString()}}</text></view><view class="summary-level"><image :src="asset('crown')" mode="aspectFit"/><text>{{data.current.name}}</text></view></view>
  <view class="record-tabs" role="tablist" aria-label="成长记录类型"><button v-for="item in [{id:'growth',label:'成长明细'},{id:'levels',label:'升级记录'}] as const" :key="item.id" role="tab" :aria-selected="tab===item.id" :aria-busy="action==='tab:'+item.id" :class="{active:tab===item.id}" @click="changeTab(item.id)">{{item.label}}<view v-if="action==='tab:'+item.id" class="tab-loading"/></button></view>
  <scroll-view enhanced class="record-scroll" scroll-y :show-scrollbar="false"><view class="record-body">
   <ClientPageState v-if="guest" title="登录后查看成长记录" description="查看成长明细和会员等级的变化" @action="consumerLogin"/>
   <view v-if="action&&!records.length&&!error" class="record-state" role="status">正在读取记录…</view>
   <template v-if="records.length">
    <view v-for="group in groups" :key="group.month" class="month-group"><view class="month-heading"><text>{{group.month.replace('/',' 年 ')}} 月</text><text>{{group.items.length}} 条</text></view>
     <view class="record-list"><button v-for="item in group.items" :key="item.id" role="button" class="record-row" :aria-label="title(item)+'，查看详情'" @click="openDetail(item)">
      <view class="record-icon"><image :src="asset(tab==='levels'?'crown':item.kind==='purchase_refund'?'rotate-ccw':item.kind==='growth'?'settings':item.kind==='registration'?'gift':'shopping-bag')" mode="aspectFit"/></view>
      <view class="record-copy"><text class="record-title">{{title(item)}}</text><text class="record-time">{{time(item.createdAt)}}</text><text v-if="tab==='levels'&&item.levelBefore" class="level-path">{{item.levelBefore.name}} → {{item.levelAfter?.name}}</text></view>
      <view v-if="tab==='growth'" class="record-value"><text :class="{positive:item.after>item.before}">{{delta(item)}}</text><text class="record-after">变动后 {{item.after.toLocaleString()}}</text></view>
      <view v-else class="level-state">{{item.levelBefore?'已升级':'初始等级'}}<ClientChevron/></view>
     </button></view>
    </view><button v-if="data&&records.length<data.total&&!error" role="button" class="load-more" :loading="action==='more'" :disabled="!!action" @click="load('more',data.page+1)">加载更多</button><view v-else-if="!error" class="list-end">已显示全部记录</view>
   </template>
   <view v-else-if="!guest&&!error&&!action" class="record-state"><image :src="asset(tab==='growth'?'receipt-text':'crown')" mode="aspectFit"/><text>{{tab==='growth'?'暂无成长明细':'暂无升级记录'}}</text><text class="state-hint">{{tab==='growth'?'获得或扣回成长值后，记录会显示在这里':'获得初始等级或升级后，记录会显示在这里'}}</text></view>
   <view v-if="error" class="record-error" role="alert"><text>{{error}}</text><button role="button" :loading="action==='retry'" :aria-disabled="!!action" :disabled="!!action" @click="retry">重新加载</button></view>
  </view></scroll-view>
  <ClientDialog v-if="detailTarget" :title="tab==='growth'?'成长明细':'等级记录'" presentation="sheet" @close="closeDetail">
   <view v-if="detailError" class="record-error" role="alert">{{detailError}}<button role="button" :loading="detailAction==='retry'" :disabled="!!detailAction" @click="readDetail('retry')">重新读取详情</button></view><view v-if="detailAction&&!selected&&!detailError" class="record-state" role="status">正在读取详情…</view>
   <template v-if="selected">
   <view class="detail-heading"><text>{{title(selected)}}</text><view v-if="tab==='growth'" class="detail-number" :class="{positive:selected.after>selected.before}">{{delta(selected)}}<text>成长值</text></view><view v-else class="detail-level">{{selected.levelBefore?selected.levelBefore.name+' → ':''}}{{selected.levelAfter?.name}}</view></view>
   <view class="detail-fields"><view><text>发生时间</text><text>{{date(selected.createdAt)}}</text></view><view v-if="tab==='growth'"><text>变动前成长值</text><text>{{selected.before.toLocaleString()}}</text></view><view v-if="tab==='growth'"><text>变动后成长值</text><text>{{selected.after.toLocaleString()}}</text></view><view v-else><text>变更类型</text><text>{{selected.levelBefore?'等级提升':'获得初始等级'}}</text></view><view><text>记录编号</text><text>{{selected.id}}</text></view><view><text>变更说明</text><text>{{selected.reason}}</text></view></view>
   </template>
   <template #footer><button role="button" class="detail-done" @click="closeDetail">完成</button></template>
  </ClientDialog>
 </view>
</template>
<style scoped>
.growth-page{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:auto;overflow:hidden;background:var(--client-page-background, #f3f9ff);color:var(--client-text,#203450);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.growth-page view,.growth-page button{box-sizing:border-box}.growth-page button{margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:1.5}.growth-page button::after{border:0}.growth-page button[disabled]{opacity:1}.preview-mode{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 18px 8px;color:var(--client-muted,#718198);font-size:11px}.preview-mode button{min-height:30px;color:var(--client-primary,#3479f6);font-size:11px}.growth-summary{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:8px 16px 14px;padding:18px;border:1px solid #e7edf6;border-radius:16px;background:var(--client-surface,#fff)}.growth-summary>view:first-child{display:flex;flex-direction:column;gap:6px}.summary-label{font-size:12px;color:var(--client-muted,#718198)}.summary-number{font-size:30px;font-weight:650;line-height:1.2;color:var(--client-primary-ink,#28558d);font-variant-numeric:tabular-nums}.summary-level{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;background:var(--client-primary-soft,#edf4ff);font-size:12px;color:var(--client-primary-ink,#28558d)}.summary-level image{width:17px;height:17px;opacity:.6}.record-tabs{display:flex;padding:0 16px;gap:8px}.record-tabs button{position:relative;flex:1;height:44px;font-size:14px;color:var(--client-muted,#718198)}.record-tabs button.active{color:var(--client-primary,#3479f6);font-weight:600}.record-tabs button.active::before{content:'';position:absolute;left:50%;bottom:2px;transform:translateX(-50%);width:24px;height:3px;border-radius:2px;background:var(--client-primary,#3479f6)}.record-scroll{flex:1;min-height:0;height:0}.record-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(24px + env(safe-area-inset-bottom))}.month-group+.month-group{margin-top:22px}.month-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:10px 2px;font-size:13px;font-weight:600}.month-heading>text:last-child{font-size:11px;font-weight:400;color:var(--client-muted,#718198)}.record-list{padding:0 14px;border:1px solid #e7edf6;border-radius:16px;background:var(--client-surface,#fff)}.growth-page .record-row{display:flex;align-items:center;gap:12px;width:100%;padding:18px 0;text-align:left}.record-row+.record-row{border-top:1px solid #eef1f6}.record-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:34px;height:34px;border-radius:10px;background:var(--client-primary-soft,#edf4ff)}.record-icon image{width:19px;height:19px;opacity:.7}.record-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:6px}.record-title{font-size:13px;font-weight:500;overflow-wrap:anywhere}.record-time,.level-path{font-size:10px;color:var(--client-muted,#718198)}.record-value{display:flex;align-items:flex-end;flex-shrink:0;flex-direction:column;gap:5px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.record-after{font-size:10px;font-weight:400;color:var(--client-muted,#718198)}.positive{color:var(--client-primary,#3479f6)}.level-state{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--client-muted,#718198)}.list-end{padding-top:22px;text-align:center;font-size:11px;color:var(--client-muted,#718198)}.record-state{display:flex;flex-direction:column;align-items:center;gap:14px;padding:72px 12px;text-align:center;color:var(--client-muted,#718198)}.record-state image{width:46px;height:46px;opacity:.35}.state-hint{font-size:12px;line-height:1.8}.record-error{padding:14px;border-radius:12px;background:#fff0ef;color:#b84039}.record-error button{display:flex;align-items:center;justify-content:center;min-height:36px;margin-top:10px;padding:0 14px;border-radius:8px;background:#ffe5e1}.detail-heading{display:flex;align-items:center;flex-direction:column;gap:14px;padding:8px 0 26px;font-size:14px;text-align:center}.detail-number{display:flex;align-items:baseline;gap:6px;font-size:34px;line-height:1.3;font-weight:650}.detail-number text{font-size:12px;font-weight:400;color:var(--client-muted,#718198)}.detail-level{font-size:20px;font-weight:600;line-height:1.7;color:var(--client-primary,#3479f6);overflow-wrap:anywhere}.detail-fields{display:flex;flex-direction:column;gap:16px;padding-top:18px;border-top:1px solid #eef1f6}.detail-fields>view{display:flex;justify-content:space-between;gap:20px;font-size:12px}.detail-fields>view>text:first-child{flex-shrink:0;color:var(--client-muted,#718198)}.detail-fields>view>text:last-child{min-width:0;text-align:right;overflow-wrap:anywhere}.growth-page .detail-done{display:flex;align-items:center;justify-content:center;width:100%;height:44px;border-radius:12px;background:var(--client-primary,#3479f6);color:#fff;font-size:14px;font-weight:600}@media(max-width:350px){.growth-summary{margin-inline:12px;padding:15px}.record-body{padding-inline:var(--client-page-gutter, 10px)}.record-list{padding-inline:12px}.record-row{gap:9px!important}.record-title{font-size:12px}.record-icon{width:30px;height:30px}}
</style>
<style scoped>.tab-loading{display:inline-block;width:9px;height:9px;margin-left:6px;border:1px solid currentColor;border-top-color:transparent;border-radius:50%;animation:growth-spin .7s linear infinite}.load-more{width:100%;min-height:44px;margin-top:12px!important;color:var(--client-primary)!important}.guest-login{padding:12px 20px!important;color:var(--client-primary)!important}@keyframes growth-spin{to{transform:rotate(360deg)}}</style>
