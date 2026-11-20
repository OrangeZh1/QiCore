<script setup lang="ts">
import ClientMaintenanceNotice from './ClientMaintenanceNotice.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {clientNavigationInk} from '../lib/client-theme'
import {navigationLayout,navigationFrame} from '../lib/navigation-layout'

const props=withDefaults(defineProps<{ title?: string; background?:string; ink?:string; back?: boolean; inset?: boolean; overlay?: boolean; compact?:boolean; fallback?:string;backAction?:()=>void;backDisabled?:boolean }>(), { title: '', back: false, inset: false, overlay: false, compact:false, fallback:'/pages/profile/index' })
const isWeb=import.meta.env.UNI_PLATFORM==='h5'
const layout = ref(navigationLayout())
const compactWeb=computed(()=>isWeb&&props.compact&&!props.back)
const frameStyle = computed(() => ({...navigationFrame(layout.value,isWeb),...(compactWeb.value?{height:'auto'}:{}),background:props.overlay?'transparent':props.background||'var(--client-page-background, #f3f9ff)',color:props.ink||(props.overlay?'#ffffff':clientNavigationInk.value) }))
const rowStyle = computed(() => ({ height: `${compactWeb.value?26:layout.value.rowHeight}px`, paddingRight:layout.value.rightSpace>20?`${layout.value.rightSpace}px`:'var(--client-page-gutter, 10px)' }))
function update() {
  // #ifdef MP-WEIXIN
  let windowInfo: ReturnType<typeof uni.getWindowInfo> | undefined
  try {
    windowInfo = uni.getWindowInfo()
    layout.value = navigationLayout(windowInfo, uni.getMenuButtonBoundingClientRect())
  } catch {
    layout.value = navigationLayout(windowInfo)
  }
  // #endif
}
update()
onMounted(() => { update(); uni.onWindowResize(update) })
onBeforeUnmount(() => uni.offWindowResize(update))
function goBack() {
  if(props.backDisabled)return
  if(props.backAction){props.backAction();return}
  const home = () => uni.reLaunch({ url: props.fallback })
  if (getCurrentPages().length > 1) uni.navigateBack({ fail: home })
  else home()
}
</script>

<template>
  <view class="app-navigation qc-view" :class="{ inset, overlay, 'has-back':back, 'is-web':isWeb }" :style="frameStyle">
    <view class="app-navigation-row qc-view" :style="rowStyle">
      <button v-if="back" class="plain app-navigation-back qc-button" role="button" tabindex="0" hover-class="none" aria-label="返回上一页" :disabled="backDisabled" @click="goBack" @keydown.enter="goBack"><view class="app-navigation-back-icon qc-view" aria-hidden="true"/></button>
      <view class="app-navigation-content qc-view"><slot><text class="app-navigation-title qc-text">{{ title }}</text></slot></view>
    </view>
  </view>
<ClientMaintenanceNotice/></template>

<style scoped>
.qc-button{box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;font:inherit;line-height:1.5}.qc-button::after{border:0}
.app-navigation { box-sizing: border-box; width: 100%; flex-shrink: 0; transition:background-color 400ms ease,color 400ms ease; }
.app-navigation.inset { width:calc(100% + var(--client-page-gutter, 10px) * 2);margin-left:calc(-1 * var(--client-page-gutter, 10px));margin-right:calc(-1 * var(--client-page-gutter, 10px)); }
.app-navigation-row { box-sizing: border-box; display: flex; align-items: center; gap:8px;padding-left:var(--client-page-gutter, 10px); }
.app-navigation-content { flex: 1; min-width: 0; }
.app-navigation-title { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size:var(--client-header-title-size,18px); line-height: 1.4; font-weight: 700; }
.app-navigation-back { display: flex; align-items: center; justify-content: center; width:44px;height:44px; flex-shrink: 0; color:inherit; }
.app-navigation-back-icon { width: 16rpx; height: 16rpx; border-left: 3rpx solid currentColor; border-bottom: 3rpx solid currentColor; transform: rotate(45deg); }
.overlay .app-navigation-title { color: #fff; text-shadow: 0 1px 4px #0008; }
.overlay .app-navigation-back { width: 64rpx; height: 64rpx; border-radius: 50%; background: #ffffffe6; color:#203450; }
.app-navigation.is-web.has-back .app-navigation-content{padding-right:52px;text-align:center}</style>
