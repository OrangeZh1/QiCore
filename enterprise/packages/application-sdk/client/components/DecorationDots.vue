<script setup lang="ts">
import type {DecorationOptions} from '@qicore/application-sdk/browser/decoration-types'
defineProps<{count:number;current:number;options:Required<DecorationOptions>}>()
defineEmits<{select:[index:number]}>()
</script>
<template><view v-if="count>1" class="diy-dots" :class="options.indicatorStyle" :style="{justifyContent:options.indicatorAlign==='left'?'flex-start':options.indicatorAlign==='right'?'flex-end':'center'}"><text v-if="options.indicatorStyle==='fraction'" class="diy-fraction">{{current+1}} / {{count}}</text><view v-for="n in options.indicatorStyle==='fraction'?0:count" :key="n" class="diy-dot" :class="{active:n-1===current}" :style="{background:n-1===current?options.indicatorActiveColor:options.indicatorColor}" @click="$emit('select',n-1)"/></view></template>
<style scoped>.diy-dots{display:flex;gap:8px;align-items:center;padding:10px 14px}.diy-dot{width:6px;height:6px;border-radius:5px}.bars .diy-dot{width:9px;height:3px}.diy-fraction{border-radius:12px;background:#0005;color:white;padding:2px 8px;font-size:10px;line-height:16px}.elongated .diy-dot{width:5px;height:5px;border-radius:6px}.elongated .diy-dot.active{width:16px}</style>
