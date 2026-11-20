<script lang="ts">
export default {options:{styleIsolation:'shared'}}
</script>
<script setup lang="ts">
import DecorationAction from './DecorationAction.vue'
import {computed} from 'vue'
import {decorationOptions} from '@qicore/application-sdk/browser/decoration-options.mjs'
import type {DecorationBlock,DecorationMember,DecorationLink} from '@qicore/application-sdk/browser/decoration-types'
import {decorationIconUrl} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import {memberCardContent,memberCardStyle,accountAssetItems,accountAssetStyle,decorationUnitStyle} from '@qicore/application-sdk/browser/decoration-components.mjs'
import ClientChevron from './ClientChevron.vue'
const props=defineProps<{merged?:boolean;block:DecorationBlock;member?:DecorationMember|null;editable?:boolean;primary:string;images:Record<string,string>}>()
const emit=defineEmits<{navigate:[target:DecorationLink]}>()
const card=computed(()=>memberCardContent(props.block,props.member)),assets=computed(()=>accountAssetItems(props.member,props.block))
const assetOptions=computed(()=>decorationOptions(props.block)),assetStyle=computed(()=>decorationUnitStyle(accountAssetStyle(props.block,props.primary),true))
const style=computed(()=>decorationUnitStyle(memberCardStyle(props.block,props.primary),true))
const icon=computed(()=>props.block.imageId?props.images[props.block.imageId]:!props.block.icon&&props.block.builtin?props.images[props.block.builtin]:(import.meta.env.UNI_PLATFORM==='h5'?'/h5-assets':'')+decorationIconUrl(props.block.icon||'crown',true).replace('.svg','-blue.svg'))
const assetIcon=(name:string)=>(import.meta.env.UNI_PLATFORM==='h5'?'/h5-assets':'')+decorationIconUrl(name,true)
function navigate(target:DecorationLink){if(!props.editable&&target)emit('navigate',target)}
</script>
<template>
 <view v-if="block.type==='assets'" class="account-assets qc-view" :class="['asset-layout-'+assetOptions.assetLayout,{'one-asset':assets.length===1,'is-merged':merged}]" :style="assetStyle">
  <view v-if="assetOptions.assetTitle" class="asset-heading qc-view"><text class="asset-heading-title qc-text">{{block.title||'我的资产'}}</text><text v-if="block.text" class="asset-heading-description qc-text">{{block.text}}</text></view>
  <view class="asset-grid qc-view"><DecorationAction as-button :target="asset.target" :native-disabled="editable" v-for="asset in assets" :key="asset.key" role="button" root-class="asset-entry" :aria-label="asset.action+'，'+asset.label+' '+asset.value" @click="navigate(asset.target)">
   <view class="asset-top qc-view"><view v-if="assetOptions.assetIcons" class="asset-icon-wrap qc-view"><image class="asset-icon qc-image" :src="assetIcon(asset.icon)" mode="aspectFit" aria-hidden="true"/></view><text class="asset-label qc-text">{{asset.label}}</text><text class="asset-chevron qc-text" aria-hidden="true"/></view>
   <view class="asset-amount qc-view"><text class="asset-value qc-text">{{asset.value}}</text></view>
   <view class="asset-recharge qc-view" :class="{'is-primary':asset.key==='points'}"><text class="qc-text">{{asset.action}}</text><image v-if="assetOptions.assetLayout==='strip'" class="asset-recharge-arrow qc-image" :src="assetIcon('chevron-right').replace('.svg','-blue.svg')" mode="aspectFit" aria-hidden="true"/></view>
  </DecorationAction></view>
 </view>
 <view v-else class="member-card qc-view" :class="{gold:block.options?.memberStyle==='gold','is-merged':merged}" :style="style">
  <view class="member-emblem qc-view"><image :src="icon" mode="aspectFit" :class="{'builtin-icon':!block.imageId&&!block.builtin}" class="qc-image"/></view>
  <view class="member-copy qc-view"><view class="member-title qc-view"><text class="qc-text">{{card.title}}</text><text v-if="member&&block.options?.showMemberStatus!==false" class="member-tag qc-text">{{card.levelName}}</text></view><view v-if="card.subtitle" class="member-description qc-view">{{card.subtitle}}</view></view>
  <DecorationAction as-button :target="card.target" :native-disabled="editable" role="button" root-class="member-action" @click="navigate(card.target)">{{card.action}}<image v-if="merged" class="member-link-arrow qc-image" :src="assetIcon('chevron-right').replace('.svg','-blue.svg')" mode="aspectFit" aria-hidden="true"/><ClientChevron v-else-if="block.options?.memberStyle!=='gold'"/></DecorationAction>
 </view>
