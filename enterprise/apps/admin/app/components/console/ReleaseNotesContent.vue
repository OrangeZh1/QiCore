<script setup lang="ts">
import {releaseNoteLines,releasePresentation} from '../../utils/update-center'
const props=withDefaults(defineProps<{notes:string;component?:'framework'|'application';miniProgramUpdateRequired?:boolean;limit?:number}>(),{component:'application',miniProgramUpdateRequired:undefined})
const release=computed(()=>releasePresentation({releaseNotes:props.notes,miniProgramUpdateRequired:props.miniProgramUpdateRequired},props.component))
const lines=computed(()=>{const rows=releaseNoteLines(props.notes);if(!props.limit)return rows;let count=0;return rows.filter(row=>{if(row.text.trim())count++;return count<=props.limit!})})
const color=(tag:string)=>tag==='新增'?'info':tag==='修复'?'success':tag==='优化'?'warning':tag==='安全'?'error':'neutral'
</script>
<template><div class="space-y-3"><UAlert v-if="release.miniProgramUpdateRequired===true" color="warning" title="小程序需要客户自行上传" description="服务端更新后，请重新构建并上传发布小程序。"/><UAlert v-else-if="release.miniProgramUpdateRequired===false&&component==='application'" color="neutral" title="本次小程序无需更新"/><div v-for="(line,index) in lines" :key="index" class="flex min-w-0 items-start gap-3 text-sm leading-7"><UBadge v-if="line.tag" :color="color(line.tag)" class="mt-1 shrink-0" variant="subtle">{{line.tag}}</UBadge><p class="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]" :class="{'font-semibold':line.heading,'min-h-4':!line.text}">{{line.text}}</p></div><p v-if="!notes" class="text-sm text-muted">此版本未提供更新说明。</p></div></template>
