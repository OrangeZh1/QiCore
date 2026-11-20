<script setup lang="ts">
import ConsoleDrawer from '../console/ConsoleDrawer.vue'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'

const props=defineProps<{
  tenantId:string
  holding?:{id:string;name:string;userId:string;remaining?:number;version?:number}
}>()
const emit=defineEmits<{close:[];saved:[]}>()
const auth=useApi('tenant'),toast=useToast()
const mode=props.holding?'redeem':'grant'
const title=props.holding?'核销权益':'发放权益'
const root='/admin/tenants/'+encodeURIComponent(props.tenantId)
type Choice={id:string;name:string;enabled:boolean;benefits:{count?:number;validDays?:number|null}}
const choices=ref<Choice[]>([]),query=ref(''),listPage=ref(1),listTotal=ref(0),listError=ref('')
const form=reactive({userId:'',packageId:'',count:1 as string|number,reason:''})
const action=ref<'load'|'search'|'page'|'submit'|''>('')
const error=ref('')
type Attempt={endpoint:string;body:Record<string,unknown>}
const attempt=ref<Attempt|null>(null),retryPending=ref(false)
const pendingKey='enterprise-count:'+auth.session.value?.id+':'+props.tenantId+':'+(props.holding?.id||'grant')
const controller=new AbortController()
const locked=computed(()=>action.value==='submit'||!!attempt.value)
const selectedPackage=ref<Choice|null>(null)
const options=computed(()=>choices.value.some(row=>row.id===selectedPackage.value?.id)||!selectedPackage.value?choices.value:[selectedPackage.value,...choices.value])
async function load(source:'load'|'search'|'page',page=1) {
 if(action.value)return
 action.value=source;listError.value=''
 try{
  const params=new URLSearchParams({applicationKey:'system',q:query.value.trim(),status:'enabled',type:'all',page:String(page),pageSize:'50'})
  const result=await auth.api<{items:Choice[];total:number;page:number}>(root+'/packages?'+params,'GET',undefined,{signal:controller.signal})
  choices.value=result.items.filter(row=>row.enabled);listTotal.value=result.total;listPage.value=result.page
 }catch(cause){if(!controller.signal.aborted)listError.value=(cause as Error).message}
 finally{action.value=''}
}
function choose(id:string){form.packageId=id;selectedPackage.value=options.value.find(row=>row.id===id)||null}
function forget(){retryPending.value=false;attempt.value=null;sessionStorage.removeItem(pendingKey)}
async function submit(){
 if(action.value)return
 if(!attempt.value){
  const reason=form.reason.trim()
  if(!reason){error.value='请填写操作原因';return}
  if(mode==='grant'&&(!form.userId.trim()||!form.packageId)){error.value='请输入用户账号并选择套餐';return}
  const count=Number(form.count)
  if(mode==='redeem'&&(!Number.isSafeInteger(count)||count<1||count>(props.holding?.remaining||0))){error.value='核销次数须在可用次数范围内';return}
  const endpoint=root+'/entitlements/system/'+(props.holding?encodeURIComponent(props.holding.id)+'/redeem':'grant')
  const body={reason,requestId:crypto.randomUUID(),...(props.holding?{count,version:props.holding.version}:{packageId:form.packageId,userId:form.userId.trim()})}
  try{sessionStorage.setItem(pendingKey,JSON.stringify({endpoint,body}));attempt.value={endpoint,body}}
  catch{error.value='无法保存本次请求记录，请检查浏览器存储后重试';return}
 }
 const current=attempt.value
 action.value='submit';error.value=''
 try{
  await auth.api(current.endpoint,'POST',current.body,{signal:controller.signal})
  forget();toast.add({title:props.holding?'权益已核销':'权益已发放',color:'success'});emit('saved')
 }catch(cause){
  if(controller.signal.aborted)return
  const e=cause as Error&{status?:number}
  if(e.status&&e.status<500){forget();error.value=e.message}else{retryPending.value=true;error.value='结果待确认，请使用原请求重试。'}
 }finally{action.value=''}
}
onMounted(()=>{
 try{
  const raw=sessionStorage.getItem(pendingKey)
  if(raw){
   const value:Attempt=JSON.parse(raw)
   const expected=root+'/entitlements/system/'+(props.holding?encodeURIComponent(props.holding.id)+'/redeem':'grant')
   if(value.endpoint===expected&&typeof value.body?.requestId==='string'){
    attempt.value=value;retryPending.value=true;Object.assign(form,value.body);error.value='上次操作的结果待确认，可使用原请求重试。'
   }else forget()
  }
 }catch{error.value='无法读取上次请求记录'}
 if(!props.holding)void load('load')
})
onBeforeUnmount(()=>controller.abort())
</script>
<template>
 <ConsoleDrawer :open="true" :title="title" :close="action!=='submit'" :dismissible="action!=='submit'" @update:open="!$event&&action!=='submit'&&emit('close')">
  <template #body><form id="system-count-form" class="space-y-6" @submit.prevent="submit">
   <template v-if="holding">
    <ConsoleSettingsField label="用户账号"><span class="text-sm">{{holding.userId}}</span></ConsoleSettingsField>
    <ConsoleSettingsField label="持有权益"><span class="text-sm">{{holding.name}}</span></ConsoleSettingsField>
    <ConsoleSettingsField label="可用次数"><span class="text-sm tabular-nums">{{holding.remaining}}</span></ConsoleSettingsField>
    <ConsoleSettingsField label="核销次数" input-id="redeem-count"><ConsoleInput id="redeem-count" v-model="form.count" type="number" :min="1" :max="holding.remaining" step="1" required :disabled="locked"/></ConsoleSettingsField>
   </template>
   <template v-else>
    <ConsoleSettingsField label="用户账号" input-id="entitlement-owner"><ConsoleInput id="entitlement-owner" v-model="form.userId" required :maxlength="64" :disabled="locked" placeholder="请输入已有用户的账号"/></ConsoleSettingsField>
    <ConsoleSettingsField label="权益套餐">
      <div class="flex gap-2"><ConsoleInput v-model="query" aria-label="搜索可发放套餐" placeholder="搜索套餐名称" :disabled="locked" @keydown.enter.prevent="load('search')"/><UButton type="button" variant="outline" :loading="action==='search'" :disabled="!!action||locked" @click="load('search')">查询</UButton></div>
      <USelect class="mt-2 w-full" aria-label="可发放套餐" :items="options.map(row=>({label:row.name,value:row.id}))" :model-value="form.packageId||undefined" :loading="action==='load'" :disabled="locked||!!action" placeholder="请选择已启用的套餐" @update:model-value="$event&&choose(String($event))"/>
      <p v-if="selectedPackage" class="mt-2 text-xs text-muted">发放 {{selectedPackage.benefits.count}} 次，{{selectedPackage.benefits.validDays?selectedPackage.benefits.validDays+' 天有效':'长期有效'}}。</p>
      <div v-if="listTotal>50" class="mt-2 flex gap-2"><UButton type="button" size="xs" variant="outline" :disabled="locked||!!action||listPage<=1" @click="load('page',listPage-1)">上一页</UButton><UButton type="button" size="xs" variant="outline" :disabled="locked||!!action||listPage*50>=listTotal" @click="load('page',listPage+1)">下一页</UButton></div>
      <UAlert v-if="listError" class="mt-2" color="error" :title="listError"/>
      <p v-else-if="!action&&!choices.length" class="mt-2 text-xs text-muted">暂无匹配的已启用套餐。</p>
    </ConsoleSettingsField>
   </template>
   <ConsoleSettingsField label="操作原因" input-id="entitlement-reason"><UTextarea id="entitlement-reason" v-model="form.reason" required :maxlength="200" :rows="3" :disabled="locked"/></ConsoleSettingsField>
   <UAlert v-if="error" color="error" :title="error"/>
  </form></template>
  <template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="action==='submit'" @click="emit('close')">关闭</UButton><UButton type="submit" form="system-count-form" :loading="action==='submit'" :disabled="!!action">{{retryPending?'按原请求重试':holding?'确认核销':'确认发放'}}</UButton></ConsoleFormActions></template>
 </ConsoleDrawer>
</template>
