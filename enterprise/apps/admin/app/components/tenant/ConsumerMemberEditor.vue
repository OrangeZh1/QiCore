<script setup lang="ts">
import ConsoleDrawer from '../console/ConsoleDrawer.vue'
import ConsumerIdentity from './ConsumerIdentity.vue'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import {dateTime} from '../../utils/update-center'
const props=defineProps<{endpoint:string}>(),emit=defineEmits<{close:[];saved:[]}>(),auth=useApi('tenant'),toast=useToast()
type Level={id:string;name:string;threshold:number}
type View={defaultLevel?:{name:string};userId:string;user:{nickname:string|null;avatar:string|null};version:number;growth:number;level:Level|null;tags:{id:string;name:string}[];levels:Level[];canWrite:boolean;records:{requestId:string;kind:string;before:number;after:number;levelBefore:{name?:string};levelAfter:{name?:string};reason:string;createdAt:string}[];total:number;page:number;pageSize:number}
const data=ref<View|null>(null),options=ref<{levels:Level[];tags:{id:string;name:string}[]}>({levels:[],tags:[]}),action=ref(''),error=ref(''),attempt=ref<Record<string,unknown>|null>(null)
const form=reactive({kind:'level',levelId:'none',direction:'add',amount:'',tagIds:[] as string[],reason:''}),baseline=ref(''),dirty=computed(()=>!!data.value&&JSON.stringify(form)!==baseline.value)
const discard=useDiscardChanges(()=>!!action.value),controller=new AbortController();let disposed=false
const pendingKey='member-change:'+auth.session.value?.id+':'+props.endpoint,locked=computed(()=>!!action.value||!!attempt.value||!data.value?.canWrite)
function persist(){if(attempt.value)sessionStorage.setItem(pendingKey,JSON.stringify(attempt.value));else sessionStorage.removeItem(pendingKey)}
async function load(source='load',page=1){
 if(action.value)return;action.value=source;error.value=''
 try{const value=await auth.api<View&{tagOptions:{id:string;name:string}[]}>(props.endpoint+'?page='+page,'GET',undefined,{signal:controller.signal});if(!disposed){if((source==='previous'||source==='next')&&data.value){data.value={...data.value,records:value.records,total:value.total,page:value.page,pageSize:value.pageSize,canWrite:value.canWrite};return}data.value=value;options.value={levels:value.levels,tags:value.tagOptions};if(source==='load'||source==='retry'){Object.assign(form,{kind:'level',levelId:value.level?.id||'none',direction:'add',amount:'',tagIds:value.tags.map(t=>t.id),reason:''});baseline.value=JSON.stringify(form)}}}catch(e:any){if(!disposed)error.value=e.message}finally{if(!disposed)action.value=''}
}
function close(){if(action.value)return;if(dirty.value||attempt.value)discard.request(()=>emit('close'));else emit('close')}
async function save(source='save'){
 if(action.value||!data.value?.canWrite)return;error.value=''
 if(!attempt.value){
  if(!form.reason.trim()){error.value='请填写操作原因';return}
  const amount=Number(form.amount);if(form.kind==='growth'&&(!/^\d+$/.test(form.amount)||amount<1||amount>2147483647)){error.value='请填写有效的成长值数量';return}
  attempt.value={requestId:crypto.randomUUID(),version:data.value.version,kind:form.kind,reason:form.reason.trim(),...(form.kind==='level'?{levelId:form.levelId==='none'?null:form.levelId}:form.kind==='growth'?{delta:form.direction==='add'?amount:-amount}:form.kind==='tags'?{tagIds:[...form.tagIds]}:{})}
 }
 try{persist()}catch{attempt.value=null;error.value='无法保存操作恢复信息，本次未提交';return}
 action.value=source
 try{await auth.api(props.endpoint,'POST',attempt.value,{signal:controller.signal});if(!disposed){attempt.value=null;persist();emit('saved');toast.add({title:'会员资料已更新',color:'success'});emit('close')}}catch(e:any){if(!disposed){if(e.status&&e.status<500){attempt.value=null;persist()}error.value=e.message||'结果待确认，请查询原操作'}}finally{if(!disposed)action.value=''}
}
function unload(event:BeforeUnloadEvent){if(dirty.value||attempt.value||action.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>{window.addEventListener('beforeunload',unload);try{const saved=sessionStorage.getItem(pendingKey);if(saved)attempt.value=JSON.parse(saved)}catch{error.value='操作恢复信息不可用，请先核对变更记录'}void load()})
onBeforeRouteLeave(to=>{if(action.value)return false;if(dirty.value||attempt.value){discard.request(()=>{emit('close');void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;controller.abort();window.removeEventListener('beforeunload',unload)})
const kindNames:Record<string,string>={purchase:'消费赠送',purchase_refund:'退款扣回',order:'订单升级',registration:'注册赠送',growth:'成长值调整',level:'等级调整',recalculate:'按规则升级',tags:'标签调整'}
</script>
<template><ConsoleDrawer :open="true" title="等级与标签" wide :dismissible="!action" @update:open="!$event&&close()"><template #body>
 <UAlert v-if="error" class="mb-5" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="action==='retry'" @click="load('retry')">重试</UButton></template></UAlert><p v-if="action==='load'" role="status" class="text-sm text-muted">正在读取会员资料…</p>
 <form v-if="data" id="consumer-member-form" class="space-y-6" @submit.prevent="save()"><ConsumerIdentity :user-id="data.userId" :profile="data.user" prominent/><dl class="drawer-facts"><dt>会员等级</dt><dd>{{data.level?.name||'普通会员'}}</dd><dt>成长值</dt><dd>{{data.growth.toLocaleString()}}</dd><dt>会员标签</dt><dd><span v-if="!data.tags.length">—</span><span v-else class="flex flex-wrap gap-2"><UBadge v-for="tag in data.tags" :key="tag.id" color="neutral" variant="subtle">{{tag.name}}</UBadge></span></dd></dl>
 <template v-if="data.canWrite"><ConsoleSettingsField label="操作类型"><USelect v-model="form.kind" :items="[{value:'level',label:'设置等级'},{value:'growth',label:'调整成长值'},{value:'recalculate',label:'按规则升级'},{value:'tags',label:'设置标签'}]" :disabled="locked" class="w-full"/></ConsoleSettingsField>
 <ConsoleSettingsField v-if="form.kind==='level'" label="会员等级"><USelect v-model="form.levelId" :items="[{value:'none',label:data.defaultLevel?.name||'普通会员'},...options.levels.map(l=>({value:l.id,label:l.name}))]" :disabled="locked" class="w-full"/><p class="mt-2 text-xs text-muted">人工设置等级不改变成长值、套餐订阅和积分。</p></ConsoleSettingsField>
 <template v-if="form.kind==='growth'"><ConsoleSettingsField label="调整方式"><URadioGroup v-model="form.direction" orientation="horizontal" :items="[{value:'add',label:'增加'},{value:'deduct',label:'扣除'}]" :disabled="locked"/></ConsoleSettingsField><ConsoleSettingsField label="成长值数量" input-id="member-growth"><ConsoleInput id="member-growth" v-model="form.amount" type="number" min="1" max="2147483647" step="1" required :disabled="locked"/><p class="mt-2 text-xs text-muted">成长值变更时自动判断升级，扣减不自动降级。</p></ConsoleSettingsField></template>
 <p v-if="form.kind==='recalculate'" class="text-sm text-muted">按当前成长值、有效消费和最新等级条件升级至符合的最高等级，不会降低已有等级。</p>
 <ConsoleSettingsField v-if="form.kind==='tags'" label="会员标签"><USelect v-model="form.tagIds" multiple :items="options.tags.map(t=>({value:t.id,label:t.name}))" :disabled="locked" placeholder="选择标签，可多选" class="w-full"/><p class="mt-2 text-xs text-muted">最多选择 20 个标签，清空后保存可移除全部标签。</p></ConsoleSettingsField>
 <ConsoleSettingsField label="操作原因" input-id="member-reason"><UTextarea id="member-reason" v-model="form.reason" required :maxlength="200" :rows="2" :disabled="locked" class="w-full"/></ConsoleSettingsField></template>
 <UAlert v-if="attempt&&!action" color="warning" title="上次操作结果待确认，请查询原操作"/>
 <section class="space-y-4 border-t border-default pt-5"><h3 class="drawer-section-title">变更记录</h3><p v-if="!data.records.length" class="text-sm text-muted">暂无变更记录</p><div v-for="record in data.records" :key="record.requestId" class="space-y-1 border-b border-default pb-3 text-sm"><div class="flex flex-wrap justify-between gap-2"><strong>{{kindNames[record.kind]||record.kind}}</strong><time class="text-xs text-muted">{{dateTime(record.createdAt)}}</time></div><p v-if="record.before!==record.after" class="tabular-nums">成长值 {{record.before}} → {{record.after}}</p><p v-if="record.levelBefore.name!==record.levelAfter.name">等级 {{record.levelBefore.name||'普通会员'}} → {{record.levelAfter.name||'普通会员'}}</p><p class="break-words text-muted">{{record.reason}}</p></div><div v-if="data.total>data.pageSize" class="flex items-center justify-end gap-3"><UButton color="neutral" variant="outline" :disabled="!!action||data.page===1" :loading="action==='previous'" @click="load('previous',data.page-1)">上一页</UButton><span class="text-xs">{{data.page}} / {{Math.ceil(data.total/data.pageSize)}}</span><UButton color="neutral" variant="outline" :disabled="!!action||data.page*data.pageSize>=data.total" :loading="action==='next'" @click="load('next',data.page+1)">下一页</UButton></div></section>
 </form></template><template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!action" @click="close">关闭</UButton><UButton v-if="attempt" :loading="action==='query'" :disabled="!!action||!data?.canWrite" @click="save('query')">查询原操作</UButton><UButton v-else-if="data?.canWrite" form="consumer-member-form" type="submit" :loading="action==='save'" :disabled="!!action||!dirty">保存</UButton></ConsoleFormActions></template></ConsoleDrawer><ConsoleDiscardChangesDialog :controller="discard"/></template>
