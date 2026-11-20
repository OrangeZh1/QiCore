<script setup lang="ts">
withDefaults(defineProps<{compact?:boolean;size?:number}>(),{compact:false,size:28})
</script>
<template><div class="image-placeholder" role="img" aria-label="请选择图片"><UIcon name="i-lucide-image" :style="{fontSize:'calc(var(--diy-unit, 1px) * '+size+')'}"/><span v-if="!compact">请选择图片</span></div></template>
<style scoped>.image-placeholder{display:flex;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;align-items:center;justify-content:center;flex-direction:column;gap:calc(var(--diy-unit,1px)*6);overflow:hidden;background:#f3f5f8;color:#98a5b8}.image-placeholder>.iconify{flex-shrink:0}.image-placeholder>span{font-size:calc(var(--diy-unit,1px)*11);line-height:1.4;color:#7d8ba0;white-space:nowrap}</style>
