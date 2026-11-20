<script setup lang="ts">
import {useMaintenanceReload} from '../../lib/maintenance'
import {clientThemeStyle} from '../../lib/client-theme'
import {ref,computed} from 'vue'
import {onLoad,onShow,onUnload} from '@dcloudio/uni-app'
import MpHtml from 'mp-html/dist/uni-app/components/mp-html/mp-html.vue'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientPageState from '../../components/ClientPageState.vue'
import ClientAssetTabs from '../../components/ClientAssetTabs.vue'
import {api,message,isClientPreview,date} from '../../lib/api'
import {runtimeConfig,clientImageDomain} from '../../lib/runtime-config'
type Policy={demo?:boolean;kind?:string;title:string;contentHtml:string;version?:string|number;updatedAt?:string}
const tabs=[{id:'terms',label:'用户协议'},{id:'privacy',label:'隐私政策'}],kind=ref('terms'),data=ref<Policy|null>(null),action=ref(''),error=ref(''),unavailable=ref(false),demo=ref(false),invalidVersion=ref(false),versions:Record<string,number>={}
const title=computed(()=>tabs.find(tab=>tab.id===kind.value)!.label)
const updated=computed(()=>data.value?.updatedAt?(data.value.demo?data.value.updatedAt:date(data.value.updatedAt)):'')
let sequence=0,disposed=false,dataScope=''
function endpoint(){const runtime=runtimeConfig();return '/public/policies/'+encodeURIComponent(runtime.tenantId)+'/'+encodeURIComponent(runtime.applicationKey)}
async function load(source='initial'){
 if(invalidVersion.value)return
 const scope=endpoint();if(action.value&&scope===dataScope&&!source.startsWith('tab:'))return
 if(dataScope&&dataScope!==scope){delete versions.terms;delete versions.privacy}dataScope=scope
 const attempt=++sequence,requestedKind=kind.value,version=versions[requestedKind];action.value=source;if(source!=='retry')error.value='';data.value=null;unavailable.value=false
 try{const value=await api<Policy>((demo.value?'/dev/policies':scope)+'/'+requestedKind+(!demo.value&&version?'?version='+version:''));if(disposed||attempt!==sequence)return;if(scope!==endpoint())throw Error('站点已变化，请重新读取协议');if(demo.value?value.demo!==true:value.demo===true)throw Error('协议内容来源不匹配，请重新读取');if(value.kind&&value.kind!==requestedKind||!demo.value&&version&&value.version!==version)throw Error('协议版本不匹配，请返回后重新打开');data.value=value;error.value=''}
 catch(e:any){if(!disposed&&attempt===sequence){if(scope===endpoint()&&e.code==='POLICY_NOT_CONFIGURED'&&!version){unavailable.value=true;error.value=''}else error.value=scope!==endpoint()?'站点已变化，请重新读取协议':e.code==='POLICY_NOT_CONFIGURED'?'该协议版本不可用，请返回后重新打开':message(e)}}
 finally{if(!disposed&&attempt===sequence)action.value=''}
}
function select(value:string){if(value===kind.value||!tabs.some(tab=>tab.id===value))return;kind.value=value;void load('tab:'+value)}
onLoad(options=>{kind.value=options?.kind==='privacy'?'privacy':'terms';demo.value=!!isClientPreview&&options?.demo==='1';for(const key of ['terms','privacy']){const value=options?.[key+'Version'];if(value!==undefined){if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))){invalidVersion.value=true;error.value='协议版本无效，请返回后重新打开';return}versions[key]=Number(value)}}void load()})
onShow(()=>{if(dataScope&&dataScope!==endpoint())void load('scope')})
onUnload(()=>{disposed=true;sequence++;data.value=null})
useMaintenanceReload(()=>load('maintenance'),()=>!!action.value)
</script>
<template><page-meta :page-style="clientThemeStyle"/><view class="policy-page">
 <ClientNavigation title="协议与隐私" back/>
 <ClientAssetTabs :model-value="kind" :items="tabs" :loading="action.startsWith('tab:')?kind:''" :disabled="invalidVersion" label="协议类型" @update:model-value="select"/>
 <scroll-view enhanced :key="kind" scroll-y class="policy-scroll" :show-scrollbar="false"><view class="policy-body">
  <view v-if="data?.demo" class="policy-demo"><text>开发预览示例</text><text>仅供页面预览，不作为本站正式生效协议。</text></view>
  <ClientPageState v-if="unavailable" kind="empty" :title="title+'暂未提供'" description="站点暂未提供该协议，请稍后再来查看。" action-label=""/>
  <view v-else-if="error" class="policy-error" role="alert"><text>{{error}}</text><button v-if="!invalidVersion" role="button" :loading="action==='retry'" :disabled="!!action" @click="load('retry')">重新加载</button></view>
  <view v-else-if="action" class="policy-state" role="status">正在读取{{title}}…</view>
  <view v-else-if="data" class="policy-document"><view class="policy-title">{{data.title}}</view><view v-if="updated||data.version" class="policy-meta"><text v-if="updated">更新日期 {{updated}}</text><text v-if="data.version">{{data.demo?data.version:'版本 '+data.version}}</text></view><mp-html :domain="clientImageDomain()" :content="data.contentHtml" :copy-link="false" :selectable="true" :tag-style="{h2:'font-size:15px;font-weight:600;line-height:1.7;margin:24px 0 10px;',p:'margin:0 0 12px;line-height:1.95;',img:'max-width:100%;height:auto;',table:'max-width:100%;'}"/></view>
 </view></scroll-view>
</view></template>
<style scoped>
.policy-page{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:auto;background:var(--client-page-background, #f3f9ff);color:var(--client-text);font:14px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.policy-scroll{flex:1;min-height:0;height:0}.policy-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(28px + env(safe-area-inset-bottom))}.policy-demo{display:flex;flex-direction:column;gap:3px;margin:0 2px 14px;color:var(--client-muted);font-size:11px}.policy-demo>text:first-child{color:var(--client-primary)}.policy-document{padding:24px 20px;border-radius:14px;background:var(--client-surface);overflow:hidden;overflow-wrap:anywhere;font-size:13px;line-height:1.95}.policy-title{text-align:center;font-size:22px;font-weight:650;line-height:1.5}.policy-meta{display:flex;justify-content:center;flex-wrap:wrap;gap:6px 12px;margin:10px 0 24px;font-size:10px;color:var(--client-muted)}.policy-state{padding:70px 20px;text-align:center;color:var(--client-muted)}.policy-error{padding:14px;border-radius:12px;background:#fff0ef;color:#b84039;font-size:13px}.policy-error button{display:flex;align-items:center;justify-content:center;min-height:36px;margin:10px 0 0;padding:0 14px;border:0;border-radius:8px;background:#ffe5e1;color:inherit;font:inherit}.policy-error button::after{border:0}
</style>
