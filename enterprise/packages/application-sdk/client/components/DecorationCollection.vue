<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import DecorationAction from './DecorationAction.vue'
import {computed,ref} from 'vue'
import {collectionItems} from '@qicore/application-sdk/browser/decoration-components.mjs'
import type {DecorationBlock,DecorationLink,DecorationApplicationComponent} from '@qicore/application-sdk/browser/decoration-types'
const props=defineProps<{block:DecorationBlock;component:DecorationApplicationComponent;images:Record<string,string>;query?:string}>()
const emit=defineEmits<{navigate:[target:DecorationLink]}>()
const items=computed(()=>collectionItems(props.block,props.component,props.query))
const left=ref(0)
let start:number|null=null,origin=0,maximum=0,moved=false
function measure(event:MouseEvent|KeyboardEvent){const element=event.currentTarget as HTMLElement;return Math.max(0,(element?.querySelector?.<HTMLElement>('.collection-items')?.scrollWidth||0)-(element?.clientWidth||0))}
function clamp(value:number){return Math.max(0,Math.min(maximum,value))}
function down(event:MouseEvent){if(event.button!==0)return;maximum=measure(event);left.value=clamp(left.value);start=event.clientX;origin=left.value;moved=false}
function move(event:MouseEvent){if(start===null)return;const delta=event.clientX-start;if(Math.abs(delta)>6)moved=true;if(moved){event.preventDefault();left.value=clamp(origin-delta)}}
function end(){start=null}
function step(event:KeyboardEvent,delta:number){maximum=measure(event);left.value=clamp(left.value+delta)}
function go(target:DecorationLink){if(moved){moved=false;return}emit('navigate',target)}
function scroll(event:{detail:{scrollLeft:number}}){left.value=event.detail.scrollLeft}
</script>
<template>
 <view class="collection qc-view">
  <view class="collection-heading qc-view"><view class="collection-heading-copy qc-view"><text class="collection-title qc-text">{{block.title}}</text><text v-if="block.text" class="collection-description qc-text">{{block.text}}</text></view><DecorationAction as-button :target="block.target" v-if="block.target&&block.options?.showMore!==false" role="button" @click="go(block.target)">{{block.options?.moreText||'查看全部'}} <text aria-hidden="true" class="qc-text">›</text></DecorationAction></view>
  <scroll-view enhanced v-if="items.length" class="collection-scroll qc-scroll-view" scroll-x :show-scrollbar="false" :scroll-left="left" @scroll="scroll" @mousedown="down" @mousemove="move" @mouseup="end" @mouseleave="end" @keydown.left.prevent="step($event,-144)" @keydown.right.prevent="step($event,144)" tabindex="0" :aria-label="block.title">
   <view class="collection-items qc-view"><DecorationAction as-button :target="item.target" v-for="item in items" :key="item.id" role="button" root-class="collection-item" :root-style="{width:(block.options?.collectionWidth||71)*2+'rpx'}" @click="go(item.target)"><image v-if="item.image&&images[item.image]" class="collection-photo qc-image" :style="{width:((block.options?.collectionWidth||71)-12)*2+'rpx',height:(block.options?.collectionImageHeight||77)*2+'rpx'}" :src="images[item.image]" mode="aspectFill" aria-label="示例图片"/><text class="item-title qc-text">{{item.title}}</text><text class="item-description qc-text">{{item.text}}</text></DecorationAction></view>
  </scroll-view>
  <view v-else class="collection-empty qc-view" role="status">{{component.emptyText}}</view>
  <text v-if="component.note" class="collection-note qc-text">{{component.note}}</text>
 </view>
</template>
<style scoped>
.collection{color:inherit;text-align:left}.collection-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16rpx;margin-bottom:28rpx}.collection-title{display:block;font-size:32rpx;font-weight:650;line-height:1.5}.collection-description{display:block;margin-top:6rpx;font-size:24rpx;color:var(--client-muted,#64748b);line-height:1.6}.collection .decoration-action-button{margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:1.5}.collection .decoration-action-button::after{border:0}.collection-heading .decoration-action-button{flex-shrink:0;white-space:nowrap;font-size:24rpx;color:var(--client-muted,#64748b);padding:6rpx 0}.collection-heading .decoration-action-button .qc-text{font-size:30rpx;margin-left:4rpx}.collection-scroll{width:100%;white-space:nowrap;cursor:grab}.collection-items{display:flex;gap:20rpx;padding:2rpx 0 8rpx}.collection .collection-item{display:flex;flex-shrink:0;flex-direction:column;width:244rpx;padding:24rpx;box-sizing:border-box;white-space:normal;text-align:left;border:2rpx solid #e7edf5;border-radius:20rpx;background:var(--client-background,#f5f7fb);user-select:none}.collection-item:active{border-color:var(--client-primary,#2563eb)}.item-title{font-size:28rpx;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}.item-description{font-size:23rpx;margin-top:8rpx;white-space:nowrap;color:var(--client-muted,#64748b)}.collection-note{display:block;font-size:21rpx;line-height:1.6;color:var(--client-muted,#64748b);margin-top:20rpx;white-space:normal}.collection-empty{padding:40rpx 0;font-size:26rpx;color:var(--client-muted,#64748b)}
.collection-title{font-size:32rpx}.collection-heading{margin-bottom:18rpx}.collection .collection-item{width:142rpx;padding:0;border:0;border-radius:0;background:transparent;align-items:center;text-align:center}.collection-photo{display:block;width:118rpx;max-width:100%;height:154rpx;padding:0;border:0;border-radius:0;box-sizing:border-box;background:transparent;margin-bottom:10rpx}.item-title{font-size:25rpx}.item-description{font-size:20rpx;margin-top:4rpx}.collection-items{gap:16rpx}.collection-note{font-size:18rpx;margin-top:14rpx}.collection-heading .decoration-action-button{font-size:24rpx}.collection-heading{align-items:center}.collection-heading-copy{display:flex;align-items:baseline;gap:16rpx;min-width:0;flex:1}.collection-title{flex-shrink:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.collection-description{display:block;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:22rpx;line-height:1.5;color:var(--client-muted,#8090a4)}</style>
