<script setup lang="ts">
import ConsoleDrawer from '../console/ConsoleDrawer.vue'
import ConsoleDiscardChangesDialog from '../console/ConsoleDiscardChangesDialog.vue'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsumerIdentity from './ConsumerIdentity.vue'
import {dateTime} from '../../utils/update-center'
const props=defineProps<{endpoint:string;kind:'points.add'|'membership.set'}>(),emit=defineEmits<{close:[];saved:[assets:any];busy:[value:boolean];reading:[value:boolean]}>(),auth=useApi('tenant'),toast=useToast()
type Assets={points:number;memberPoints:number;version:string;membership:{active:boolean;expiresAt:string|null};userId:string;user:{id:string;nickname:string|null;avatar:string|null}}
const data=ref<Assets|null>(null),action=ref<'load'|'retry'|'save'|'query'|null>(null),error=ref(''),form=reactive({direction:'increase',amount:'',enabled:true,expiresAt:'',reason:''}),baseline=ref(''),attempt=ref<Record<string,unknown>|null>(null)
const dirty=computed(()=>!!data.value&&JSON.stringify(form)!==baseline.value),discard=useDiscardChanges(()=>!!action.value),controller=new AbortController();let disposed=false
const pendingKey='consumer-asset:'+auth.session.value?.id+':'+props.endpoint+':'+props.kind
function persistAttempt(){if(attempt.value)sessionStorage.setItem(pendingKey,JSON.stringify(attempt.value));else sessionStorage.removeItem(pendingKey)}
const member=props.kind==='membership.set',locked=computed(()=>!!action.value||!!attempt.value)
const localDate=(value:string|null)=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19):''
async function load(source:'load'|'retry'='load'){if(action.value)return;action.value=source;emit('busy',true);emit('reading',true);error.value='';try{const value=await auth.api<Assets>(props.endpoint,'GET',undefined,{signal:controller.signal});if(!disposed){data.value=value;Object.assign(form,{direction:'increase',amount:member?String(value.memberPoints):'',enabled:member?value.membership.active:true,expiresAt:member?localDate(value.membership.expiresAt):'',reason:''});baseline.value=JSON.stringify(form);if(attempt.value){form.direction=attempt.value.kind==='points.deduct'?'decrease':'increase';form.amount=String(attempt.value.amount);form.reason=String(attempt.value.reason);form.enabled=attempt.value.enabled!==false;form.expiresAt=localDate(attempt.value.expiresAt as string|null)}}}catch(e:any){if(!disposed)error.value=e.message||'积分与会员读取失败'}finally{if(!disposed){action.value=null;emit('busy',false);emit('reading',false)}}}
function close(){if(action.value)return;if(dirty.value||attempt.value){discard.request(()=>emit('close'));return}emit('close')}
async function save(source:'save'|'query'='save'){
 if(action.value||!data.value)return;error.value=''
 if(!attempt.value){const amount=Number(form.amount);if(!Number.isInteger(amount)||amount<(member?0:1)||amount>1000000||!form.reason.trim()){error.value='请填写有效的积分数量和操作原因';return}if(!member&&form.direction==='decrease'&&amount>data.value.points){error.value='扣除数量不能超过可用普通积分';return}const expiryValue=member?!form.enabled?'':form.expiresAt:form.direction==='decrease'?'':form.expiresAt;if(expiryValue&&!Number.isFinite(Date.parse(expiryValue+'+08:00'))){error.value='到期时间格式无效';return}const expiresAt=expiryValue?new Date(expiryValue+'+08:00').toISOString():null;if(expiresAt&&Date.parse(expiresAt)<=Date.now()){error.value='到期时间须晚于当前时间';return}attempt.value={requestId:crypto.randomUUID(),version:data.value.version,kind:member?'membership.set':form.direction==='increase'?'points.add':'points.deduct',amount:member&&!form.enabled?0:amount,expiresAt:member&&!form.enabled?null:expiresAt,reason:form.reason.trim(),...(member?{enabled:form.enabled}:{})}}
 try{persistAttempt()}catch{error.value='无法保存操作恢复信息，本次未提交，请检查浏览器存储';attempt.value=null;return}
 action.value=source;emit('busy',true)
 try{const result=await auth.api<{assets:Assets}>(props.endpoint,'POST',attempt.value,{signal:controller.signal});if(!disposed){attempt.value=null;persistAttempt();emit('saved',result.assets);toast.add({title:member?'订阅设置已保存':'积分已调整',color:'success'});emit('close')}}catch(e:any){if(!disposed){if(e.status&&e.status<500){attempt.value=null;persistAttempt()}error.value=e.message||'结果未确认，请查询原操作，避免重复调整'}}finally{if(!disposed){action.value=null;emit('busy',false)}}
}
onMounted(()=>{try{const saved=sessionStorage.getItem(pendingKey);if(saved)attempt.value=JSON.parse(saved)}catch{}void load()})
onBeforeRouteLeave(to=>{if(action.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value||attempt.value){discard.request(()=>{emit('close');void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;controller.abort();emit('busy',false)})
</script>
<template><ConsoleDrawer :open="true" :title="member?'设置订阅':'调整积分'" :dismissible="!action" @update:open="!$event&&close()"><template #body>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="action==='retry'" @click="load('retry')">重试</UButton></template></UAlert>
 <p v-if="action==='load'" role="status" class="text-sm text-muted">正在读取积分和会员…</p>
 <form v-if="data" id="consumer-asset-form" class="space-y-6" @submit.prevent="save()">
  <ConsumerIdentity :user-id="data.userId" :profile="data.user" prominent/>
  <dl class="drawer-facts"><dt>普通积分</dt><dd>{{data.points.toLocaleString()}}</dd><dt>订阅剩余额度</dt><dd>{{data.memberPoints.toLocaleString()}}</dd><dt>订阅到期</dt><dd>{{data.membership.active?(data.membership.expiresAt?dateTime(data.membership.expiresAt):'长期有效'):'—'}}</dd></dl>
  <ConsoleSettingsField v-if="!member" label="调整方式"><URadioGroup v-model="form.direction" orientation="horizontal" :items="[{value:'increase',label:'增加'},{value:'decrease',label:'扣除'}]" :disabled="locked"/></ConsoleSettingsField>
  <ConsoleSettingsField v-if="member" label="订阅状态"><USwitch v-model="form.enabled" :label="form.enabled?'已订阅':'未订阅'" :disabled="locked"/></ConsoleSettingsField>
  <ConsoleSettingsField v-if="!member||form.enabled" :label="member?'订阅剩余额度':form.direction==='increase'?'增加积分':'扣除积分'" input-id="asset-amount"><ConsoleInput id="asset-amount" v-model="form.amount" type="number" :min="member?0:1" :max="1000000" :step="1" :disabled="locked" required/></ConsoleSettingsField>
  <ConsoleSettingsField v-if="member?form.enabled:form.direction==='increase'" :label="member?'订阅到期':'积分到期'" input-id="asset-expiry"><ConsoleInput id="asset-expiry" v-model="form.expiresAt" type="datetime-local" :step="1" :disabled="locked"/><p class="mt-2 text-xs text-muted">{{member?'留空表示长期有效。按本次设置更新订阅额度，普通积分不变。':'留空表示长期有效。'}}</p></ConsoleSettingsField>
  <p v-if="member&&!form.enabled" class="text-sm text-muted">保存后停止当前订阅并清零订阅剩余额度，普通积分保留。</p>
  <ConsoleSettingsField label="操作原因" input-id="asset-reason"><UTextarea id="asset-reason" v-model="form.reason" :rows="3" :maxlength="200" required class="w-full" :disabled="locked" placeholder="请输入原因，将保存在积分流水中"/></ConsoleSettingsField>
  <UAlert v-if="attempt&&!action" color="warning" variant="subtle" title="上次操作结果待确认，请查询原操作"/>
 </form></template><template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!action" @click="close">取消</UButton><UButton v-if="attempt&&(action===null||action==='query')" :loading="action==='query'" :disabled="!!action" @click="save('query')">查询原操作</UButton><UButton v-else form="consumer-asset-form" type="submit" :loading="action==='save'" :disabled="!!action||!data||!dirty">{{member?'保存设置':'确认调整'}}</UButton></ConsoleFormActions></template></ConsoleDrawer><ConsoleDiscardChangesDialog :controller="discard"/></template>
