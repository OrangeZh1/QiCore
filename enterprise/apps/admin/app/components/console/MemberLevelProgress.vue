<script setup lang="ts">
import type {LevelCriterion} from '../../../../api/src/core/decoration-types'
defineProps<{criteria:LevelCriterion[];caption?:string;growth?:number|null;emptyTarget?:string}>()
</script>
<template>
 <div class="level-progress">
  <div v-if="caption&&criteria.length>1" class="level-progress-caption">{{caption}}</div>
  <div v-for="criterion in criteria" :key="criterion.key" class="level-progress-item">
   <div class="level-progress-label"><span>{{criterion.label}}</span><span class="level-progress-number">{{criterion.currentText}} / {{criterion.targetText}}</span></div>
   <div class="level-progress-track" :role="criterion.percent===null?undefined:'progressbar'" :aria-label="criterion.label+' '+criterion.currentText+' / '+criterion.targetText" :aria-valuenow="criterion.percent??undefined" :aria-valuemin="0" :aria-valuemax="100"><div v-if="criterion.percent!==null" class="level-progress-fill" :style="{width:criterion.percent+'%'}"/></div>
  </div>
  <div v-if="!criteria.length" class="level-progress-item"><div class="level-progress-label"><span>成长值</span><span class="level-progress-number">{{growth==null?'—':growth.toLocaleString()}}{{emptyTarget==='已满级'?' · ':' / '}}{{emptyTarget||'未设置'}}</span></div><div class="level-progress-track" :aria-label="caption||'暂未设置升级门槛'"/></div>
 </div>
</template>
<style scoped>
.level-progress{color:var(--level-progress-ink,currentColor);line-height:1.5}.level-progress-caption{font-size:calc(var(--diy-unit,1px)*10);opacity:.85;overflow-wrap:anywhere;margin-bottom:calc(var(--diy-unit,1px)*5)}.level-progress-item{display:flex;align-items:center;flex-wrap:wrap;gap:calc(var(--diy-unit,1px)*8)}.level-progress-item+.level-progress-item{margin-top:calc(var(--diy-unit,1px)*6)}.level-progress-label{display:flex;align-items:center;flex-wrap:wrap;gap:calc(var(--diy-unit,1px)*4);max-width:100%;font-size:calc(var(--diy-unit,1px)*10.5);line-height:1.5}.level-progress-number{font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.level-progress-track{flex:1;min-width:calc(var(--diy-unit,1px)*40);height:calc(var(--diy-unit,1px)*3);border-radius:calc(var(--diy-unit,1px)*3);background:var(--level-progress-track,#e6eef9);overflow:hidden;transform:translateY(calc(var(--diy-unit,1px)*0.5))}.level-progress-fill{height:100%;border-radius:inherit;background:var(--level-progress-fill,#3479f6)}
</style>
