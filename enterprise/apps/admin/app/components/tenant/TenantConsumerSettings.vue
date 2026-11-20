<script setup lang="ts">
import ConsoleValidatedForm from '../console/ConsoleValidatedForm.vue'
import {customerServiceDefaults} from '../../../../api/src/core/customer-service.mjs'
import type {CustomerServiceConfig} from '../../../../api/src/core/decoration-types'
import {consumerAuthAppearanceDefaults} from '../../../../api/src/core/consumer-auth-appearance.mjs'
import AdminConsole from '../console/AdminConsole.vue'
import AccountImageInput from '../console/AccountImageInput.vue'
import ConsumerLoginPreview from './ConsumerLoginPreview.vue'
import PhonePreviewFrame from '../console/PhonePreviewFrame.vue'
import ConsoleDiscardChangesDialog from '../console/ConsoleDiscardChangesDialog.vue'
import ConsoleSettingsActions from '../console/ConsoleSettingsActions.vue'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'

const props=defineProps<{section:'users'|'registration'|'appearance'|'customerService'}>()
const {site,resolvedSite}=useSiteBranding()
const previewMode=ref<'login'|'register'|'reset'>('login')
type AuthAppearance={image:string|null;brand:string;loginTitle:string;loginDescription:string;registerTitle:string;registerDescription:string}
const authDefaults=consumerAuthAppearanceDefaults()
type Config={customerService:CustomerServiceConfig;users:{prefix:string;digits:number;start:number;defaultAvatar:string|null};registration:{passwordLoginEnabled:boolean;smsLoginEnabled:boolean;showPolicies:false;autoRegister:boolean;appearance:AuthAppearance}}
type View={siteName?:string;applicationKey:string|null;applications:{key:string;name:string}[];canWrite:boolean;version:number;config:Config|null;nextNumber:number|null}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,toast=useToast(),endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/consumer-settings'
const title=props.section==='customerService'?'客服设置':props.section==='appearance'?'登录页设置':props.section==='users'?'用户设置':'用户注册'
function copyConfig(config:Config){const value=structuredClone(toRaw(config));value.registration.appearance={...authDefaults,...value.registration.appearance};value.customerService={...customerServiceDefaults(),...value.customerService};return value}
const initial=await useAsyncData<View>('consumer-settings:'+props.section+':'+auth.session.value?.id+':'+tenantId,(_nuxt,{signal})=>auth.api<View>(endpoint,'GET',undefined,{signal}))
const data=ref<View|null>(initial.data.value??null),form=ref<Config|null>(data.value?.config?copyConfig(data.value.config):null),baseline=ref(JSON.stringify(form.value)),applicationKey=ref(data.value?.applicationKey||''),busy=ref<'refresh'|'save'|'retry'|'switch'|null>(null),uploads=ref(0),error=ref(initial.error.value?.message||'')
const dirty=computed(()=>!!form.value&&JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!busy.value||uploads.value>0||!data.value?.canWrite)
const discard=useDiscardChanges(()=>!!busy.value||uploads.value>0),lifetime=new AbortController();let disposed=false
const preview=computed(()=>form.value?form.value.users.prefix+String(Math.max(data.value?.nextNumber||1,Number(form.value.users.start)||1)).padStart(Math.min(12,Math.max(4,Number(form.value.users.digits)||4)),'0'):'')
function fill(value:View){data.value=value;applicationKey.value=value.applicationKey||'';form.value=value.config?copyConfig(value.config):null;baseline.value=JSON.stringify(form.value);discard.keep()}
function cancel(){if(busy.value||uploads.value)return;form.value=JSON.parse(baseline.value);discard.keep();error.value=''}
async function refresh(source:'refresh'|'retry'|'switch'='refresh',key=applicationKey.value){
 if(busy.value||uploads.value)return;if(dirty.value){discard.request(()=>{cancel();void refresh(source,key)});return}busy.value=source;error.value=''
 try{const value=await auth.api<View>(endpoint+(key?'?applicationKey='+encodeURIComponent(key):''),'GET',undefined,{signal:lifetime.signal});if(!disposed)fill(value)}catch(e:any){if(!disposed)error.value=e.message||'设置读取失败'}finally{if(!disposed)busy.value=null}
}
async function save(){
 if(locked.value||!dirty.value||!data.value||!form.value||!applicationKey.value)return;busy.value='save';error.value=''
 try{const value=await auth.api<View>(endpoint+'/'+encodeURIComponent(applicationKey.value)+'/'+props.section,'PUT',{version:data.value.version,config:structuredClone(toRaw(props.section==='appearance'?form.value.registration.appearance:form.value[props.section]))},{signal:lifetime.signal});if(!disposed){fill(value);toast.add({title:title+'已保存',color:'success'})}}catch(e:any){if(!disposed)error.value=e.message||'保存失败，修改已保留'}finally{if(!disposed)busy.value=null}
}
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(busy.value||uploads.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{cancel();void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;lifetime.abort();busy.value=null})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="refresh()"><div :class="section==='appearance'?'login-design-page':'space-y-5'">
 <ConsolePageHeading :title="title"/>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <USelect v-if="data&&data.applications.length>1" :model-value="applicationKey" :items="data.applications.map(app=>({label:app.name,value:app.key}))" :disabled="!!busy||!!uploads" :loading="busy==='switch'" aria-label="设置所属应用" placeholder="选择应用" @update:model-value="refresh('switch',String($event))"/>
 <ConsoleValidatedForm v-if="form&&data" class="consumer-settings surface-card" :class="{'login-design-form':section==='appearance'}" @submit="save" @invalid="error=$event">
  <div v-if="section==='customerService'" class="space-y-6 p-5 sm:p-7">
   <ConsoleSettingsField label="微信官方客服"><USwitch :model-value="form.customerService.miniMode==='official'" :disabled="locked" aria-label="使用微信官方小程序客服" @update:model-value="form.customerService.miniMode=$event?'official':'page'"/><p class="mt-2 text-xs text-muted">开启后，小程序入口直接打开微信客服；关闭时打开内置联系页面。H5 端始终显示下方配置。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="客服头像"><AccountImageInput v-model="form.customerService.avatar" label="客服头像" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/'+encodeURIComponent(applicationKey)" :image-size="256" fallback="" :disabled="locked" @busy="uploads+=$event?1:-1"/></ConsoleSettingsField>
   <ConsoleSettingsField label="客服二维码"><AccountImageInput v-model="form.customerService.qrCode" label="客服二维码" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/'+encodeURIComponent(applicationKey)" :image-size="512" fit="contain" fallback="" :disabled="locked" @busy="uploads+=$event?1:-1"/><p class="mt-2 text-xs text-muted">保留完整二维码和四周留白，客户端可点击查看大图。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="联系电话" input-id="customer-phone"><ConsoleInput id="customer-phone" v-model="form.customerService.phone" :maxlength="30" :disabled="locked" placeholder="选填，手机号或固定电话"/></ConsoleSettingsField>
   <ConsoleSettingsField label="客服微信号" input-id="customer-wechat"><ConsoleInput id="customer-wechat" v-model="form.customerService.wechat" :maxlength="64" :disabled="locked" placeholder="选填，用户可复制微信号"/></ConsoleSettingsField>
   <ConsoleSettingsField label="客服说明" input-id="customer-description"><UTextarea id="customer-description" v-model="form.customerService.description" :maxlength="1000" :rows="5" :disabled="locked" class="w-full" placeholder="例如服务时间、联系须知"/></ConsoleSettingsField>
   <p class="text-xs leading-6 text-muted">联系页面无需登录即可查看。空白联系方式不显示；微信官方客服需先在对应小程序后台添加客服人员。</p>
  </div>
  <div v-else-if="section==='users'" class="space-y-6 p-5 sm:p-7">
   <h2 class="text-sm font-semibold">会员编号</h2>
   <ConsoleSettingsField label="生成方式"><p class="text-sm">前缀 + 递增数字</p><p class="mt-2 text-xs text-muted">会员编号独立于登录账号，只为新用户生成；已有账号和编号保持不变。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="编号前缀" input-id="member-prefix"><ConsoleInput id="member-prefix" v-model="form.users.prefix" pattern="[A-Za-z]{0,12}" :maxlength="12" :disabled="locked" placeholder="例如 HY，可留空"/><p class="mt-2 text-xs text-muted">最多 12 位英文字母，留空使用纯数字编号。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="数字位数" input-id="member-digits"><ConsoleInput id="member-digits" v-model.number="form.users.digits" type="number" :min="4" :max="12" :step="1" required :disabled="locked"/><p class="mt-2 text-xs text-muted">不足位数补零；序号超出设定位数时自动保留完整数字。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="起始序号" input-id="member-start"><ConsoleInput id="member-start" v-model.number="form.users.start" type="number" :min="1" :max="999999999" :step="1" required :disabled="locked"/><p class="mt-2 text-xs text-muted">可提高后续编号的起点，已使用序号不会回退或重复分配。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="编号预览"><p class="break-all text-sm font-medium tabular-nums">{{preview}}</p><p class="mt-2 text-xs text-muted">按当前规则预览，实际编号以新建用户时分配为准。</p></ConsoleSettingsField>
   <div class="border-t border-default pt-6"><h2 class="mb-6 text-sm font-semibold">用户头像</h2><ConsoleSettingsField label="默认头像"><AccountImageInput v-model="form.users.defaultAvatar" label="用户默认头像" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/shared'" :image-size="256" :fallback="site?.tenant.defaultAvatar||'/brand/admin-avatar.png'" :disabled="locked" @busy="uploads+=$event?1:-1"/><p class="mt-2 text-xs text-muted">用于未设置头像的用户，不覆盖用户自己上传的头像；移除后沿用站点默认头像。</p></ConsoleSettingsField></div>
  </div>
  <div v-else-if="section==='appearance'" class="login-design-body"><div class="login-design-fields">
   <h2 class="text-sm font-semibold">登录页展示</h2>
   <ConsoleSettingsField label="顶部 banner"><div class="auth-banner-control"><AccountImageInput v-model="form.registration.appearance.image" label="登录页 banner" portal="tenant" :endpoint="'/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/'+encodeURIComponent(applicationKey)" :image-size="512" image-shape="banner" fit="cover" fallback="/decoration/framework/intro.webp" clear-to-fallback :disabled="locked" @busy="uploads+=$event?1:-1"/></div><p class="mt-2 text-xs text-muted">登录、注册和找回密码页面共用。建议使用约 5:2 的横图，左侧为文字留白；清除后恢复默认图。</p></ConsoleSettingsField>
   <ConsoleSettingsField label="顶部名称" input-id="auth-brand"><ConsoleInput id="auth-brand" v-model="form.registration.appearance.brand" :maxlength="64" :disabled="locked" placeholder="留空使用站点名称"/></ConsoleSettingsField>
   <ConsoleSettingsField label="登录标题" input-id="auth-loginTitle"><ConsoleInput id="auth-loginTitle" v-model="form.registration.appearance.loginTitle" :maxlength="40" :disabled="locked" :placeholder="authDefaults.loginTitle"/></ConsoleSettingsField>
   <ConsoleSettingsField label="登录说明" input-id="auth-loginDescription"><ConsoleInput id="auth-loginDescription" v-model="form.registration.appearance.loginDescription" :maxlength="120" :disabled="locked" :placeholder="authDefaults.loginDescription"/></ConsoleSettingsField>
   <ConsoleSettingsField label="注册标题" input-id="auth-registerTitle"><ConsoleInput id="auth-registerTitle" v-model="form.registration.appearance.registerTitle" :maxlength="40" :disabled="locked" :placeholder="authDefaults.registerTitle"/></ConsoleSettingsField>
   <ConsoleSettingsField label="注册说明" input-id="auth-registerDescription"><ConsoleInput id="auth-registerDescription" v-model="form.registration.appearance.registerDescription" :maxlength="120" :disabled="locked" :placeholder="authDefaults.registerDescription"/></ConsoleSettingsField>
