<script setup lang="ts">
import ConsoleDiscardChangesDialog from '~/components/console/ConsoleDiscardChangesDialog.vue'
const discard=useDiscardChanges(()=>!!busy.value||!!uploads.value)
import AdminConsole from '../../components/console/AdminConsole.vue'
import AccountImageInput from '../../components/console/AccountImageInput.vue'
import ConsoleSettingsActions from '../../components/console/ConsoleSettingsActions.vue'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import {dateTime} from '../../utils/update-center'
definePageMeta({layout:'tenant',key:route=>route.path})
type Config={name:string;logo:string|null;favicon:string|null;defaultAvatar:string|null;copyright:string;filing:{icpNumber:string;icpLink:string;policeNumber:string;policeLink:string}}
type View={tenantId:string;version:number;config:Config;canWrite:boolean;inherited:boolean;updatedAt:string|null;fallbackImages:{logo:string;favicon:string;defaultAvatar:string};managed:{name:string;customDomain:string|null;expiresAt:string|null}}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,branding=useSiteBranding(),endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/site-settings',toast=useToast()
const initial=await useAsyncData<View>('tenant-site-settings:'+auth.session.value?.id+':'+tenantId,(_nuxt,{signal})=>auth.api<View>(endpoint,'GET',undefined,{signal}))
const data=ref<View|null>(initial.data.value??null),form=ref<Config|null>(data.value?JSON.parse(JSON.stringify(data.value.config)):null),baseline=ref(JSON.stringify(form.value)),busy=ref<'save'|'refresh'|'retry'|null>(null),uploads=ref(0),error=ref(initial.error.value?.message||'')
const dirty=computed(()=>!!form.value&&JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!busy.value||!data.value?.canWrite)
const images=[{key:'logo',label:'网站 Logo',size:512},{key:'favicon',label:'浏览器图标',size:100},{key:'defaultAvatar',label:'默认头像',size:256}] as const
const lifetime=new AbortController();let disposed=false
function fill(value:View){data.value=value;form.value=JSON.parse(JSON.stringify(value.config));baseline.value=JSON.stringify(form.value);discard.keep()}
function cancel(){if(busy.value||uploads.value)return;form.value=JSON.parse(baseline.value);discard.keep();error.value=''}
async function refresh(source:'refresh'|'retry'='refresh'){
 if(busy.value||uploads.value)return;if(dirty.value){discard.request(()=>{cancel();void refresh(source)});return}busy.value=source;error.value=''
 try{const value=await auth.api<View>(endpoint,'GET',undefined,{signal:lifetime.signal});if(!disposed)fill(value)}catch(e:any){if(!disposed)error.value=e.message||'站点设置读取失败'}finally{if(!disposed)busy.value=null}
}
async function save(){
 if(locked.value||uploads.value||!dirty.value||!data.value||!form.value)return;busy.value='save';error.value=''
 try{const value=await auth.api<View>(endpoint,'PUT',{version:data.value.version,config:JSON.parse(JSON.stringify(form.value))},{signal:lifetime.signal});if(disposed)return;fill(value)
  if(branding.tenantBrand.value?.tenantId===tenantId&&auth.session.value){const own=branding.tenantBrand.value;branding.tenantBrand.value={...own,version:value.version,tenant:{...own.tenant,name:value.config.name,logo:value.config.logo||branding.site.value?.tenant.logo||null,favicon:value.config.favicon||branding.site.value?.tenant.favicon||null,defaultAvatar:value.config.defaultAvatar||branding.site.value?.tenant.defaultAvatar||null},copyright:value.config.copyright,filing:value.config.filing}}
  toast.add({title:'站点设置已保存',color:'success'})
 }catch(e:any){if(!disposed)error.value=e.message||'站点设置保存失败，修改已保留'}finally{if(!disposed)busy.value=null}
}
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(!!busy.value||!!uploads.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{cancel();void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;lifetime.abort();busy.value=null})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="refresh()"><div class="space-y-5">
 <ConsolePageHeading title="站点设置"/>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <form v-if="form&&data" class="tenant-site-settings space-y-5" @submit.prevent="save">
  <section class="surface-card space-y-6 p-5 sm:p-7"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-sm font-semibold">站点信息</h2><span class="text-xs text-muted">{{data.inherited?'当前使用默认配置':'更新于 '+dateTime(data.updatedAt)}}</span></div>
   <ConsoleSettingsField label="显示名称" input-id="tenant-site-name"><ConsoleInput id="tenant-site-name" v-model="form.name" :maxlength="30" required :disabled="locked"/><p class="mt-2 text-xs text-muted">用于本站后台侧栏和浏览器标题，最多 30 字。</p></ConsoleSettingsField>
   <ConsoleSettingsField v-for="image in images" :key="image.key" :label="image.label"><AccountImageInput v-model="form[image.key]" :label="image.label" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/'+encodeURIComponent('shared')" fit="contain" :image-size="image.size" clear-to-fallback :fallback="data.fallbackImages[image.key]" :disabled="locked" @busy="uploads+=$event?1:-1"/><p class="mt-2 text-xs text-muted">移除自定义图片后使用默认图片。</p></ConsoleSettingsField>
  </section>
  <section class="surface-card space-y-6 p-5 sm:p-7"><h2 class="text-sm font-semibold">版权与备案</h2>
   <ConsoleSettingsField label="版权信息" input-id="tenant-site-copyright"><ConsoleInput id="tenant-site-copyright" v-model="form.copyright" :maxlength="160" :disabled="locked" placeholder="留空则不显示版权信息"/></ConsoleSettingsField>
   <ConsoleSettingsField label="ICP备案号" input-id="tenant-site-icp"><ConsoleInput id="tenant-site-icp" v-model="form.filing.icpNumber" :maxlength="80" :disabled="locked"/></ConsoleSettingsField>
   <ConsoleSettingsField label="ICP备案链接" input-id="tenant-site-icp-link"><ConsoleInput id="tenant-site-icp-link" v-model="form.filing.icpLink" type="url" :maxlength="2048" :disabled="locked" placeholder="https://beian.miit.gov.cn"/></ConsoleSettingsField>
   <ConsoleSettingsField label="公安备案号" input-id="tenant-site-police"><ConsoleInput id="tenant-site-police" v-model="form.filing.policeNumber" :maxlength="80" :disabled="locked"/></ConsoleSettingsField>
   <ConsoleSettingsField label="公安备案链接" input-id="tenant-site-police-link"><ConsoleInput id="tenant-site-police-link" v-model="form.filing.policeLink" type="url" :maxlength="2048" :disabled="locked" placeholder="https://www.beian.gov.cn"/></ConsoleSettingsField>
  </section>
  <ConsoleSettingsActions :dirty="dirty" :busy="!!busy||!!uploads" :saving="busy==='save'" :can-write="data.canWrite" :hint="uploads?'图片处理中…':''" @cancel="discard.request(cancel)"/>
 </form>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>.tenant-site-settings{--settings-label-width:8rem;--settings-content-width:28rem}</style>
