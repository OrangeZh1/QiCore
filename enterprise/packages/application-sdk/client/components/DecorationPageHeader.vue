<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import DecorationAction from './DecorationAction.vue'
import ClientSearchField from './ClientSearchField.vue'
import {navigationLayout,navigationFrame} from '../lib/navigation-layout'
import {computed,ref,watch,onMounted,onBeforeUnmount} from 'vue'
import type {DecorationPage,DecorationLink,DecorationTheme} from '@qicore/application-sdk/browser/decoration-types'
import {decorationHeader} from '@qicore/application-sdk/browser/decoration-contract.mjs'
import {decorationIconUrl} from '@qicore/application-sdk/browser/decoration-framework.mjs'
const props=defineProps<{page:DecorationPage;images:Record<string,string>;immersive?:boolean;theme?:DecorationTheme;query?:string}>()
const emit=defineEmits<{navigate:[target:DecorationLink];search:[query:string]}>()
const header=computed(()=>decorationHeader(props.page)),layout=ref(navigationLayout())
const topPadding=computed(()=>{
 const padding=navigationFrame(layout.value,import.meta.env.UNI_PLATFORM==='h5').paddingTop
 // Canvas copy height: 15 × 1.35 + 9 × 1.5 + 1 = 34.75 design px (69.5rpx).
 // Shift the entire H5 row so its first title line matches standalone navigation titles.
 return import.meta.env.UNI_PLATFORM==='h5'&&header.value.mode==='search'&&header.value.subtitle&&(header.value.brandName||!header.value.imageId)?'calc('+padding+' + max(0px, (69.5rpx - var(--client-header-title-size,18px) * 1.4) / 2))':padding
})
const capsuleInset=computed(()=>layout.value.rightSpace),inputQuery=ref(props.query||'')
const searchControl=ref<{height:number;top:number}|null>(null)
const searchStyle=computed(()=>searchControl.value?{'--client-search-height':searchControl.value.height+'px',marginTop:searchControl.value.top+'px',alignSelf:'flex-start'}:{})
const brandStyle=computed(()=>searchControl.value&&header.value.mode==='search'?{transform:'translateY('+(searchControl.value.top+searchControl.value.height/2-layout.value.rowHeight/2)+'px)'}:{})
watch(()=>props.query,value=>{inputQuery.value=value||''})
function update(){
 // #ifdef MP-WEIXIN
 let windowInfo:ReturnType<typeof uni.getWindowInfo>|undefined
 try{
  windowInfo=uni.getWindowInfo();const menu=uni.getMenuButtonBoundingClientRect();layout.value=navigationLayout(windowInfo,menu)
  searchControl.value=menu.width>0&&menu.height>0&&menu.left>0&&menu.left<windowInfo.windowWidth&&menu.top>=layout.value.statusBar?{height:menu.height,top:menu.top-layout.value.statusBar}:{height:32,top:(layout.value.rowHeight-32)/2}
 }catch{layout.value=navigationLayout(windowInfo);searchControl.value={height:32,top:(layout.value.rowHeight-32)/2}}
 // #endif
}
update();onMounted(()=>uni.onWindowResize(update));onBeforeUnmount(()=>uni.offWindowResize(update))
</script>
<template>
 <view v-if="page.showHeader" class="diy-page-header qc-view" :class="{immersive,'has-search':header.mode==='search'}" :style="{paddingTop:topPadding,background:header.background,color:header.color}">
  <view class="diy-header-row qc-view" :class="{'is-search':header.mode==='search'}" :style="{paddingRight:capsuleInset>20?capsuleInset+'px':'var(--client-page-gutter, 10px)',height:layout.rowHeight+'px'}">
   <view v-if="header.mode==='title'" class="diy-header-title qc-view" :style="{textAlign:header.align,paddingLeft:header.align==='center'&&capsuleInset>20?'calc('+capsuleInset+'px - var(--client-page-gutter, 10px))':'0'}">{{page.title}}</view>
   <template v-else-if="header.mode==='brand'||header.mode==='search'"><DecorationAction :target="header.target" :root-class="['diy-header-brand',{'has-brand-name':!!header.brandName}]" :root-style="brandStyle"  @click="$emit('navigate',header.target)"><image v-if="header.imageId" :src="images[header.imageId]" mode="aspectFit" class="qc-image"/><view class="diy-brand-copy qc-view"><text v-if="header.brandName||!header.imageId" class="diy-brand-name qc-text">{{header.brandName||page.title}}</text><text v-if="header.mode==='search'&&header.subtitle" class="diy-header-subtitle qc-text">{{header.subtitle}}</text><text v-else-if="header.mode==='brand'&&header.text" class="diy-header-subtitle qc-text">{{header.text}}</text></view></DecorationAction><ClientSearchField v-if="header.mode==='search'&&header.searchInput" v-model="inputQuery" root-class="diy-header-input" compact :root-style="searchStyle" :placeholder="header.text||'搜索关键词'" :label="header.text||'搜索关键词'" @confirm="$emit('search',$event)"/><DecorationAction v-else-if="header.mode==='search'" :target="header.searchTarget" root-class="diy-header-search" :style="searchStyle" @click="$emit('navigate',header.searchTarget)"><image :src="decorationIconUrl('search',true)" mode="aspectFit" class="qc-image"/><text class="qc-text">{{header.text||'搜索关键词'}}</text></DecorationAction></template>
   <DecorationAction :target="header.target" v-else root-class="diy-header-location" @click="$emit('navigate',header.target)"><image :src="decorationIconUrl('map-pin',true)" mode="aspectFit" class="qc-image"/><text class="qc-text">{{header.text||'选择位置'}}</text><image :src="decorationIconUrl('chevron-right',true)" mode="aspectFit" class="qc-image"/></DecorationAction>
  </view>
  <view v-if="header.subtitle&&header.mode!=='search'" class="diy-header-description qc-view">{{header.subtitle}}</view>
 </view>
 <!-- #ifdef MP-WEIXIN -->
 <view v-else :style="{height:layout.totalHeight+'px'}" class="qc-view"/>
 <!-- #endif -->