</div><aside class="login-design-preview"><div class="flex justify-center gap-2"><UButton v-for="entry in [{key:'login',label:'登录'},{key:'register',label:'注册'},{key:'reset',label:'找回密码'}] as const" :key="entry.key" color="neutral" :variant="previewMode===entry.key?'soft':'ghost'" size="sm" @click="previewMode=entry.key">{{entry.label}}</UButton></div><div class="login-design-phone"><PhonePreviewFrame :width="375" :height="740" bottom-color="#ffffff"><ConsumerLoginPreview :appearance="form.registration.appearance" :site-name="data.siteName||resolvedSite?.tenant.name||'QiCore'" :mode="previewMode"/></PhonePreviewFrame></div><p class="text-center text-xs text-muted">预览随修改更新，保存后生效</p></aside></div>
  <div v-else class="space-y-6 p-5 sm:p-7"><h2 class="text-sm font-semibold">通用设置</h2>
   <ConsoleSettingsField label="普通注册方式"><div class="space-y-5"><div><UCheckbox v-model="form.registration.passwordLoginEnabled" label="账号密码登录" :disabled="locked"/><p class="mt-2 text-xs text-muted">控制账号及已验证手机号的密码登录；是否允许新用户注册由下方自动注册设置决定。</p></div><div><UCheckbox v-model="form.registration.smsLoginEnabled" label="手机验证码登录" :disabled="locked"/><p class="mt-2 text-xs text-muted">开启后可使用手机号验证码登录。短信渠道与对应模板需完整配置；找回密码仅用于已验证绑定的手机号。</p></div></div></ConsoleSettingsField>
   <ConsoleSettingsField label="政策协议"><p class="mt-2 text-xs text-muted">可在协议管理中编辑和保存用户协议与隐私政策；客户端按当前协议版本进行勾选与确认。</p><UButton to="/admin/policies" color="neutral" variant="outline" class="mt-3">管理用户协议与隐私政策</UButton></ConsoleSettingsField>
   <div class="space-y-6 border-t border-default pt-6"><h2 class="text-sm font-semibold">第三方设置</h2>
    <ConsoleSettingsField label="自动注册用户"><USwitch v-model="form.registration.autoRegister" aria-label="自动注册用户" :disabled="locked"/><p class="mt-2 text-xs text-muted">开启后，首次通过微信小程序登录的用户自动注册。关闭后，已绑定的微信用户仍可登录。</p></ConsoleSettingsField>
   </div>
  </div>
  <ConsoleSettingsActions :dirty="dirty" :busy="!!busy||!!uploads" :saving="busy==='save'" :can-write="data.canWrite" :hint="uploads?'图片处理中…':''" @cancel="discard.request(cancel)"/>
 </ConsoleValidatedForm>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>