</template>
<style scoped>
.member-card{display:flex;align-items:center;gap:16rpx;min-height:116rpx;padding:22rpx 24rpx;box-sizing:border-box;text-align:left;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.member-emblem{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:58rpx;height:58rpx;border-radius:18rpx;background:var(--member-soft)}.member-emblem .qc-image{width:32rpx;height:32rpx}.builtin-icon{filter:var(--member-icon-filter)}.member-copy{flex:1;min-width:0}.member-title{display:flex;align-items:center;flex-wrap:wrap;gap:8rpx;font-size:27rpx;font-weight:600;overflow-wrap:anywhere}.member-tag{padding:1rpx 6rpx;border:1rpx solid var(--member-line);border-radius:4rpx;color:var(--member-accent);font-size:17rpx;font-weight:400}.member-description{margin-top:6rpx;color:var(--member-muted);font-size:20rpx;line-height:1.6;overflow-wrap:anywhere}.member-card .member-action{display:flex;align-items:center;gap:4rpx;flex-shrink:0;margin:0;padding:12rpx 0;border:0;background:transparent;color:var(--member-accent);font:inherit;font-size:22rpx;line-height:1.5;white-space:nowrap}.member-action::after{border:0}.member-action:focus-visible{outline:2rpx solid var(--member-accent,var(--client-primary,#3479f6));outline-offset:4rpx}.gold.member-card{gap:16rpx;padding:20rpx;min-height:116rpx}.gold .member-emblem{background:transparent;width:72rpx;height:74rpx}.gold .member-emblem .qc-image{width:72rpx;height:74rpx}.gold .member-title{font-size:25rpx}.gold .member-description{margin-top:3rpx;font-size:20rpx;line-height:1.5}.gold .member-action{padding:12rpx 18rpx;border-radius:40rpx;background:var(--member-accent);color:white}.gold .member-action :deep(.client-chevron){display:none}.member-card.is-merged{min-height:120rpx;padding:28rpx 32rpx;gap:20rpx}.is-merged .member-emblem{width:60rpx;height:60rpx;border-radius:16rpx}.is-merged .member-emblem .qc-image{width:40rpx;height:40rpx}.is-merged .member-title{font-size:34rpx;gap:12rpx}.is-merged .member-tag{font-size:22rpx;line-height:1.5;padding:4rpx 12rpx;border:0;border-radius:10rpx;background:var(--member-soft)}.member-card.is-merged .member-action{font-size:26rpx;font-weight:500;gap:8rpx;padding:12rpx 0;background:transparent;color:var(--member-accent)}.member-link-arrow{display:block;width:32rpx;height:32rpx;object-fit:contain}
</style>

<style scoped>

.account-assets{padding:calc(var(--asset-unit)*16);color:var(--asset-text);box-sizing:border-box;text-align:left}
.asset-heading{margin-bottom:calc(var(--asset-unit)*14)}
.asset-heading-title{display:block;font-size:calc(var(--asset-unit)*15);font-weight:650;line-height:1.5;overflow-wrap:anywhere}
.asset-heading-description{display:block;margin-top:calc(var(--asset-unit)*4);font-size:var(--asset-label-size);color:var(--asset-muted);line-height:1.6;overflow-wrap:anywhere}
.asset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--asset-gap)}
.account-assets .asset-entry{display:flex;flex-direction:column;align-items:stretch;gap:calc(var(--asset-unit)*10);min-width:0;min-height:calc(var(--asset-unit)*96);margin:0;padding:calc(var(--asset-unit)*14);box-sizing:border-box;border:1px solid var(--asset-border);border-radius:var(--asset-radius);background:var(--asset-surface);color:var(--asset-text);font:inherit;line-height:1.5;text-align:left;cursor:pointer}
.asset-entry::after{border:0}.asset-entry:active{opacity:.8}.asset-entry:focus-visible{outline:2px solid var(--asset-accent);outline-offset:2px}
.asset-top{display:flex;align-items:center;gap:calc(var(--asset-unit)*7);min-width:0}
.asset-icon-wrap{display:flex;align-items:center;justify-content:center;width:calc(var(--asset-unit)*28);height:calc(var(--asset-unit)*28);flex-shrink:0;border-radius:calc(var(--asset-unit)*9);background:var(--asset-soft)}
.asset-icon{display:block;width:calc(var(--asset-unit)*17);height:calc(var(--asset-unit)*17);object-fit:contain}
.asset-label{flex:1;min-width:0;font-size:var(--asset-label-size);font-weight:500;color:var(--asset-muted);overflow-wrap:anywhere}
.asset-chevron{width:calc(var(--asset-unit)*5);height:calc(var(--asset-unit)*5);flex-shrink:0;border-top:1px solid var(--asset-accent);border-right:1px solid var(--asset-accent);transform:rotate(45deg);opacity:.7;margin-right:calc(var(--asset-unit)*2)}
.asset-amount{min-width:0;margin-top:calc(var(--asset-unit)*1)}
.asset-value{display:block;font-size:var(--asset-value-size);font-weight:700;font-variant-numeric:tabular-nums;line-height:1.25;letter-spacing:-.4px;overflow-wrap:anywhere;color:var(--asset-text)}
.asset-recharge{display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;width:100%;min-height:calc(var(--asset-unit)*32);box-sizing:border-box;padding:calc(var(--asset-unit)*6) calc(var(--asset-unit)*12);border:1px solid var(--asset-border);border-radius:calc(var(--asset-unit)*8);background:transparent;color:var(--asset-accent);font-size:calc(var(--asset-unit)*12);font-weight:600;line-height:1.5;white-space:nowrap}.asset-recharge.is-primary{border-color:var(--asset-accent);background:var(--asset-accent);color:#fff}.asset-layout-list .asset-recharge{width:auto;grid-column:2;justify-self:end;margin-top:calc(var(--asset-unit)*6)}
.one-asset .asset-grid,.asset-layout-list .asset-grid{grid-template-columns:minmax(0,1fr)}
.asset-layout-list .asset-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:calc(var(--asset-unit)*16);row-gap:0;min-height:calc(var(--asset-unit)*78)}
.asset-layout-list .asset-top{grid-column:1}.asset-layout-list .asset-amount{grid-column:2;grid-row:1;align-self:center;text-align:right;max-width:calc(var(--asset-unit)*175)}.asset-layout-list .asset-chevron{display:none}
.account-assets.asset-layout-strip{padding:calc(var(--asset-unit)*20) calc(var(--asset-unit)*22)}
.asset-layout-strip .asset-grid{gap:calc(var(--asset-unit)*44)}
.account-assets.asset-layout-strip .asset-entry{align-items:flex-start;gap:calc(var(--asset-unit)*8);padding:0;min-height:0;border:0;border-radius:0;background:transparent;text-align:left}
.asset-layout-strip .asset-top{justify-content:flex-start}.asset-layout-strip .asset-icon-wrap{width:calc(var(--asset-unit)*18);height:calc(var(--asset-unit)*18);background:transparent;border-radius:0}.asset-layout-strip .asset-label{flex:none}.asset-layout-strip .asset-chevron{display:none}
.asset-layout-strip .asset-amount{align-self:stretch;margin-top:0}
.account-assets.asset-layout-strip .asset-recharge{width:auto;min-height:calc(var(--asset-unit)*28);justify-content:flex-start;align-self:flex-start;gap:calc(var(--asset-unit)*4);padding:0;border:0;border-radius:0;background:transparent;color:var(--asset-accent);font-size:calc(var(--asset-unit)*13);font-weight:500}
.asset-recharge-arrow{display:block;flex-shrink:0;width:calc(var(--asset-unit)*14);height:calc(var(--asset-unit)*14);object-fit:contain}
</style>
