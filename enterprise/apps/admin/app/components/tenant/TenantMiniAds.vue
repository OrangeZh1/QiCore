<script setup lang="ts">
import ConsoleDiscardChangesDialog from '../console/ConsoleDiscardChangesDialog.vue'
import ConsoleSettingsActions from '../console/ConsoleSettingsActions.vue'
import ConsoleValidatedForm from '../console/ConsoleValidatedForm.vue'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import {dateTime} from '../../utils/update-center'
const props=defineProps<{endpoint:string}>()
const emit=defineEmits<{configure:[]}>()
type Config={mode:'wechat-managed'|'manual';homeBanner:string;profileBanner:string;homeInterstitial:string;rewarded:string}
const defaults=():Config=>({mode:'wechat-managed',homeBanner:'',profileBanner:'',homeInterstitial:'',rewarded:''})
type View={applicationKey:string;appId:string;boundAppId:string;appIdChanged:boolean;version:number;config:Config;canWrite:boolean;updatedAt:string|null;rewarded:{configured:boolean;message:string}}
const auth=useApi('tenant'),toast=useToast(),busy=ref<'save'|'refresh'|'retry'|null>(null),discard=useDiscardChanges(()=>!!busy.value)
const data=ref<View|null>(null),form=ref<Config>(defaults()),baseline=ref(JSON.stringify(form.value)),error=ref('')
const refreshing=computed(()=>busy.value==='refresh')
const dirty=computed(()=>JSON.stringify(form.value)!==baseline.value),locked=computed(()=>!!busy.value||!data.value?.canWrite)
const modes=[{value:'wechat-managed',label:'免开发智能接入',description:'在微信后台配置和调整广告'},{value:'manual',label:'自主接入',description:'填写广告位 ID，使用装修组件布局'}] as const
const fields=[{key:'homeBanner',label:'首页横幅广告',help:'在页面装修中添加并拖动「微信广告」组件决定位置。'},{key:'profileBanner',label:'个人中心横幅广告',help:'在页面装修中添加并拖动「微信广告」组件决定位置。'},{key:'homeInterstitial',label:'首页插屏广告',help:'每次打开首页页面最多尝试展示一次；返回页面不重复弹出。'}] as const
let disposed=false,initialized=false;const controller=new AbortController()
onBeforeUnmount(()=>{disposed=true;controller.abort();busy.value=null})
defineExpose({refresh,refreshing,requestLeave})
const initial=await useAsyncData<View>('mini-ads:'+auth.session.value?.id+':'+props.endpoint,(_nuxt,{signal})=>auth.api<View>(props.endpoint,'GET',undefined,{signal}),{getCachedData:(key,nuxt)=>nuxt.isHydrating?nuxt.payload.data[key]:undefined})
function fill(value:View){data.value=value;form.value=value.appIdChanged?defaults():{...defaults(),...value.config};baseline.value=JSON.stringify(form.value);discard.keep()}
if(!disposed){if(initial.data.value)fill(initial.data.value);error.value=initial.error.value?.message||'';initialized=true}
function cancel(){if(busy.value)return;form.value=JSON.parse(baseline.value);error.value='';discard.keep()}
function requestLeave(move:()=>void){if(!initialized){move();return}if(busy.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return}if(dirty.value)discard.request(()=>{cancel();move()});else move()}
async function refresh(source:'refresh'|'retry'='refresh'){
 if(!initialized||disposed||busy.value)return;if(dirty.value){discard.request(()=>{cancel();void refresh(source)});return}busy.value=source;error.value=''
 try{const value=await auth.api<View>(props.endpoint,'GET',undefined,{signal:controller.signal});if(!disposed)fill(value)}catch(e:any){if(!disposed){error.value=e.message||'广告配置读取失败';if([401,403].includes(e.status)){data.value=null;form.value=defaults();baseline.value=JSON.stringify(form.value)}}}finally{if(!disposed)busy.value=null}
}
async function save(){
 if(locked.value||!data.value?.appId||!dirty.value&&!data.value.appIdChanged)return;busy.value='save';error.value=''
 try{const value=await auth.api<View>(props.endpoint,'PUT',{version:data.value.version,appId:data.value.appId,config:{...form.value}},{signal:controller.signal});if(!disposed){fill(value);toast.add({title:'广告配置已保存',description:'实际展示以微信广告加载结果为准',color:'success'})}}catch(e:any){if(!disposed)error.value=e.message||'广告配置保存失败'}finally{if(!disposed)busy.value=null}
}
usePageLeaveGuard(()=>{if(!auth.session.value)return;if(busy.value)return false;if(dirty.value)return discard.decide(cancel)})
useUnsavedBeforeUnload(()=>dirty.value||!!busy.value)
</script>
<template><div class="space-y-5">
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <ConsoleValidatedForm v-if="data" @submit="save" @invalid="error=$event"><section class="surface-card overflow-hidden">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-7"><div class="flex flex-wrap items-center gap-3"><h2 class="text-base font-semibold">展示广告</h2><UBadge v-if="!data.appId" color="neutral" variant="subtle">待配置小程序</UBadge><span v-else class="break-all font-mono text-xs text-muted">{{data.appId}}</span></div><UButton v-if="!data.appId" type="button" color="primary" variant="soft" size="sm" @click="emit('configure')">配置小程序</UButton></div>
  <div class="mini-ad-form space-y-6 p-5 sm:p-7">
   <UAlert v-if="data.appIdChanged" color="warning" title="小程序已变更" description="旧广告位已停止下发，请填写当前小程序的广告位后保存。"/>
   <ConsoleSettingsField label="接入方式"><div role="radiogroup" aria-label="广告接入方式" class="grid gap-4 sm:grid-cols-2"><label v-for="mode in modes" :key="mode.value" class="flex cursor-pointer items-start gap-2.5"><input v-model="form.mode" type="radio" name="ad-mode" :value="mode.value" :disabled="locked" class="ad-mode-radio mt-1 size-4 shrink-0"/><span><span class="block text-sm font-medium">{{mode.label}}</span><span class="mt-1 block text-xs leading-5 text-muted">{{mode.description}}</span></span></label></div></ConsoleSettingsField>
   <ConsoleSettingsField v-if="form.mode==='wechat-managed'" label="接入步骤"><div class="space-y-4"><ol class="list-decimal space-y-2 pl-4 text-sm leading-6"><li>进入微信公众平台的「流量主 → 广告管理」。</li><li>选择「免开发智能接入」，预览并调整广告位置。</li><li>在微信后台确认开启，查看实际展示效果。</li></ol><div><UButton to="https://mp.weixin.qq.com/" target="_blank" rel="noopener noreferrer" color="neutral" variant="outline" icon="i-lucide-external-link">打开微信公众平台</UButton></div><p class="text-xs leading-5 text-muted">微信端管理广告开关；本页保存后停止加载手动广告位，原配置保留。</p></div></ConsoleSettingsField>
   <template v-else><ConsoleSettingsField label="配置说明"><p class="text-xs leading-5 text-muted">填写对应类型的广告位 ID，留空不展示。横幅位置由页面装修中的「微信广告」组件决定。请关闭微信后台重叠位置的免开发广告。</p></ConsoleSettingsField>
   <ConsoleSettingsField v-for="field in fields" :key="field.key" :label="field.label" :input-id="'ad-'+field.key"><div class="flex flex-wrap gap-3"><ConsoleInput :id="'ad-'+field.key" v-model="form[field.key]" :disabled="locked" :maxlength="71" pattern="adunit-[a-zA-Z0-9]{8,64}" placeholder="adunit- 开头的广告位 ID" class="min-w-0 flex-1 basis-48"/></div><p v-if="field.key==='homeInterstitial'" class="mt-2 text-xs leading-5 text-muted">{{field.help}}</p></ConsoleSettingsField></template>
   <div v-if="form.mode==='manual'" class="space-y-5 border-t border-default pt-6"><h3 class="text-sm font-semibold">封面广告</h3><ConsoleSettingsField label="开通与设置"><p class="text-sm leading-6">在微信公众平台的流量主广告管理中开启，并选择需要展示的入口场景。</p><p class="mt-2 text-xs leading-5 text-muted">由微信在打开小程序时展示，无需填写广告位 ID，也不占用装修页面位置。实际开关和展示状态以微信后台为准。</p><div class="mt-3"><UButton to="https://mp.weixin.qq.com/" target="_blank" rel="noopener noreferrer" color="neutral" variant="outline" size="sm" icon="i-lucide-external-link">前往设置封面广告</UButton></div></ConsoleSettingsField></div>
   <div class="space-y-5 border-t border-default pt-6"><h3 class="text-sm font-semibold">激励视频</h3><ConsoleSettingsField label="广告位 ID" input-id="ad-rewarded"><ConsoleInput id="ad-rewarded" v-model="form.rewarded" :disabled="locked" :maxlength="71" pattern="adunit-[a-zA-Z0-9]{8,64}" placeholder="adunit- 开头的广告位 ID"/><p class="mt-2 text-xs leading-5 text-muted">{{data.rewarded.message}}</p></ConsoleSettingsField></div>
  </div>
  <ConsoleSettingsActions :dirty="dirty" :busy="!!busy" :saving="busy==='save'" :can-write="data.canWrite" :save-disabled="!data.appId" :save-available="data.appIdChanged" :hint="!data.appId?(dirty?'广告草稿尚未保存，请先配置小程序 AppID':'保存广告配置前，请先配置小程序 AppID'):!dirty&&data.updatedAt?'上次保存：'+dateTime(data.updatedAt):''" @cancel="discard.request(cancel)"/>
 </section></ConsoleValidatedForm>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></template>
<style scoped>.mini-ad-form{--settings-label-width:8rem;--settings-content-width:40rem}.ad-mode-radio{accent-color:var(--ui-primary)}</style>
