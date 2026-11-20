<script setup lang="ts">
import ConsoleDiscardChangesDialog from '~/components/console/ConsoleDiscardChangesDialog.vue'
const discard=useDiscardChanges(()=>!!busy.value)
import AdminConsole from '../../components/console/AdminConsole.vue'
import ConsoleSettingsActions from '../../components/console/ConsoleSettingsActions.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import {dateTime} from '../../utils/update-center'
import ConsoleAccessLink from '../console/ConsoleAccessLink.vue'
import TenantVirtualOrders from './TenantVirtualOrders.vue'
import TenantVirtualGoods from './TenantVirtualGoods.vue'
const props=defineProps<{initialProvider:'wechat'|'alipay'|'wechat-virtual'}>()
type Config={enabled:boolean;appId:string;apiVersion?:string;mchId?:string;serialNo?:string;publicKeyId?:string;sellerId?:string;offerId?:string;env?:number;subjectType?:'unknown'|'business'|'personal'}
type Channel={execution?:{implemented:boolean;clients:string[];enabled:boolean;liveVerified:boolean};provider:string;label:string;version:number;config:Config;hasSecrets:Record<string,boolean>;updatedAt:string|null}
type View={miniProgramSubjectType?:'unknown'|'personal'|'business';miniProgramAppId?:string;virtualCallbackUrl?:string|null;canReadVirtualOrders?:boolean;applicationKey:string|null;applications:{key:string;name:string}[];canWrite:boolean;channels:Channel[]}
type Field={key:'appId'|'mchId'|'serialNo'|'publicKeyId'|'sellerId'|'offerId';label:string;placeholder:string;maxlength:number}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/payment-settings',toast=useToast()
const initial=await useAsyncData<View>('tenant-payments:'+props.initialProvider+':'+auth.session.value?.id+':'+tenantId,(_nuxt,{signal})=>auth.api<View>(endpoint,'GET',undefined,{signal}))
if(initial.error.value&&!auth.session.value)await navigateTo('/admin/login',{replace:true})
const data=ref<View|null>(initial.data.value??null),provider=computed(()=>props.initialProvider==='alipay'?'alipay':virtualTab.value==='ordinary'?'wechat':'wechat-virtual'),applicationKey=ref(data.value?.applicationKey||''),form=ref<Config|null>(null),baseline=ref(''),secrets=reactive<Record<string,string>>({}),busy=ref<'save'|'refresh'|'retry'|'check'|'application'|null>(null),error=ref(initial.error.value?.message||''),testError=ref(''),result=ref<{message:string;checkedAt:string;version:number}|null>(null)
const channel=computed(()=>data.value?.channels.find(row=>row.provider===provider.value)),isWechat=computed(()=>provider.value==='wechat'),isV2=computed(()=>isWechat.value&&form.value?.apiVersion==='V2')
const paymentNotice=computed(()=>{
 const current=channel.value;if(!current)return null
 if(isWechat.value&&data.value?.miniProgramSubjectType==='personal')return{color:'warning' as const,title:'个人主体小程序不支持普通微信支付',description:'小程序虚拟商品请使用虚拟支付。已有配置及历史交易保留，公众号、H5 分别按其资质判断。'}
 if(isVirtual.value&&data.value?.miniProgramSubjectType==='unknown')return{color:'warning' as const,title:'请先设置小程序主体类型',description:'前往渠道管理的微信小程序配置中选择与微信公众平台一致的主体类型。'}
 if(!current.execution?.implemented)return{color:'warning' as const,title:'支付能力暂不可用',description:'当前未提供此渠道的支付执行能力，请联系管理员核实支付服务。'}
 if(!current.config.enabled)return{color:'warning' as const,title:'支付配置不完整',description:'请补充并保存支付参数与密钥。配置完整且平台启用支付执行后，才能使用此渠道收款。'}
 if(!current.execution.enabled)return{color:'warning' as const,title:'支付执行未启用',description:'渠道配置已保存，当前站点尚未启用支付执行，请联系管理员核实启用状态。'}
 return{color:'success' as const,title:'支付配置就绪',description:'渠道配置完整，平台已启用支付执行。各端可用的收款方式以支付方式设置为准，付款结果以支付渠道回执和订单状态为准。'}
})
const requestUrl=useRequestURL(),messageDefaults=useState<Record<string,Record<string,string>>>('virtual-message-draft:'+auth.session.value?.id+':'+tenantId,()=>({})),pristineMessages=ref<Record<string,string>>({}),copiedMessages=ref(false)
const needsDiscard=computed(()=>!!form.value&&(JSON.stringify(form.value)!==baseline.value||copiedMessages.value||Object.entries(secrets).some(([key,value])=>Object.hasOwn(pristineMessages.value,key)?value!==pristineMessages.value[key]:!!value)))
const hasDefaultMessages=computed(()=>Object.keys(pristineMessages.value).some(key=>!!secrets[key])),dirty=computed(()=>needsDiscard.value||hasDefaultMessages.value||provider.value==='wechat-virtual'&&(form.value?.appId!==channel.value?.config.appId||form.value?.subjectType!==channel.value?.config.subjectType||form.value?.env!==channel.value?.config.env)),locked=computed(()=>!!busy.value||!data.value?.canWrite)
const callbackUrl=computed(()=>data.value?.virtualCallbackUrl||(applicationKey.value?new URL('/api/v1/payments/wechat-virtual/'+encodeURIComponent(tenantId)+'/'+encodeURIComponent(applicationKey.value)+'/notify',requestUrl.origin).href:''))
const callbackLocal=computed(()=>{if(!callbackUrl.value)return false;const url=new URL(callbackUrl.value);return url.protocol!=='https:'||url.hostname==='localhost'||url.hostname==='[::1]'||/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)})
const isVirtual=computed(()=>provider.value==='wechat-virtual')
const virtualTab=useRouteTab<string>('virtual',()=>virtualTabs.value.map(item=>item.value)),goodsPanel=ref<InstanceType<typeof TenantVirtualGoods>|null>(null),ordersPanel=ref<InstanceType<typeof TenantVirtualOrders>|null>(null)
const virtualTabs=computed(()=>[{label:'普通支付',value:'ordinary'},{label:'虚拟支付',value:'virtual'},{label:'商品管理',value:'goods'},...(data.value?.canReadVirtualOrders?[{label:'虚拟支付订单',value:'orders'}]:[])])
const refreshing=computed(()=>isVirtual.value&&virtualTab.value==='goods'?goodsPanel.value?.refreshing:isVirtual.value&&virtualTab.value==='orders'?ordersPanel.value?.refreshing:busy.value==='refresh')
function refreshPage(){if(isVirtual.value&&virtualTab.value==='goods'){void goodsPanel.value?.refresh('page-refresh');return}if(isVirtual.value&&virtualTab.value==='orders'){void ordersPanel.value?.refresh();return}void refresh()}
function selectVirtualTab(value:string|number){const tab=String(value);if(busy.value||!virtualTabs.value.some(t=>t.value===tab)||virtualTab.value===tab)return;const move=()=>{virtualTab.value=tab};if(virtualTab.value==='goods'&&goodsPanel.value){goodsPanel.value.requestLeave(move);return}if(needsDiscard.value){discard.request(()=>{cancel();move()});return}move()}
watch(()=>data.value?.canReadVirtualOrders,value=>{if(!value&&virtualTab.value==='orders')virtualTab.value='virtual'})
const fields=computed<Field[]>(()=>isVirtual.value?[{key:'appId',label:'小程序 AppID',placeholder:'wx 开头的小程序 AppID',maxlength:18},{key:'offerId',label:'OfferID',placeholder:'虚拟支付平台的支付应用 ID',maxlength:32}]:isWechat.value?[
 {key:'mchId',label:'商户号',placeholder:'请输入微信支付商户号',maxlength:20},
 {key:'appId',label:'支付 AppID',placeholder:'wx 开头，须与商户号完成绑定',maxlength:18},
 ...(!isV2.value?[{key:'serialNo' as const,label:'商户证书序列号',placeholder:'商户 API 证书序列号',maxlength:64},{key:'publicKeyId' as const,label:'微信支付公钥 ID',placeholder:'PUB_KEY_ID_…',maxlength:108}]:[])
]:[{key:'appId',label:'应用 AppID',placeholder:'支付宝开放平台的 16 位应用 ID',maxlength:16},{key:'sellerId',label:'收款商户 PID',placeholder:'2088 开头的 16 位支付宝账户 ID',maxlength:16}])
const keyFields=computed(()=>isVirtual.value?[{key:form.value?.env===0?'appKey':'sandboxAppKey',label:form.value?.env===0?'现网 AppKey':'沙箱 AppKey',multiline:false,placeholder:form.value?.env===0?'从微信虚拟支付基本配置复制现网 AppKey':'从微信虚拟支付基本配置复制沙箱 AppKey'}]:isWechat.value?[
 {key:isV2.value?'apiV2Key':'apiV3Key',label:isV2.value?'API v2 密钥':'API v3 密钥',multiline:false,placeholder:'32 位 API 密钥'},
 {key:'privateKey',label:'商户私钥',multiline:true,placeholder:'粘贴 apiclient_key.pem 内容'},
 ...(isV2.value?[{key:'merchantCertificate',label:'商户 API 证书',multiline:true,placeholder:'粘贴 apiclient_cert.pem 内容'}]:[{key:'publicKey',label:'微信支付公钥',multiline:true,placeholder:'粘贴微信支付平台下载的公钥'}])
]:[{key:'privateKey',label:'应用私钥',multiline:true,placeholder:'粘贴应用 RSA2 私钥（支持 PEM 或 Base64）'},{key:'publicKey',label:'支付宝公钥',multiline:true,placeholder:'粘贴支付宝提供的公钥，不是应用公钥'}])
const messageFields=[{key:'callbackToken',label:'校验 Token',placeholder:'填写微信平台已有 Token，或点击生成',help:'由你设置，用于校验消息来源。3–32 位字母或数字。'},{key:'encodingAESKey',label:'消息加密密钥',placeholder:'填写微信平台已有密钥，或点击生成',help:'微信平台中的 EncodingAESKey，须为 43 位。'}]
const copyingMessage=ref('')
function randomMessageKey(key:string){const bytes=crypto.getRandomValues(new Uint8Array(key==='callbackToken'?16:32));return key==='callbackToken'?Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''):btoa(String.fromCharCode(...bytes)).replace(/=$/,'')}
function generateMessageKey(key:string){if(locked.value||!['callbackToken','encodingAESKey'].includes(key))return;secrets[key]=randomMessageKey(key);result.value=null}
function fillMessageDefaults(){pristineMessages.value={};copiedMessages.value=false;if(!isVirtual.value||!data.value?.canWrite||channel.value?.version!==0)return;const key=applicationKey.value+':'+channel.value.version;const defaults=messageDefaults.value[key]||(messageDefaults.value[key]={callbackToken:randomMessageKey('callbackToken'),encodingAESKey:randomMessageKey('encodingAESKey')});for(const field of messageFields)if(!hasKey(field.key)){secrets[field.key]=defaults[field.key]!;pristineMessages.value[field.key]=defaults[field.key]!}}
async function copyMessageKey(key:string){if(!secrets[key]||copyingMessage.value)return;copyingMessage.value=key;try{await navigator.clipboard.writeText(secrets[key]!);if(!disposed){copiedMessages.value=true;toast.add({title:'已复制，请粘贴到微信消息推送设置',color:'success'})}}catch{if(!disposed)toast.add({title:'复制失败，请重试',color:'error'})}finally{if(!disposed)copyingMessage.value=''}}
const controller=new AbortController();let disposed=false
function fill(value:View){data.value=value;applicationKey.value=value.applicationKey||'';resetForm()}
function resetForm(){form.value=channel.value?JSON.parse(JSON.stringify(channel.value.config)):null;if(isVirtual.value&&form.value){form.value.subjectType=data.value?.miniProgramSubjectType||'unknown';if(form.value.subjectType==='personal')form.value.env=0;form.value.env??=1;form.value.appId=data.value?.miniProgramAppId||''}baseline.value=JSON.stringify(form.value);for(const key of Object.keys(secrets))delete secrets[key];result.value=null;testError.value='';error.value='';fillMessageDefaults();discard.keep()}
resetForm();if(initial.error.value)error.value=initial.error.value.message||'支付配置读取失败'
watch(provider,()=>resetForm(),{flush:'sync'})
function changeProtocol(){for(const key of Object.keys(secrets))delete secrets[key];result.value=null}
function hasKey(name:string){
 if(!channel.value?.hasSecrets[name]||!form.value)return false
 const saved=channel.value.config,keys:(keyof Config)[]=isWechat.value?['mchId','apiVersion']:isVirtual.value?['appId','offerId']:['appId','sellerId']
 if(keys.some(key=>saved[key]&&saved[key]!==form.value?.[key]))return false
 return name!=='publicKey'||!isWechat.value||!saved.publicKeyId||saved.publicKeyId===form.value.publicKeyId
}
async function chooseApplication(value:string){if(busy.value||value===applicationKey.value)return;await refresh('application',value)}
async function refresh(source:'refresh'|'retry'|'application'='refresh',key=applicationKey.value){
 if(busy.value)return;if(needsDiscard.value){discard.request(()=>{cancel();void refresh(source,key)});return}busy.value=source;error.value=''
 try{const value=await auth.api<View>(endpoint+(key?'?applicationKey='+encodeURIComponent(key):''),'GET',undefined,{signal:controller.signal});if(!disposed)fill(value)}catch(e:any){if(!disposed){error.value=e.message||'支付配置读取失败';if(e.status===401)await navigateTo('/admin/login',{replace:true})}}finally{if(!disposed)busy.value=null}
}
async function save(){
 if(locked.value||!dirty.value||!form.value||!channel.value||!applicationKey.value)return;busy.value='save';error.value='';testError.value='';result.value=null
 try{const value=await auth.api<View>(endpoint+'/'+encodeURIComponent(applicationKey.value)+'/'+provider.value,'PUT',{version:channel.value.version,config:JSON.parse(JSON.stringify(form.value)),secrets:{...Object.fromEntries(keyFields.value.map(field=>[field.key,secrets[field.key]||''])),...Object.fromEntries(Object.entries(secrets).filter(([,value])=>!!value))}},{signal:controller.signal});if(!disposed){fill(value);toast.add({title:'支付配置已保存',color:'success'})}}catch(e:any){if(!disposed)error.value=e.message||'保存失败'}finally{if(!disposed)busy.value=null}
}
async function check(){
 if(busy.value||dirty.value||!data.value?.canWrite||!channel.value?.version||!applicationKey.value)return;busy.value='check';testError.value='';result.value=null
 try{const value=await auth.api<{message:string;checkedAt:string;version:number}>(endpoint+'/'+encodeURIComponent(applicationKey.value)+'/'+provider.value+'/check','POST',{version:channel.value.version},{signal:controller.signal});if(!disposed)result.value=value}catch(e:any){if(!disposed)testError.value=e.message||'自检未通过'}finally{if(!disposed)busy.value=null}
}
function cancel(){if(!busy.value)resetForm()}
usePageLeaveGuard(to=>{if(!auth.session.value)return;if(!!busy.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(needsDiscard.value){return discard.decide(cancel)}})
onBeforeUnmount(()=>{disposed=true;controller.abort();busy.value=null;copyingMessage.value='';messageDefaults.value={};for(const key of Object.keys(secrets))delete secrets[key]})
</script>
<template><AdminConsole :refreshing="!!refreshing" @refresh="refreshPage"><div class="space-y-5">
 <ConsolePageHeading :title="props.initialProvider==='alipay'?'支付宝':'微信支付'"><template #actions><USelect v-if="data&&data.applications.length>1" :model-value="applicationKey" :items="data.applications.map(app=>({value:app.key,label:app.name}))" aria-label="支付所属应用" :disabled="!!busy" @update:model-value="chooseApplication"/></template></ConsolePageHeading>
 <UTabs v-if="props.initialProvider!=='alipay'&&data?.applicationKey" :model-value="virtualTab" :items="virtualTabs" :content="false" variant="link" :ui="{trigger:'cursor-pointer'}" aria-label="微信支付功能" @update:model-value="selectVirtualTab"/>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <template v-if="paymentNotice&&(provider==='alipay'||['ordinary','virtual'].includes(virtualTab))"><UAlert :color="paymentNotice.color" variant="subtle" :title="paymentNotice.title" :description="paymentNotice.description"/><p v-if="isVirtual||provider==='alipay'" class="text-xs leading-5 text-muted">{{isVirtual?'支持小程序内积分套餐和固定余额档位的道具直购。商品须先上传发布；自定义余额金额不使用此通道。Apple 订单由用户在 App Store 申请退款。':'支持 H5 浏览器收银台，不支持微信小程序内直接调用；优惠订单退款须先核查实际金额。'}}</p></template>
 <form v-if="form&&channel&&data&&(!isVirtual||virtualTab==='virtual')" class="space-y-5" @submit.prevent="save"><section class="surface-card overflow-hidden">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-7"><p class="text-sm font-medium">{{isVirtual?'支付参数':isWechat?'普通商户支付':'RSA2 公钥模式'}}</p><UBadge :color="channel.config.enabled?'success':'neutral'" variant="subtle">{{channel.config.enabled?'已配置':'配置不完整'}}</UBadge></div>
  <div class="payment-form space-y-6 p-5 sm:p-7">
   <ConsoleSettingsField v-if="isVirtual" label="主体类型"><div class="text-sm">{{data.miniProgramSubjectType==='personal'?'个人主体':data.miniProgramSubjectType==='business'?'企业 / 个体工商户':'待设置'}}<UButton to="/admin/mini-program" variant="link" class="ml-3">前往小程序配置</UButton></div><p v-if="form.subjectType==='personal'" class="mt-2 text-xs leading-5 text-muted">个人主体须完成小程序认证、备案并包含工具类目；仅支持道具直购、现网环境。全终端月支付限额为 10 万元，具体开通状态以微信平台为准。</p></ConsoleSettingsField>
   <ConsoleSettingsField v-if="isVirtual" label="支付环境" input-id="payment-env"><USelect id="payment-env" v-model="form.env" :items="form.subjectType==='personal'?[{value:0,label:'现网'}]:[{value:1,label:'沙箱'},{value:0,label:'现网'}]" class="w-full" :disabled="locked||form.subjectType==='personal'"/></ConsoleSettingsField>
   <ConsoleSettingsField v-if="isWechat" label="接口版本" input-id="payment-version"><USelect id="payment-version" v-model="form.apiVersion" :items="[{value:'V3',label:'API V3（推荐）'},{value:'V2',label:'API V2'}]" class="w-full" :disabled="locked" @update:model-value="changeProtocol"/></ConsoleSettingsField>
   <ConsoleSettingsField v-for="field in fields" :key="field.key" :label="field.label" :input-id="'payment-'+field.key"><ConsoleInput :id="'payment-'+field.key" v-model="form[field.key]" :placeholder="field.placeholder" :maxlength="field.maxlength"  :disabled="locked" :readonly="isVirtual&&field.key==='appId'" autocomplete="off"/><p v-if="isVirtual&&field.key==='appId'" class="mt-2 text-xs text-muted">{{data.miniProgramAppId?'自动使用当前站点的小程序配置。':'请先在渠道管理的小程序页面保存 AppID。'}}</p></ConsoleSettingsField>
   <div class="border-t border-default pt-5"><h3 class="text-sm font-semibold">{{isVirtual?'支付密钥':'密钥与验签'}}</h3><p class="mt-1 text-xs text-muted">加密保存，不回显；留空保留已有内容。</p></div>
   <ConsoleSettingsField v-for="field in keyFields" :key="field.key" :label="field.label" :input-id="'payment-'+field.key"><UTextarea v-if="field.multiline" :id="'payment-'+field.key" v-model="secrets[field.key]" :rows="3" :maxlength="12000" class="w-full font-mono text-xs" :placeholder="hasKey(field.key)?'已保存，留空保留；重新填写可替换':field.placeholder" :disabled="locked" autocomplete="off" :spellcheck="false"/><ConsoleInput v-else :id="'payment-'+field.key" v-model="secrets[field.key]" type="password" autocomplete="new-password" :maxlength="isVirtual?256:32" :placeholder="hasKey(field.key)?'已保存，留空保留':field.placeholder" :disabled="locked"/></ConsoleSettingsField>
   <template v-if="isVirtual">
    <div class="border-t border-default pt-5"><h3 class="text-sm font-semibold">消息推送</h3><p class="mt-1 text-xs leading-5 text-muted">用于接收支付成功与退款通知。在微信公众平台「开发与服务 → 开发管理 → 消息推送」填写下列信息，选择安全模式、XML 格式。</p></div>
    <ConsoleSettingsField label="推送地址"><ConsoleAccessLink :url="callbackUrl" label="消息推送地址" :allow-open="false"/><p v-if="callbackLocal" class="mt-2 text-xs text-muted">当前为本地预览地址，微信真实回调需使用公网 HTTPS 地址。</p></ConsoleSettingsField>
    <ConsoleSettingsField v-for="field in messageFields" :key="field.key" :label="field.label" :input-id="'payment-'+field.key"><div class="flex min-w-0 flex-wrap items-center gap-2"><ConsoleInput :id="'payment-'+field.key" v-model="secrets[field.key]" class="min-w-0 flex-1 basis-64 font-mono text-xs" type="text" autocomplete="off" :spellcheck="false" :maxlength="field.key==='callbackToken'?32:43" :placeholder="hasKey(field.key)?'已保存，留空保留':field.placeholder" :disabled="locked"/><div class="flex shrink-0 gap-2"><UButton type="button" color="neutral" variant="outline" :disabled="locked" @click="generateMessageKey(field.key)">生成</UButton><UButton type="button" color="neutral" variant="outline" :loading="copyingMessage===field.key" :disabled="!!copyingMessage||!secrets[field.key]" @click="copyMessageKey(field.key)">复制</UButton></div></div><p class="mt-2 text-xs leading-5 text-muted">{{field.help}} 已在微信配置过时请填入相同值；新生成的值需复制到微信平台，并保存本页。</p></ConsoleSettingsField>
   </template>
   <p v-if="isVirtual&&hasDefaultMessages" class="text-xs text-muted">已为本次配置生成默认消息凭据，保存后生效。</p>
   <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-5"><div><p class="text-sm font-medium">配置自检</p><p class="mt-1 text-xs text-muted">{{dirty?'请先保存当前修改。':isVirtual?'检查 AppID、OfferID 及当前环境密钥，不发起支付。':'检查字段、密钥格式及证书匹配，不发起支付。'}}</p></div><UButton color="neutral" variant="outline" icon="i-lucide-shield-check" :loading="busy==='check'" :disabled="!!busy||dirty||!channel.version||!data.canWrite" @click="check">配置自检</UButton></div>
   <UAlert v-if="testError" color="error" :title="testError"/><UAlert v-if="result" color="success" :title="result.message" :description="'自检时间：'+dateTime(result.checkedAt)"/>

  </div>
  </section><ConsoleSettingsActions :dirty="needsDiscard" :save-available="dirty" :busy="!!busy" :saving="busy==='save'" :can-write="data.canWrite" @cancel="discard.request(cancel)"/>
 </form>
 <Suspense v-else-if="isVirtual&&virtualTab==='goods'&&applicationKey&&channel"><section class="surface-card p-5 sm:p-7"><TenantVirtualGoods :key="applicationKey" ref="goodsPanel" :application-key="applicationKey" :settings-version="channel.version" :settings-dirty="needsDiscard" :settings-busy="!!busy" standalone/></section><template #fallback><p role="status" class="py-6 text-sm text-muted">正在读取套餐…</p></template></Suspense>
 <Suspense v-else-if="isVirtual&&virtualTab==='orders'&&applicationKey&&data?.canReadVirtualOrders"><TenantVirtualOrders :key="applicationKey" ref="ordersPanel" :application-key="applicationKey"/><template #fallback><p role="status" class="py-6 text-sm text-muted">正在读取订单记录…</p></template></Suspense>
 <p v-else-if="data" class="py-10 text-center text-sm text-muted">请选择要配置支付的应用。</p>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>.payment-form{--settings-label-width:10rem;--settings-content-width:36rem}</style>
