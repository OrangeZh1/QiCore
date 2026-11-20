<script setup lang="ts">
import type {LevelCriterion} from '@qicore/application-sdk/browser/decoration-types'
defineProps<{criteria:LevelCriterion[];caption?:string;growth?:number|null;emptyTarget?:string}>()
</script>
<template>
 <view class="level-progress">
  <view v-if="caption&&criteria.length>1" class="level-progress-caption">{{caption}}</view>
  <view v-for="criterion in criteria" :key="criterion.key" class="level-progress-item">
   <view class="level-progress-label"><text>{{criterion.label}}</text><text class="level-progress-number">{{criterion.currentText}} / {{criterion.targetText}}</text></view>
   <view class="level-progress-track" :role="criterion.percent===null?undefined:'progressbar'" :aria-label="criterion.label+' '+criterion.currentText+' / '+criterion.targetText" :aria-valuenow="criterion.percent??undefined" :aria-valuemin="0" :aria-valuemax="100"><view v-if="criterion.percent!==null" class="level-progress-fill" :style="{width:criterion.percent+'%'}"/></view>
  </view>
  <view v-if="!criteria.length" class="level-progress-item"><view class="level-progress-label"><text>成长值</text><text class="level-progress-number">{{(growth??0).toLocaleString()}}{{emptyTarget==='已满级'?' · ':' / '}}{{emptyTarget||'未设置'}}</text></view><view class="level-progress-track" :aria-label="caption||'暂未设置升级门槛'"/></view>
 </view>
</template>
<style scoped>
.level-progress{color:var(--level-progress-ink,currentColor);line-height:1.5}.level-progress-caption{font-size:20rpx;opacity:.85;overflow-wrap:anywhere;margin-bottom:10rpx}.level-progress-item{display:flex;align-items:center;flex-wrap:wrap;gap:16rpx}.level-progress-item+.level-progress-item{margin-top:12rpx}.level-progress-label{display:flex;align-items:center;flex-wrap:wrap;gap:8rpx;max-width:100%;font-size:21rpx;line-height:1.5}.level-progress-number{font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.level-progress-track{flex:1;min-width:80rpx;height:6rpx;border-radius:6rpx;background:var(--level-progress-track,#e6eef9);overflow:hidden;transform:translateY(1rpx)}.level-progress-fill{height:100%;border-radius:inherit;background:var(--level-progress-fill,#3479f6)}
</style>
