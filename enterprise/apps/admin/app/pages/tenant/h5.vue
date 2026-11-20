<script setup lang="ts">
import ConsoleAccessLink from '../../components/console/ConsoleAccessLink.vue'
import AccountImageInput from '../../components/console/AccountImageInput.vue'
import AdminConsole from '../../components/console/AdminConsole.vue'
import ConsoleSettingsActions from '../../components/console/ConsoleSettingsActions.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
definePageMeta({layout:'tenant',key:route=>route.path})
type View={applicationKey:string|null;applications:{key:string;name:string}[];canWrite:boolean;version:number;config:{displayName:string;favicon:string|null;customDomain:string};entryUrl:string;previewUrl:string;customUrl:string|null;qrCode:string|null;domainProof:{name:string;value:string;target:string}|null}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/h5',toast=useToast()
const initialApplication=typeof useRoute().query.application==='string'?String(useRoute().query.application):''
const initial=await useAsyncData('tenant-h5:'+auth.session.value?.id+':'+tenantId+':'+initialApplication,(_,{signal})=>auth.api<View>(endpoint+(initialApplication?'?applicationKey='+encodeURIComponent(initialApplication):''),'GET',undefined,{signal}))
const data=ref<View|null>(initial.data.value||null),form=reactive({...data.value?.config||{displayName:'H5端',favicon:null,customDomain:''}}),baseline=ref(JSON.stringify(form)),action=ref(''),uploads=ref(0),copying=ref(''),checking=ref(false),domainResult=ref<{verified:boolean;message:string}|null>(null),error=ref(initial.error.value?.message||'')
const dirty=computed(()=>JSON.stringify(form)!==baseline.value),blocked=computed(()=>!!action.value||checking.value||uploads.value>0),discard=useDiscardChanges(()=>blocked.value),controller=new AbortController();let disposed=false
function fill(v:View){data.value=v;Object.assign(form,v.config);baseline.value=JSON.stringify(form);domainResult.value=null}
function cancel(){if(blocked.value)return;discard.request(()=>{Object.assign(form,JSON.parse(baseline.value));error.value=''})}
async function load(source='refresh',key=data.value?.applicationKey||''){
 if(blocked.value)return;if(dirty.value){discard.request(()=>{Object.assign(form,JSON.parse(baseline.value));void load(source,key)});return}action.value=source;error.value=''
 try{const v=await auth.api<View>(endpoint+(key?'?applicationKey='+encodeURIComponent(key):''),'GET',undefined,{signal:controller.signal});if(!disposed)fill(v)}catch(e:any){if(!disposed)error.value=e.message}finally{if(!disposed)action.value=''}
}
async function save(){if(blocked.value||!data.value?.canWrite||!data.value.applicationKey)return;action.value='save';error.value='';try{const v=await auth.api<View>(endpoint+'/'+encodeURIComponent(data.value.applicationKey),'PUT',{version:data.value.version,config:{displayName:form.displayName.trim(),favicon:form.favicon,customDomain:form.customDomain.trim()}},{signal:controller.signal});if(!disposed){fill(v);toast.add({title:'H5 配置已保存',color:'success'})}}catch(e:any){if(!disposed)error.value=e.message}finally{if(!disposed)action.value=''}}
async function copy(kind:string,value:string){if(copying.value||!value)return;copying.value=kind;try{await navigator.clipboard.writeText(value);if(!disposed)toast.add({title:'已复制',color:'success'})}catch{if(!disposed)toast.add({title:'复制失败，请手动复制',color:'error'})}finally{if(!disposed)copying.value=''}}
async function checkDomain(){if(blocked.value||dirty.value||!data.value?.domainProof||!data.value.applicationKey)return;checking.value=true;domainResult.value=null;try{const result=await auth.api<{verified:boolean;message:string}>(endpoint+'/'+encodeURIComponent(data.value.applicationKey)+'/verify-domain','POST',{}, {signal:controller.signal});if(!disposed)domainResult.value=result}catch(e:any){if(!disposed)domainResult.value={verified:false,message:e.message}}finally{if(!disposed)checking.value=false}}
function unload(e:BeforeUnloadEvent){if(dirty.value||action.value==='save'){e.preventDefault();e.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',unload))
onBeforeRouteLeave(to=>{if(blocked.value)return false;if(dirty.value){discard.request(()=>{Object.assign(form,JSON.parse(baseline.value));void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;controller.abort();window.removeEventListener('beforeunload',unload)})
</script>
<template><AdminConsole :refreshing="action==='refresh'" @refresh="load()"><div class="h5-page"><ConsolePageHeading title="H5端"/>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="action==='retry'" @click="load('retry')">重试</UButton></template></UAlert>
 <USelect v-if="data&&data.applications.length>1" :model-value="data.applicationKey||undefined" :items="data.applications.map(a=>({label:a.name,value:a.key}))" aria-label="所属应用" :disabled="blocked" @update:model-value="load('application',String($event))"/>
 <form v-if="data?.applicationKey" class="h5-form rounded-lg border border-default bg-default" @submit.prevent="save"><div class="h5-settings-fields space-y-7 p-5 sm:p-7"><h2 class="font-semibold">H5 渠道配置</h2>
  <ConsoleSettingsField label="渠道名称" input-id="h5-name"><ConsoleInput id="h5-name" v-model="form.displayName" required :maxlength="64" :disabled="blocked||!data.canWrite"/></ConsoleSettingsField>
  <ConsoleSettingsField label="浏览器图标"><AccountImageInput v-model="form.favicon" label="浏览器图标" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/shared'" fit="contain" :image-size="100" fallback="" :disabled="!!action||checking||!data.canWrite" @busy="uploads+=$event?1:-1"/></ConsoleSettingsField>
  <ConsoleSettingsField label="平台入口"><ConsoleAccessLink :url="data.entryUrl" label="H5 平台入口"/></ConsoleSettingsField>
  <ConsoleSettingsField label="访问二维码"><img v-if="data.qrCode" :src="data.qrCode" alt="H5 访问二维码" width="160" height="160" class="size-40 rounded border border-default bg-white"/></ConsoleSettingsField>
  <section class="space-y-5 border-t border-default pt-6"><h2 class="font-semibold">独立域名</h2><ConsoleSettingsField label="绑定域名" input-id="h5-domain"><ConsoleInput id="h5-domain" v-model="form.customDomain" placeholder="例如 m.example.com" :maxlength="253" :disabled="blocked||!data.canWrite"/><p class="mt-2 text-xs text-muted">只填写域名。保存后添加域名验证记录，并将域名解析到本站服务器，配置 HTTPS 证书。</p></ConsoleSettingsField>
   <template v-if="data.domainProof"><ConsoleSettingsField label="访问地址"><ConsoleAccessLink :url="data.customUrl||''" label="独立域名访问地址"/></ConsoleSettingsField><ConsoleSettingsField label="TXT 主机记录"><div class="h5-address"><ConsoleInput :model-value="data.domainProof.name" readonly/><UButton color="neutral" variant="outline" :loading="copying==='record'" :disabled="!!copying" @click="copy('record',data.domainProof.name)">复制</UButton></div></ConsoleSettingsField><ConsoleSettingsField label="TXT 记录值"><div class="h5-address"><ConsoleInput :model-value="data.domainProof.value" readonly/><UButton color="neutral" variant="outline" :loading="copying==='proof'" :disabled="!!copying" @click="copy('proof',data.domainProof.value)">复制</UButton></div></ConsoleSettingsField><ConsoleSettingsField label="验证归属"><UButton color="neutral" variant="outline" icon="i-lucide-shield-check" :loading="checking" :disabled="blocked||dirty" @click="checkDomain">检查域名</UButton><p v-if="domainResult" class="mt-2 text-sm" :class="domainResult.verified?'text-success':'text-muted'">{{domainResult.message}}</p></ConsoleSettingsField></template>
  </section>
 </div>
 <ConsoleSettingsActions :dirty="dirty" :busy="blocked" :saving="action==='save'" :can-write="data.canWrite" :hint="uploads?'图片处理中…':''" @cancel="cancel"/></form><ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>
.h5-page{display:flex;flex:1;min-height:0;min-width:0;flex-direction:column;gap:20px}.h5-form{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}.h5-form>:last-child{flex-shrink:0}.h5-settings-fields{flex:1;min-width:0;min-height:0;overflow:auto}.h5-address{display:flex;align-items:center;gap:10px;min-width:0}.h5-address>:first-child{flex:1;min-width:0}.h5-address>button,.h5-address>a{flex-shrink:0;white-space:nowrap}
@media(max-width:900px){.h5-page,.h5-form{flex:none;min-height:auto}.h5-settings-fields{overflow:visible}}
@media(max-width:500px){.h5-address{gap:6px}}
</style>
