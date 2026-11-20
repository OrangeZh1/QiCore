<script setup lang="ts">
import AdminConsole from '../../components/console/AdminConsole.vue'
import ConsoleDrawer from '../../components/console/ConsoleDrawer.vue'
import ConsoleDiscardChangesDialog from '../../components/console/ConsoleDiscardChangesDialog.vue'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
definePageMeta({layout:'tenant',key:route=>route.path})
type Event={key:string;label:string;enabled:boolean;templateId:string;fields:{key:string;source:string}[]}
type View={applicationKey:string|null;applications:{key:string;name:string}[];version:number;appId:string;miniEnabled:boolean;appChanged:boolean;sendEnabled:boolean;selectionEnabled:boolean;selection:{id:string;status:string;rows:{key:string;label?:string;state:string;message:string}[];finishedAt:string|null}|null;canWrite:boolean;fields:{value:string;label:string;type:string}[];events:Event[]}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/subscription-settings',toast=useToast()
const initial=await useAsyncData<View>('subscriptions:'+auth.session.value?.id+':'+tenantId,(_nuxt,{signal})=>auth.api<View>(endpoint,'GET',undefined,{signal}))
const data=ref(initial.data.value??null),error=ref(initial.error.value?.message||''),action=ref<'refresh'|'retry'|'application'|'save'|'select'|'selection-query'|null>(null),form=ref<Event|null>(null),baseline=ref(''),formError=ref(''),open=ref(false)
const dirty=computed(()=>!!form.value&&JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!action.value||!data.value?.canWrite||data.value?.selection?.status==='RUNNING'),discard=useDiscardChanges(()=>!!action.value)
const selectionAttempt=ref<{version:number;requestId:string}|null>(null)
const lifetime=new AbortController();let disposed=false
const columns=[{accessorKey:'label',header:'通知场景'},{accessorKey:'templateId',header:'模板 ID'},{accessorKey:'enabled',header:'状态'},{id:'actions',header:'操作'}]
function edit(row:Event){if(action.value)return;form.value=structuredClone(toRaw(row));baseline.value=JSON.stringify(form.value);formError.value='';open.value=true}
function reset(){open.value=false;form.value=null;baseline.value='';formError.value=''}
function close(){if(action.value)return;if(dirty.value){discard.request(reset);return}reset()}
async function load(source:'refresh'|'retry'|'application'|'selection-query'='refresh',key=data.value?.applicationKey||''){
 if(action.value)return;if(dirty.value){discard.request(()=>{reset();void load(source,key)});return}action.value=source;error.value=''
 try{const value=await auth.api<View>(endpoint+(key?'?applicationKey='+encodeURIComponent(key):''),'GET',undefined,{signal:lifetime.signal});if(!disposed)data.value=value}catch(e:any){if(!disposed)error.value=e.message||'订阅消息配置读取失败'}finally{if(!disposed)action.value=null}
}
async function save(){
 if(locked.value||!dirty.value||!form.value||!data.value?.applicationKey)return;action.value='save';formError.value=''
 const {enabled,templateId,fields,key}=form.value
 try{const value=await auth.api<View>(endpoint+'/'+encodeURIComponent(data.value.applicationKey)+'/'+key,'PUT',{version:data.value.version,config:{enabled,templateId,fields:fields.map(f=>({...f}))}},{signal:lifetime.signal});if(!disposed){data.value=value;reset();toast.add({title:'订阅消息设置已保存',color:'success'})}}catch(e:any){if(!disposed)formError.value=e.message||'保存失败，修改已保留'}finally{if(!disposed)action.value=null}
}
async function autoSelect(){
 if(locked.value||!data.value?.applicationKey||!data.value.selectionEnabled)return;if(dirty.value){discard.request(()=>{reset();void autoSelect()});return}action.value='select';error.value='';selectionAttempt.value??={version:data.value.version,requestId:crypto.randomUUID()}
 try{const value=await auth.api<View>(endpoint+'/'+encodeURIComponent(data.value.applicationKey)+'/select','POST',selectionAttempt.value,{signal:lifetime.signal});if(!disposed){data.value=value;selectionAttempt.value=null}}catch(e:any){if(!disposed)error.value=e.message||'获取结果未确认，请查询获取结果'}finally{if(!disposed)action.value=null}
}
function addField(){if(!locked.value&&form.value&&form.value.fields.length<5)form.value.fields.push({key:'',source:'title'})}
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(action.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{reset();void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;lifetime.abort()})
</script>
<template><AdminConsole :refreshing="action==='refresh'" @refresh="load()"><div class="space-y-5">
 <ConsolePageHeading title="订阅消息"><template #actions><USelect v-if="data&&data.applications.length>1" :model-value="data.applicationKey||''" :items="data.applications.map(a=>({value:a.key,label:a.name}))" aria-label="订阅消息所属应用" :disabled="!!action" @update:model-value="load('application',$event)"/></template></ConsolePageHeading>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="action==='retry'" @click="load('retry')">重试</UButton></template></UAlert>
 <template v-if="data?.applicationKey">
 <div class="flex flex-wrap items-center justify-between gap-3"><span class="text-sm text-muted">通知渠道：微信小程序</span><div class="flex flex-wrap gap-2"><UButton v-if="data.selection||selectionAttempt" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="action==='selection-query'" :disabled="!!action" @click="load('selection-query')">查询获取结果</UButton><UButton v-if="data.canWrite" icon="i-lucide-download" :loading="action==='select'" :disabled="locked||!data.miniEnabled||!data.selectionEnabled" @click="autoSelect">{{selectionAttempt?'继续原获取请求':'自动获取模板'}}</UButton></div></div>
 <p v-if="!data.selectionEnabled" class="text-xs text-muted">微信模板获取未启用，可先手动配置模板。</p>
 <div v-if="data.selection" class="space-y-2"><p v-if="data.selection.status==='RUNNING'" class="text-sm text-muted">正在获取模板，可稍后查询结果。</p><UAlert v-for="row in data.selection.rows" :key="row.key" variant="subtle" :color="['added','reused'].includes(row.state)?'success':'warning'" :title="row.label||'获取结果'" :description="row.message"/></div>
 <UAlert v-if="!data.miniEnabled" color="neutral" variant="subtle" title="请先配置微信小程序"><template #actions><UButton to="/admin/mini-program" color="neutral" variant="outline">前往配置</UButton></template></UAlert>
 <UAlert v-if="data.appChanged" color="warning" title="小程序 AppID 已变化，请重新配置订阅模板"/>
 <ConsoleDataTable :data="data.events" :columns="columns" :pagination="false" :show-sequence="false" min-table-width="600px">
  <template #templateId-cell="{row}"><span class="inline-block max-w-64 truncate align-middle" :title="row.original.templateId">{{row.original.templateId||'尚未配置'}}</span></template>
  <template #enabled-cell="{row}"><UBadge :color="row.original.enabled&&!data.appChanged?'success':'neutral'" variant="subtle">{{row.original.enabled&&!data.appChanged?'已配置':'未配置'}}</UBadge></template>
  <template #actions-cell="{row}"><UButton color="primary" variant="link" :disabled="!!action" @click="edit(row.original)">{{data.canWrite?'设置':'查看'}}</UButton></template>
 </ConsoleDataTable>
 <p v-if="!data.sendEnabled" class="text-xs text-muted">订阅消息发送未启用，待发送任务可在发送记录中查看。</p>
 </template>
 <ConsoleDrawer :open="open" title="订阅消息设置" :description="form?.label||''" :dismissible="!action" @update:open="!$event&&close()"><template #body>
 <form v-if="form" id="subscription-form" class="space-y-6" @submit.prevent="save">
  <section class="space-y-4"><h3 class="drawer-section-title">通知信息</h3><dl class="drawer-facts"><dt>通知名称</dt><dd>{{form.label}}</dd><dt>通知渠道</dt><dd>微信小程序</dd><dt>小程序 AppID</dt><dd class="break-all">{{data?.appId||'尚未配置'}}</dd></dl></section>
  <h3 class="drawer-form-section">订阅消息</h3>
  <ConsoleSettingsField label="模板 ID" input-id="subscription-template"><ConsoleInput id="subscription-template" v-model="form.templateId" :maxlength="128"  :disabled="locked" placeholder="微信公众平台的一次性订阅模板 ID"/></ConsoleSettingsField>
  <section class="space-y-4"><h3 class="drawer-form-section">模板字段</h3><p class="text-xs leading-5 text-muted">按微信模板的实际字段名配置。文本使用 thing，任务短编号使用 character_string，时间使用 time；示例字段名仅供填写参考。</p>
   <div v-for="(field,index) in form.fields" :key="index" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
    <label class="min-w-0 space-y-2 text-xs text-muted"><span>微信字段名</span><ConsoleInput v-model="field.key" :aria-label="'微信字段名 '+(index+1)" :disabled="locked" :maxlength="48" required placeholder="thing1"/></label>
    <label class="min-w-0 space-y-2 text-xs text-muted"><span>业务内容</span><USelect v-model="field.source" :aria-label="'业务内容 '+(index+1)" :items="data?.fields.map(f=>({value:f.value,label:f.label}))||[]" :disabled="locked" class="w-full"/></label>
    <UButton color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="'移除字段 '+(index+1)" :disabled="locked" @click="form.fields.splice(index,1)"/>
   </div><UButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="locked||form.fields.length>=5" @click="addField">添加字段</UButton>
  </section><UAlert v-if="formError" color="error" :title="formError"/>
 </form></template><template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!action" @click="close">取消</UButton><UButton v-if="data?.canWrite" form="subscription-form" type="submit" :loading="action==='save'" :disabled="locked||!dirty">保存设置</UButton></ConsoleFormActions></template></ConsoleDrawer>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
