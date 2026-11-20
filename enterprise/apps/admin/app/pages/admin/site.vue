<script setup lang="ts">
import ConsoleDiscardChangesDialog from '~/components/console/ConsoleDiscardChangesDialog.vue'
const discard=useDiscardChanges(()=>!!busy.value||!!uploads.value)
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleSettingsActions from '../../components/console/ConsoleSettingsActions.vue'
import AdminConsole from '../../components/console/AdminConsole.vue'
import SiteImageInput from '../../components/console/SiteImageInput.vue'
import type {SiteBranding} from '../../composables/useSiteBranding'
definePageMeta({layout:'admin'})
const auth=useApi(),branding=useSiteBranding(),toast=useToast(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('settings.read'))throw createError({statusCode:403,statusMessage:'没有网站设置访问权限'})
const initial=await useAsyncData('platform-site',()=>auth.api<SiteBranding>('/admin/site'))
const form=ref<SiteBranding|null>(initial.data.value?structuredClone(toRaw(initial.data.value)):null),baseline=ref(JSON.stringify(form.value)),busy=ref<'save'|'refresh'|null>(null),uploads=ref(0),error=ref(initial.error.value?'网站设置读取失败，请刷新重试':'')
const canWrite=!!session?.permissions.includes('settings.write'),dirty=computed(()=>JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!busy.value||!canWrite)
const platformImages=[{key:'favicon',label:'网站图标',kind:'icon'},{key:'logo',label:'网站 Logo',kind:'logo'},{key:'loginImage',label:'登录页配图',kind:'login'},{key:'defaultAvatar',label:'默认头像',kind:'avatar'}] as const
const tenantImages=[{key:'favicon',label:'网站图标',kind:'icon'},{key:'logo',label:'网站 Logo',kind:'logo'},{key:'loginImage',label:'登录页配图',kind:'login'},{key:'defaultAvatar',label:'默认头像',kind:'avatar'}] as const
function fill(value:SiteBranding){form.value=structuredClone(toRaw(value));baseline.value=JSON.stringify(form.value)}
function cancel(){if(busy.value||uploads.value)return;form.value=JSON.parse(baseline.value);error.value='';discard.keep()}
async function refresh(){if(busy.value||uploads.value)return;if(dirty.value){discard.request(()=>{cancel();void refresh()});return}busy.value='refresh';error.value='';try{fill(await auth.api<SiteBranding>('/admin/site'))}catch(e){error.value=e instanceof Error?e.message:'读取失败'}finally{busy.value=null}}
async function save(){if(busy.value||uploads.value||!form.value||!canWrite)return;busy.value='save';error.value='';try{const saved=await auth.api<SiteBranding>('/admin/site','PUT',form.value);fill(saved);branding.site.value=saved;toast.add({title:'网站设置已保存',color:'success'})}catch(e){error.value=e instanceof Error?e.message:'保存失败'}finally{busy.value=null}}
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(!!busy.value||!!uploads.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{cancel();void navigateTo(to.fullPath)});return false}})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="refresh"><div class="space-y-5">
  <ConsolePageHeading title="网站设置"/>
  <UAlert v-if="error" color="error" :title="error"/>
  <form v-if="form" class="site-settings space-y-5" @submit.prevent="save">
    <section class="surface-card space-y-6 p-5 sm:p-7"><h2 class="text-sm font-semibold">站点信息</h2>
      <ConsoleSettingsField label="平台名称" input-id="platform-name"><ConsoleInput id="platform-name" v-model="form.platform.name" required :maxlength="30" :disabled="locked"/><p class="mt-1 text-xs text-muted">用于平台侧栏与浏览器标题，最多 30 个字符。</p></ConsoleSettingsField>
      <ConsoleSettingsField v-for="item in platformImages" :key="item.key" :label="item.label"><SiteImageInput v-model="form.platform[item.key]" :label="'平台'+item.label" :kind="item.kind" :fallback="item.kind==='login'?null:item.kind==='avatar'?'/brand/admin-avatar.png':'/brand/qicore.png'" :disabled="locked" @busy="uploads+=$event?1:-1"/></ConsoleSettingsField>
      <ConsoleSettingsField label="登录页标题" input-id="platform-login-title"><UTextarea id="platform-login-title" v-model="form.platform.loginTitle" :rows="2" :maxlength="200" :disabled="locked" class="w-full"/></ConsoleSettingsField>
      <ConsoleSettingsField label="登录页描述" input-id="platform-login-description"><UTextarea id="platform-login-description" v-model="form.platform.loginDescription" :rows="2" :maxlength="200" :disabled="locked" class="w-full"/></ConsoleSettingsField>
      <ConsoleSettingsField label="版权信息" input-id="site-copyright"><ConsoleInput id="site-copyright" v-model="form.copyright" :maxlength="160" :disabled="locked" placeholder="请输入版权信息"/></ConsoleSettingsField>
    </section>
    <section class="surface-card space-y-6 p-5 sm:p-7"><h2 class="text-sm font-semibold">租户后台信息</h2>
      <ConsoleSettingsField label="网站名称" input-id="tenant-name"><ConsoleInput id="tenant-name" v-model="form.tenant.name" required :maxlength="30" :disabled="locked"/></ConsoleSettingsField>
      <ConsoleSettingsField v-for="item in tenantImages" :key="item.key" :label="item.label"><SiteImageInput v-model="form.tenant[item.key]" :label="'租户'+item.label" :kind="item.kind" :fallback="item.kind==='login'?null:item.kind==='avatar'?'/brand/admin-avatar.png':'/brand/qicore.png'" :disabled="locked" @busy="uploads+=$event?1:-1"/></ConsoleSettingsField>
      <ConsoleSettingsField label="登录页标题" input-id="tenant-login-title"><UTextarea id="tenant-login-title" v-model="form.tenant.loginTitle" :rows="2" :maxlength="200" :disabled="locked" class="w-full"/></ConsoleSettingsField>
      <ConsoleSettingsField label="登录页描述" input-id="tenant-login-description"><UTextarea id="tenant-login-description" v-model="form.tenant.loginDescription" :rows="2" :maxlength="200" :disabled="locked" class="w-full"/></ConsoleSettingsField>
    </section>
    <section class="surface-card space-y-6 p-5 sm:p-7"><h2 class="text-sm font-semibold">网站备案</h2>
      <ConsoleSettingsField label="ICP备案号" input-id="icp-number"><ConsoleInput id="icp-number" v-model="form.filing.icpNumber" :maxlength="80" :disabled="locked" placeholder="请输入 ICP 备案号"/></ConsoleSettingsField>
      <ConsoleSettingsField label="ICP备案链接" input-id="icp-link"><ConsoleInput id="icp-link" v-model="form.filing.icpLink" type="url" :maxlength="2048" :disabled="locked" placeholder="https://beian.miit.gov.cn"/></ConsoleSettingsField>
      <ConsoleSettingsField label="公安备案号" input-id="police-number"><ConsoleInput id="police-number" v-model="form.filing.policeNumber" :maxlength="80" :disabled="locked" placeholder="请输入公安备案号"/></ConsoleSettingsField>
      <ConsoleSettingsField label="公安备案链接" input-id="police-link"><ConsoleInput id="police-link" v-model="form.filing.policeLink" type="url" :maxlength="2048" :disabled="locked" placeholder="https://www.beian.gov.cn"/></ConsoleSettingsField>
    </section>
    <ConsoleSettingsActions :dirty="dirty" :busy="!!busy||!!uploads" :saving="busy==='save'" :can-write="canWrite" :hint="uploads?'图片上传中…':''" @cancel="discard.request(cancel)"/>
  </form>
  <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>.site-settings{--settings-label-width:8rem;--settings-content-width:28rem}</style>
