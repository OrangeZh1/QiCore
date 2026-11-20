<script setup lang="ts">
import {useMaintenanceReload} from '../../lib/maintenance'
import {ref,computed} from 'vue'
import {onShow,onUnload} from '@dcloudio/uni-app'
import ClientNavigation from '../../components/ClientNavigation.vue'
import ClientPageState from '../../components/ClientPageState.vue'
import {clientThemeStyle} from '../../lib/client-theme'
import {api,isH5,message} from '../../lib/api'
import {runtimeConfig,clientImageUrl} from '../../lib/runtime-config'
import {frameworkAsset} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import type {CustomerServiceConfig} from '@qicore/application-sdk/browser/decoration-types'
const data=ref<CustomerServiceConfig|null>(null),action=ref(''),copying=ref(false),error=ref(''),copyError=ref('')
const mini=import.meta.env.UNI_PLATFORM==='mp-weixin',official=computed(()=>mini&&data.value?.miniMode==='official')
const icon=(name:string)=>(isH5?'/h5-assets':'')+frameworkAsset('icons/'+name+'-blue.svg',true)
let sequence=0,copySequence=0,disposed=false,loadedScope=''
function scope(){const c=runtimeConfig();return[c.apiBase,c.tenantId,c.applicationKey].join('|')}
async function load(source='initial'){
 const own=scope();if(action.value&&loadedScope===own)return
 const changed=loadedScope!==own,n=++sequence;if(changed){data.value=null;error.value=''}loadedScope=own;action.value=source;copyError.value='';copySequence++;copying.value=false
 const c=runtimeConfig()
 try{const value=await api<CustomerServiceConfig>('/public/client/customer-service?tenantId='+encodeURIComponent(c.tenantId)+'&applicationKey='+encodeURIComponent(c.applicationKey));if(!disposed&&n===sequence&&own===scope()){data.value=value;error.value=''}}
 catch(e){if(!disposed&&n===sequence&&own===scope())error.value=message(e)}
 finally{if(!disposed&&n===sequence)action.value=''}
}
function call(){const own=loadedScope;if(data.value?.phone&&own===scope())uni.makePhoneCall({phoneNumber:data.value.phone.replace(/[ -]/g,''),fail:()=>{if(!disposed&&own===scope())copyError.value='拨号未完成，请稍后重试'}})}
function previewQr(){if(data.value?.qrCode&&loadedScope===scope())uni.previewImage({urls:[clientImageUrl(data.value.qrCode)]})}
async function copy(){
 if(copying.value||!data.value?.wechat||loadedScope!==scope())return
 const own=loadedScope,n=++copySequence;copying.value=true;copyError.value=''
 try{await new Promise<void>((resolve,reject)=>uni.setClipboardData({data:data.value!.wechat,success:()=>resolve(),fail:reject}))}
 catch(e){if(!disposed&&n===copySequence&&own===scope())copyError.value='复制未完成，请重试'}
 finally{if(!disposed&&n===copySequence)copying.value=false}
}
onShow(()=>void load());onUnload(()=>{disposed=true;sequence++;copySequence++;data.value=null})
useMaintenanceReload(()=>load('maintenance'),()=>!!action.value||copying.value)
</script>
<template><page-meta :page-style="clientThemeStyle"/>
<!-- #ifdef MP-WEIXIN -->
<scroll-view class="client-page-scroll" scroll-y enhanced :show-scrollbar="false">
<!-- #endif --><view class="contact-page">
 <ClientNavigation title="联系客服" back/>
 <ClientPageState v-if="error&&!data" kind="error" title="联系方式暂时无法加载" :description="error" action-label="重新加载" :loading="action==='retry'" :disabled="!!action" @action="load('retry')"/>
 <view v-else-if="action&&!data" class="contact-empty" role="status">正在读取联系方式…</view>
 <view v-else-if="data" class="contact-body">
  <view v-if="error" class="contact-update-error" role="alert"><text>{{error}}</text><button role="button" :loading="action==='retry'" :disabled="!!action" @click="load('retry')">重新加载</button></view>
  <view v-if="data.avatar||data.description" class="contact-intro"><image v-if="data.avatar" class="contact-avatar" :src="clientImageUrl(data.avatar)" mode="aspectFill" aria-label="客服头像"/><view v-if="data.description" class="contact-description">{{data.description}}</view></view>
  <button v-if="official" role="button" open-type="contact" class="contact-official" @error="copyError='暂时无法打开客服，请稍后重试'"><image :src="icon('headphones')" mode="aspectFit"/>联系微信客服</button>
  <view v-if="data.phone" class="contact-row"><image :src="icon('phone')" mode="aspectFit"/><view class="contact-copy"><text>联系电话</text><text class="contact-value">{{data.phone}}</text></view><button role="button" aria-label="拨打客服电话" @click="call">拨打</button></view>
  <view v-if="data.wechat" class="contact-row"><image :src="icon('message-circle')" mode="aspectFit"/><view class="contact-copy"><text>客服微信</text><text class="contact-value">{{data.wechat}}</text></view><button role="button" aria-label="复制客服微信号" :loading="copying" :disabled="copying" :aria-busy="copying" @click="copy">复制</button></view>
  <view v-if="data.qrCode" class="contact-qr"><text class="contact-qr-title">客服二维码</text><button role="button" class="contact-qr-image" aria-label="查看客服二维码大图" @click="previewQr"><image :src="clientImageUrl(data.qrCode)" mode="aspectFit" :show-menu-by-longpress="true"/></button><text class="contact-qr-hint">点击查看大图</text></view>
  <view v-if="!official&&!data.phone&&!data.wechat&&!data.qrCode" class="contact-empty">暂未设置联系方式，请稍后再来查看。</view>
  <view v-if="copyError" class="contact-error" role="alert">{{copyError}}</view>
 </view>