.consumer-settings{--settings-label-width:9rem;--settings-content-width:32rem}
.auth-banner-control :deep(.image-select-tile){width:min(100%,320px);height:128px}
.login-design-page{display:flex;flex:1;min-height:0;flex-direction:column;gap:16px}
.login-design-page> :not(.login-design-form){flex-shrink:0}
.login-design-form{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}
.login-design-body{display:grid;flex:1;min-height:0;grid-template-columns:minmax(0,1fr) minmax(250px,380px);gap:32px;padding:24px;overflow:hidden}
.login-design-fields{display:grid;align-content:start;gap:16px;min-width:0;min-height:0;overflow-y:auto;padding-right:4px}
.login-design-preview{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0}
.login-design-preview> :not(.login-design-phone){flex-shrink:0}
.login-design-phone{flex:1;min-height:0;width:100%}
.login-design-form :deep(.console-settings-actions){position:relative;bottom:auto;flex-shrink:0}
@media(max-height:850px) and (min-width:901px){.login-design-body{padding:18px 22px;gap:24px}.login-design-fields{gap:12px}.auth-banner-control :deep(.image-select-tile){height:100px;width:250px}.login-design-preview{gap:8px}}
@media(max-width:1150px) and (min-width:901px){.login-design-body{grid-template-columns:minmax(0,1fr) 260px;gap:20px}.login-design-form{--settings-label-width:6rem}}
@media(max-width:900px){.login-design-body{display:flex;flex-direction:column;overflow-y:auto;padding:18px;gap:24px}.login-design-fields{flex-shrink:0;overflow:visible;padding:0}.login-design-preview{flex:none;min-height:0;max-width:400px;width:100%;align-self:center}.login-design-phone{height:540px;flex:none}.login-design-page{gap:12px}}
</style>
