<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import DecorationAction from './DecorationAction.vue'
import {computed,ref} from 'vue'
import type {DecorationBlock,DecorationLink} from '@qicore/application-sdk/browser/decoration-types'
import {decorationOptions,visibleDecorationItems} from '@qicore/application-sdk/browser/decoration-options.mjs'
import DecorationDots from './DecorationDots.vue'
const props=defineProps<{block:DecorationBlock;images:Record<string,string>;indicators?:boolean;variant?:'peek'|'normal'|'full'}>()
const emit=defineEmits<{navigate:[target:DecorationLink];current:[index:number]}>(),current=ref(0),o=computed(()=>decorationOptions(props.block)),items=computed(()=>visibleDecorationItems(props.block))
function change(event:{detail:{current:number}}){current.value=event.detail.current;emit('current',current.value)}
</script>
<template><view class="diy-banner qc-view" :class="variant"><swiper :style="{height:block.height*2+'rpx'}" :current="current" :previous-margin="variant==='peek'?'26rpx':'0px'" :next-margin="variant==='peek'?'26rpx':'0px'" :autoplay="o.autoplay&&items.length>1" :interval="o.interval" :duration="o.duration" :circular="items.length>1" @change="change" class="qc-swiper"><swiper-item v-for="(item,index) in items" :key="item.id" class="qc-swiper-item"><DecorationAction :target="item.target" root-class="decoration-image-action" @click="$emit('navigate',item.target)"><image class="diy-slide qc-image" :class="{inactive:variant==='peek'&&current!==index}" :style="{borderRadius:o.imageRadiusTop*2+'rpx '+o.imageRadiusTop*2+'rpx '+o.imageRadiusBottom*2+'rpx '+o.imageRadiusBottom*2+'rpx'}" :src="item.imageId&&images[item.imageId]?images[item.imageId]:images[item.builtin||'']||'/static/decoration/image-placeholder.svg'" mode="scaleToFill" :aria-label="item.label" /></DecorationAction></swiper-item></swiper><DecorationDots v-if="indicators" class="banner-dots" :count="items.length" :current="current" :options="o" @select="current=$event"/></view></template>
<style scoped>.diy-banner{position:relative;overflow:hidden}.diy-slide{width:100%;height:100%;transition:transform .3s}.diy-slide.inactive{transform:scale(.92)}.banner-dots{position:absolute;bottom:0;left:0;right:0}.normal{margin:0 20rpx}</style>

<style scoped>.decoration-image-action{display:block;width:100%;height:100%;line-height:0}</style>
