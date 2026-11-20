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
type Listing={applicationKey:string|null;canWrite:boolean;categories:{id:string;name:string;enabled:boolean}[]}
type Article={title:string;categoryId:string;content:string;sort:number;enabled:boolean;version:number}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,route=useRoute(),toast=useToast(),endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/help',key=String(route.query.applicationKey||''),id=String(route.query.id||'')
if(!/^[A-Za-z0-9_-]{1,64}$/.test(key)||id&&!/^[a-f0-9-]{36}$/i.test(id))throw createError({statusCode:404,statusMessage:'帮助文章不存在'})
async function read(signal:AbortSignal){const listing=await auth.api<Listing>(endpoint+'?applicationKey='+encodeURIComponent(key),'GET',undefined,{signal});const article=id?await auth.api<Article>(endpoint+'/'+key+'/articles/'+id,'GET',undefined,{signal}):null;return{listing,article}}
const initial=await useAsyncData('help-editor:'+auth.session.value?.id+':'+tenantId+':'+key+':'+id,(_nuxt,{signal})=>read(signal))
const data=ref(initial.data.value||null),blank=()=>({title:'',categoryId:'',content:'',sort:0,enabled:true}),form=ref(blank()),baseline=ref(''),version=ref(0),recordId=ref(id),busy=ref(''),imageBusy=ref(false),error=ref(initial.error.value?.message||'')
const dirty=computed(()=>JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!busy.value||imageBusy.value||!data.value?.listing.canWrite),discard=useDiscardChanges(()=>!!busy.value||imageBusy.value),controller=new AbortController();let disposed=false
function fill(value:NonNullable<typeof data.value>){data.value=value;const a=value.article;form.value=a?{title:a.title,categoryId:a.categoryId,content:a.content,sort:a.sort,enabled:a.enabled}:blank();version.value=a?.version||0;baseline.value=JSON.stringify(form.value);discard.keep()}
if(data.value)fill(data.value);else baseline.value=JSON.stringify(form.value)
const back=()=>navigateTo({path:'/admin/help',query:{applicationKey:key}})
function discardForm(){form.value=JSON.parse(baseline.value);discard.keep()}
async function refresh(source='refresh'){if(busy.value||imageBusy.value)return;if(dirty.value){discard.request(()=>{discardForm();void refresh(source)});return}busy.value=source;try{const value=await read(controller.signal);if(!disposed){fill(value);error.value=''}}catch(e:any){if(!disposed)error.value=e.message||'读取失败'}finally{if(!disposed)busy.value=''}}
async function save(){if(locked.value||!dirty.value)return;if(!form.value.categoryId||!form.value.content.trim()){error.value='请选择分类并填写帮助正文';return}if(!recordId.value)recordId.value=crypto.randomUUID();busy.value='save';error.value='';try{await auth.api(endpoint+'/'+key+'/articles/'+recordId.value,'PUT',{...form.value,sort:Number(form.value.sort),version:version.value},{signal:controller.signal});if(!disposed){baseline.value=JSON.stringify(form.value);busy.value='';toast.add({title:'帮助文章已保存',color:'success'});await back()}}catch(e:any){if(!disposed)error.value=e.message||'保存失败，修改已保留'}finally{if(!disposed)busy.value=''}}
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||busy.value||imageBusy.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload))
onBeforeRouteLeave(to=>{if(busy.value||imageBusy.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{discardForm();void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;controller.abort();window.removeEventListener('beforeunload',beforeUnload)})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="refresh()"><div class="space-y-5"><div class="help-heading flex items-center gap-4"><UButton color="neutral" variant="ghost" icon="i-lucide-chevron-left" :disabled="!!busy||imageBusy" @click="back">返回</UButton><ConsolePageHeading title="帮助文章编辑"/></div>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <ConsoleValidatedForm v-if="data" class="surface-card help-form" @submit="save" @invalid="error=$event"><div class="space-y-6 p-5 sm:p-7">
 <ConsoleSettingsField label="文章标题" input-id="help-title"><ConsoleInput id="help-title" v-model="form.title" required :maxlength="120" :disabled="locked" class="max-w-xl"/></ConsoleSettingsField>
 <ConsoleSettingsField label="所属分类"><USelect v-model="form.categoryId" :items="data.listing.categories.map(c=>({label:c.name+(c.enabled?'':'（隐藏）'),value:c.id}))" placeholder="请选择分类" aria-label="所属分类" :disabled="locked" class="w-full max-w-xl"/><p v-if="!data.listing.categories.length" class="mt-2 text-sm text-muted">请先返回帮助中心创建分类。</p></ConsoleSettingsField>
 <ConsoleSettingsField label="排序" input-id="help-sort"><ConsoleInput id="help-sort" v-model="form.sort" type="number" min="0" max="999999" step="1" required :disabled="locked" class="max-w-xs"/><p class="mt-2 text-xs text-muted">数字越大越靠前。</p></ConsoleSettingsField>
 <ConsoleSettingsField label="客户端显示"><USwitch v-model="form.enabled" :disabled="locked" aria-label="文章在客户端显示"/></ConsoleSettingsField>
 <ConsoleSettingsField label="正文"><ConsoleRichTextEditor v-model="form.content" label="帮助正文" :disabled="locked" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/shared'" @busy="imageBusy=$event"/></ConsoleSettingsField>
 </div><div class="sticky bottom-0 z-10 border-t border-default bg-default/95 px-5 py-4 backdrop-blur sm:px-7"><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!busy||imageBusy" @click="back">取消</UButton><UButton v-if="data.listing.canWrite" type="submit" :loading="busy==='save'" :disabled="locked||!dirty">保存</UButton></ConsoleFormActions></div></ConsoleValidatedForm>
 <ConsoleDiscardChangesDialog :controller="discard"/></div></AdminConsole></template>
<style scoped>.help-heading :deep(header.qisvc-console-page-heading){min-height:0;margin:0}.help-form{--settings-label-width:7rem;--settings-content-width:100%}</style>
