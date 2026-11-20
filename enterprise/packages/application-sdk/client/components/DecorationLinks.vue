<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import DecorationAction from './DecorationAction.vue'
import {computed,ref,watch} from 'vue'
import type {DecorationBlock,DecorationLink} from '@qicore/application-sdk/browser/decoration-types'
import {decorationOptions,navigationPages,navigationRows,visibleDecorationItems,navigationContentStyle} from '@qicore/application-sdk/browser/decoration-options.mjs'
import DecorationLinkItems from './DecorationLinkItems.vue'
import DecorationDots from './DecorationDots.vue'
import {decorationUnitStyle} from '@qicore/application-sdk/browser/decoration-components.mjs'
const props=defineProps<{block:DecorationBlock;images:Record<string,string>}>()
defineEmits<{navigate:[target:DecorationLink]}>()
const current=ref(0),o=computed(()=>decorationOptions(props.block)),pages=computed(()=>navigationPages(props.block)),cards=computed(()=>o.value.navStyle==='tiles'),list=computed(()=>props.block.appearance?.layout==='list'),paged=computed(()=>!cards.value&&!list.value&&o.value.navDisplay==='pages')
const height=computed(()=>((o.value.navMode==='text'?0:o.value.iconSize)+(o.value.navMode==='image'?0:o.value.labelSize*1.5)+(o.value.navMode==='graphic'?8:0)+16)*o.value.navRows+14)
watch(pages,()=>{current.value=0})
</script>
<template><view class="decoration-graphic-nav qc-view" :style="decorationUnitStyle(navigationContentStyle(block),true)" :class="{'has-card-nav':cards,'has-title':!!block.title}"><view v-if="block.title" class="nav-section-title qc-view"><text class="qc-text">{{block.title}}</text><DecorationAction as-button :target="o.moreTarget" v-if="o.showMore&&o.moreTarget" role="button" @click="$emit('navigate',o.moreTarget)">{{o.moreText}}<image src="/static/decoration/chevron-right.svg" mode="aspectFit" class="qc-image"/></DecorationAction></view><template v-if="paged"><swiper :current="current" :style="{height:height*2+'rpx'}" @change="current=$event.detail.current" class="qc-swiper"><swiper-item v-for="(items,index) in pages" :key="index" class="qc-swiper-item"><DecorationLinkItems :block="block" :items="items" :images="images" @navigate="$emit('navigate',$event)"/></swiper-item></swiper><DecorationDots :count="pages.length" :current="current" :options="o" @select="current=$event"/></template><template v-else-if="!cards&&!list&&o.navDisplay==='scroll'&&o.navRows===2"><DecorationLinkItems v-for="(items,index) in navigationRows(block)" :key="index" :block="{...block,options:{...block.options,navRows:1}}" :items="items" :images="images" @navigate="$emit('navigate',$event)"/></template><DecorationLinkItems v-else :block="block" :items="visibleDecorationItems(block)" :images="images" @navigate="$emit('navigate',$event)"/></view></template>

<style scoped>
.nav-section-title{display:flex;align-items:center;justify-content:space-between;gap:24rpx;margin:0;padding:var(--nav-heading-top,32rpx) var(--nav-content-x,32rpx) 8rpx;font-size:32rpx;font-weight:600;text-align:left;line-height:1.5;overflow-wrap:anywhere}.nav-section-title>.qc-text{min-width:0;flex:1}.nav-section-title>.decoration-action-button{display:flex;align-items:center;gap:8rpx;flex-shrink:0;white-space:nowrap;min-height:48rpx;padding:0;margin:0;border:0;background:transparent;color:#768193;font:inherit;font-size:24rpx;font-weight:400;line-height:1.5}.nav-section-title .decoration-action-button::after{border:0}.nav-section-title .qc-image{width:18rpx;height:22rpx}.has-title :deep(.link-cards){padding-top:24rpx}
</style>
