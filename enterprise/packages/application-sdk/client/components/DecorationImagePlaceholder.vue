<script setup lang="ts">
import DecorationNiuIcon from './DecorationNiuIcon.vue'
withDefaults(defineProps<{compact?:boolean;size?:number}>(),{compact:false,size:28})
</script>
<template><view class="image-placeholder" role="img" aria-label="请选择图片"><view class="image-placeholder-icon" :style="{fontSize:size*2+'rpx'}"><DecorationNiuIcon name="image"/></view><text v-if="!compact" class="image-placeholder-label">请选择图片</text></view></template>
<style scoped>.image-placeholder{display:flex;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;align-items:center;justify-content:center;flex-direction:column;gap:12rpx;overflow:hidden;background:#f3f5f8;color:#98a5b8}.image-placeholder>.image-placeholder-icon{flex-shrink:0}.image-placeholder>.image-placeholder-label{font-size:22rpx;line-height:1.4;color:#7d8ba0;white-space:nowrap}</style>
