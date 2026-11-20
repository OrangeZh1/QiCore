<script setup lang="ts">
import ClientNavigation from './ClientNavigation.vue'
import ClientPageState from './ClientPageState.vue'
import {isH5} from '../lib/api'
withDefaults(defineProps<{title:string;error:string;action:string;hasContent:boolean;needsLogin:boolean;navigation:boolean;showHeader?:boolean}>(),{showHeader:true})
defineEmits<{retry:[];login:[]}>()
</script>
<template>
 <view v-if="!hasContent" class="decoration-state qc-view"><ClientNavigation v-if="showHeader||!isH5" :title="showHeader?title:''"/><view class="state-body qc-view">
  <ClientPageState v-if="error" :kind="needsLogin?'login':'error'" :title="needsLogin?'请先登录':'页面加载失败'" :description="error" :action-label="needsLogin?'去登录':'重新加载'" :loading="!needsLogin&&action==='retry'" :disabled="!!action" @action="needsLogin?$emit('login'):$emit('retry')"><button v-if="needsLogin" class="state-retry qc-button" :loading="action==='retry'" :disabled="!!action" @click="$emit('retry')">重新加载</button></ClientPageState>
  <view v-else class="state-loading qc-view" role="status">页面加载中…</view>
 </view></view>
 <view v-else-if="error" class="update-error qc-view" :class="{navigation}" role="alert"><text class="qc-text">页面更新未完成：{{error}}</text><button role="button" :loading="action==='retry'" :disabled="!!action" @click="$emit('retry')" class="qc-button">重试</button></view>
</template>
<style scoped>
.decoration-state{min-height:100dvh;color:var(--client-text);background:var(--client-page-background, #f3f9ff);font:14px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.state-body{padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px)}.state-loading{padding:60px 16px;text-align:center;color:var(--client-muted)}.update-error .qc-button{display:flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:36px;margin:0;padding:0 14px;border:0;border-radius:8px;background:#ffe5e1;color:#b84039;font:inherit;font-size:13px}.update-error .qc-button::after{border:0}.update-error{position:fixed;z-index:30;bottom:calc(12px + env(safe-area-inset-bottom));left:12px;right:12px;box-sizing:border-box;max-width:456px;margin:auto;padding:12px;display:flex;align-items:center;gap:12px;border-radius:12px;background:#fff0ef;color:#b84039;font-size:13px;line-height:1.6}.update-error.navigation{bottom:calc(62px + env(safe-area-inset-bottom))}.update-error>.qc-text{flex:1;min-width:0;overflow-wrap:anywhere}.update-error .qc-button{flex-shrink:0;min-width:72px;white-space:nowrap}
.state-retry{display:block;margin:16px auto 0;padding:0 16px;border:0;background:transparent;color:var(--client-primary,#3479f6);font:inherit;font-size:13px}.state-retry::after{border:0}</style>