</view>
<!-- #ifdef MP-WEIXIN -->
</scroll-view>
<!-- #endif -->
</template>
<style scoped>
.contact-update-error{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding:12px;background:#fff0ef;border-radius:10px;color:#b84039;font-size:12px}.contact-update-error button{flex-shrink:0;margin:0;padding:7px 10px;background:transparent;border:0;color:inherit;font:inherit}
.contact-page{min-height:100dvh;max-width:480px;margin:auto;background:var(--client-page-background, #f3f9ff);color:var(--client-text,#203450);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.contact-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) 20px}.contact-description{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:20px;color:var(--client-muted,#718198)}.contact-row{display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:18px 16px;background:var(--client-surface,#fff);border-radius:14px}.contact-row image,.contact-official image{width:24px;height:24px;flex-shrink:0}.contact-copy{display:flex;flex-direction:column;flex:1;min-width:0;color:var(--client-muted,#718198);font-size:12px}.contact-value{font-size:16px;font-weight:600;color:var(--client-text,#203450);overflow-wrap:anywhere;margin-top:3px}.contact-row button{margin:0;padding:8px 12px;border:0;border-radius:8px;background:var(--client-primary-soft,#edf3ff);color:var(--client-primary,#3264f5);font:inherit;flex-shrink:0;min-height:40px}.contact-page button::after{border:0}.contact-empty{padding:64px 20px;text-align:center;color:var(--client-muted,#718198)}.contact-official{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin:0 0 16px;padding:14px;border:0;border-radius:12px;background:var(--client-surface,#fff);color:var(--client-primary,#3264f5);font:inherit}.contact-error{padding:12px 0;color:#b84039}
</style>
<style scoped>
.contact-intro{display:flex;align-items:center;justify-content:center;gap:16px;padding:8px 4px 24px}.contact-avatar{display:block;width:64px;height:64px;border-radius:50%;flex-shrink:0;background:var(--client-primary-soft,#edf3ff);box-shadow:0 4px 18px #2034500a}.contact-intro .contact-description{flex:1;min-width:0;margin:0;font-size:14px;line-height:1.8}.contact-qr{display:flex;flex-direction:column;align-items:center;gap:16px;margin-top:18px;padding:24px 20px;background:var(--client-surface,#fff);border-radius:16px}.contact-qr-title{font-size:16px;font-weight:600}.contact-page .contact-qr-image{display:block;margin:0;padding:10px;width:220px;max-width:100%;height:220px;box-sizing:border-box;border:1px solid #e8edf5;border-radius:12px;background:white}.contact-qr-image image{display:block;width:100%;height:100%}.contact-qr-hint{font-size:12px;color:var(--client-muted,#718198)}
</style>
