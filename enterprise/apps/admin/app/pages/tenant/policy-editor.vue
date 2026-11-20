<script setup lang="ts">
import AdminConsole from '~/components/console/AdminConsole.vue'
import ConsoleValidatedForm from '~/components/console/ConsoleValidatedForm.vue'
import {defineConsoleAsyncComponent} from '../../utils/async-component'
const ConsoleRichTextEditor=defineConsoleAsyncComponent(()=>import('../../components/console/ConsoleRichTextEditor.vue'),'富文本编辑器')
import ConsoleDiscardChangesDialog from '~/components/console/ConsoleDiscardChangesDialog.vue'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
definePageMeta({layout:'tenant',key:route=>route.fullPath})
type View={applicationKey:string|null;canWrite:boolean;kind:'terms'|'privacy';version:number;title:string;content:string;contentHtml:string}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,route=useRoute(),toast=useToast(),endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/policies'
const kind=String(route.query.kind||'terms'),key=typeof route.query.applicationKey==='string'?route.query.applicationKey:''
if(!['terms','privacy'].includes(kind))throw createError({statusCode:404,statusMessage:'协议不存在'})
const query=new URLSearchParams({kind,...(key?{applicationKey:key}:{})})
const initial=await useAsyncData<View>('policy-editor:'+auth.session.value?.id+':'+tenantId+':'+query,(_nuxt,{signal})=>auth.api<View>(endpoint+'?'+query,'GET',undefined,{signal}))
const data=ref(initial.data.value||null),form=ref({title:data.value?.title||'',content:data.value?.content||''}),baseline=ref(JSON.stringify(form.value)),busy=ref<'save'|'refresh'|'retry'|null>(null),error=ref(initial.error.value?.message||'')
const imageBusy=ref(false)
const editorHtml=ref(data.value?.contentHtml||''),originalHtml=ref(data.value?.contentHtml||''),dirty=computed(()=>JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!busy.value||imageBusy.value||!data.value?.canWrite),discard=useDiscardChanges(()=>!!busy.value||imageBusy.value)
const controller=new AbortController();let disposed=false
const back=()=>navigateTo({path:'/admin/policies',query:data.value?.applicationKey?{applicationKey:data.value.applicationKey}:{}})
function fill(value:View){data.value=value;form.value={title:value.title,content:value.content};baseline.value=JSON.stringify(form.value);originalHtml.value=value.contentHtml;editorHtml.value=value.contentHtml;discard.keep()}
function cancel(){if(busy.value||imageBusy.value)return;form.value=JSON.parse(baseline.value);editorHtml.value=originalHtml.value;discard.keep();error.value=''}
async function refresh(source:'refresh'|'retry'='refresh'){if(busy.value)return;if(dirty.value){discard.request(()=>{cancel();void refresh(source)});return}busy.value=source;error.value='';try{const value=await auth.api<View>(endpoint+'?'+query,'GET',undefined,{signal:controller.signal});if(!disposed)fill(value)}catch(e:any){if(!disposed)error.value=e.message||'协议读取失败'}finally{if(!disposed)busy.value=null}}
async function save(){if(locked.value||!dirty.value||!data.value?.applicationKey)return;if(!form.value.content.trim()){error.value='请输入协议正文';return}busy.value='save';error.value='';try{const value=await auth.api<View>(endpoint+'/'+encodeURIComponent(data.value.applicationKey)+'/'+kind,'PUT',{version:data.value.version,...form.value},{signal:controller.signal});if(!disposed){fill(value);busy.value=null;toast.add({title:'协议已保存',color:'success'});await back()}}catch(e:any){if(!disposed)error.value=e.message||'保存失败，修改已保留'}finally{if(!disposed)busy.value=null}}
watch(editorHtml,value=>{form.value.content=value===originalHtml.value?(data.value?.content||''):value})
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(busy.value||imageBusy.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{cancel();void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;controller.abort();busy.value=null;})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="refresh()"><div class="space-y-5"><div class="policy-heading flex items-center gap-4"><UButton type="button" color="neutral" variant="ghost" icon="i-lucide-chevron-left" :disabled="!!busy||imageBusy" @click="back">返回</UButton><ConsolePageHeading title="协议编辑"/></div>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <ConsoleValidatedForm v-if="data?.applicationKey" class="policy-form surface-card" @submit="save" @invalid="error=$event"><div class="space-y-6 p-5 sm:p-7"><ConsoleSettingsField label="协议类型"><p class="text-sm">{{kind==='terms'?'用户协议':'隐私政策'}}</p></ConsoleSettingsField><ConsoleSettingsField label="协议标题" input-id="policy-title"><ConsoleInput id="policy-title" v-model="form.title" class="max-w-xl" required :maxlength="80" :disabled="locked"/></ConsoleSettingsField><ConsoleSettingsField label="正文"><ConsoleRichTextEditor v-model="editorHtml" @busy="imageBusy=$event" :disabled="locked" :maxlength="30000" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/shared'"/></ConsoleSettingsField></div>
 <div class="sticky bottom-0 z-10 border-t border-default bg-default/95 px-5 py-4 backdrop-blur sm:px-7"><ConsoleFormActions><UButton type="button" color="neutral" variant="outline" :disabled="!!busy" @click="back">取消</UButton><UButton v-if="data.canWrite" type="submit" :loading="busy==='save'" :disabled="locked||!dirty">保存</UButton></ConsoleFormActions></div></ConsoleValidatedForm>
 <ConsoleDiscardChangesDialog :controller="discard"/></div></AdminConsole></template>
<style scoped>.policy-heading :deep(header.qisvc-console-page-heading){min-height:0;margin:0}.policy-form{--settings-label-width:7rem;--settings-content-width:100%}</style>
