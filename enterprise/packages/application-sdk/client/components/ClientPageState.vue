<script setup lang="ts">
import {computed} from 'vue'
import {isH5} from '../lib/api'
import {frameworkAsset} from '@qicore/application-sdk/browser/decoration-framework.mjs'

const props=withDefaults(defineProps<{title:string;description:string;actionLabel?:string;loading?:boolean;disabled?:boolean;kind?:'login'|'error'|'empty'}>(),{actionLabel:'去登录',loading:false,disabled:false,kind:'login'})
defineEmits<{action:[]}>()
const icon=computed(()=>(isH5?'/h5-assets':'')+frameworkAsset('icons/'+(props.kind==='error'?'refresh-cw-blue':props.kind==='empty'?'file-text-blue':'user-round-blue')+'.svg',true))
</script>

<template>
 <view class="client-page-state qc-view" :role="kind==='error'?'alert':'status'">
  <view class="state-icon qc-view"><image :src="icon" mode="aspectFit" aria-hidden="true" class="qc-image"/></view>
  <view class="state-title qc-view" role="heading" aria-level="2">{{title}}</view>
  <view class="state-description qc-view">{{description}}</view>
  <button v-if="actionLabel" class="state-action qc-button" :class="{'is-disabled':disabled||loading}" role="button" :loading="loading" :disabled="disabled||loading" :aria-busy="loading" :aria-disabled="disabled||loading" @click="$emit('action')">{{actionLabel}}</button>
  <slot/>
 </view>
</template>

<style scoped>
.client-page-state{box-sizing:border-box;width:100%;max-width:360px;margin:0 auto;padding:56px 20px 40px;color:var(--client-text,#203450);text-align:center;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}
.state-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;margin:0 auto 20px}
.state-icon .qc-image{display:block;width:40px;height:40px;opacity:.65}
.state-title{font-size:17px;font-weight:500;line-height:1.5;overflow-wrap:anywhere}
.state-description{margin:8px auto 24px;max-width:280px;color:var(--client-muted,#718198);font-size:13px;line-height:1.75;overflow-wrap:anywhere}
.client-page-state .state-action{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:160px;max-width:100%;min-height:44px;margin:0 auto;padding:10px 20px;border:0;border-radius:10px;background:var(--client-primary,#3479f6);color:#fff;font:500 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}
.state-action::after{border:0}
.client-page-state .state-action.is-disabled{opacity:1;background:var(--client-primary-disabled,#9bbcff);color:#fff}
.state-action:focus-visible{outline:2px solid var(--client-primary,#3479f6);outline-offset:3px}
@media(max-width:350px){.client-page-state{padding:44px 12px 32px}.state-title{font-size:16px}}
</style>