</template>
<style scoped>
.diy-page-header{position:relative;z-index:25;box-sizing:border-box}.diy-page-header.immersive{position:absolute;top:0;left:0;right:0}.diy-header-row{height:88rpx;display:flex;align-items:center;gap:24rpx;padding-left:var(--client-page-gutter, 10px);box-sizing:border-box;font-size:var(--client-header-title-size,18px)}.diy-header-title{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.diy-header-brand{display:flex;align-items:center;gap:18rpx;flex:1;min-width:0;max-width:100%;text-align:left}.diy-header-brand .qc-image{width:188rpx;height:60rpx;flex-shrink:0}.diy-header-brand.has-brand-name .qc-image{width:68rpx;height:68rpx}
.diy-brand-copy{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-width:0;gap:0;text-align:left}.diy-brand-copy>.qc-text{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.diy-brand-name{font-size:var(--client-header-title-size,18px);line-height:40rpx;font-weight:600}.diy-header-subtitle{font-size:22rpx;line-height:28rpx;font-weight:400;opacity:.65}
.is-search .diy-header-brand{flex:0 1 auto;max-width:40%}.is-search .diy-header-brand.has-brand-name .qc-image{width:56rpx;height:56rpx}.diy-header-search{display:flex;align-items:center;gap:12rpx;flex:1;min-width:0;border:1px solid #e2e8f0;border-radius:36rpx;height:60rpx;padding:0 20rpx;font-size:22rpx;opacity:.7}.diy-header-search .qc-image,.diy-header-location .qc-image{width:28rpx;height:28rpx;flex-shrink:0}.diy-header-search .qc-text,.diy-header-location .qc-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.diy-header-location{display:flex;align-items:center;gap:12rpx;min-width:0;font-size:26rpx}
.is-search{gap:16rpx}.is-search .diy-header-brand{flex:0 0 auto;max-width:45%}.is-search .diy-brand-name{font-size:28rpx;line-height:1.4;font-weight:700}.diy-header-search.has-input{opacity:1;gap:10rpx;padding:0 14rpx;background:#fff;height:58rpx}.has-input .qc-button{display:flex;align-items:center;justify-content:center;margin:0;padding:0;width:28rpx;height:48rpx;border:0;background:none;flex-shrink:0}.has-input .qc-button::after{border:0}.has-input .qc-image{opacity:.55}.has-input .qc-input{width:0;flex:1;min-width:0;margin:0;padding:0;border:0;background:transparent;height:52rpx;font-size:22rpx}.diy-header-description{padding:0 var(--client-page-gutter, 10px) 14rpx;margin-top:-4rpx;color:var(--client-muted,#728096);font-size:20rpx;line-height:1.5;text-align:left}.is-search .diy-header-brand{max-width:45%}.is-search .diy-brand-name{font-size:var(--client-header-title-size,18px);line-height:1.35}.is-search .diy-header-subtitle{font-size:18rpx;line-height:1.5;margin-top:2rpx;color:var(--client-muted,#728096);opacity:1}.diy-page-header.has-search{padding-bottom:var(--client-content-top, 16px)}.diy-header-search.has-input{height:58rpx;background:#fff;border-color:#e3e9f1}
/* Keep search on the brand row and inside its measured capsule inset. */
.diy-header-row.is-search .diy-header-input{min-width:0;flex:1}

.diy-header-row.is-search .diy-brand-name{font-size:30rpx;line-height:1.35}
.diy-header-row.is-search .diy-header-subtitle{color:inherit;opacity:.65}
.diy-header-search{height:var(--client-search-height,60rpx)}

</style>
