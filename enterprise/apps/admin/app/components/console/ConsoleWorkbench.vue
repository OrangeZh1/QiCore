<script setup lang="ts">
import ConsoleStatusCard from '@orangezh1/qisvc-console-ui/components/ConsoleStatusCard'
import {defineConsoleAsyncComponent} from '../../utils/async-component'
const ConsoleTrendChart=defineConsoleAsyncComponent(()=>import('@orangezh1/qisvc-console-ui/components/ConsoleTrendChart'),'趋势图')
const props=withDefaults(defineProps<{cards:{label:string;value?:number|string;icon:string;detail:string}[];data:{day:string;total:number}[];comparison:{label:string;unit:string;data:{day:string;total:number}[]};seriesLabel:string;trendTitle:string;activeLabel?:string;periodLabel?:string}>(),{activeLabel:'今日活跃',periodLabel:'期间操作'})
const slots=useSlots()
const total=computed(()=>props.data.reduce((sum,day)=>sum+day.total,0)),active=computed(()=>props.comparison.data.at(-1)?.total??0)
</script>
<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2" :class="cards.length===9?'xl:grid-cols-3':'xl:grid-cols-4'"><ConsoleStatusCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value??0" :icon="card.icon">{{card.detail}}</ConsoleStatusCard></div>
  <slot name="after-cards"/>
  <div class="workbench-analysis" :class="{'without-aside':!slots.aside,'with-secondary':!!slots['secondary-trend']}"><slot name="aside"/><UCard class="workbench-trend" :ui="{body:'p-3 sm:p-5'}"><template #header><div class="workbench-section-title"><div><p class="mb-1 text-xs text-muted">近 15 日</p><h2>{{trendTitle}}</h2></div><div class="trend-summary"><span>{{periodLabel}} <b>{{total.toLocaleString()}}</b> 次</span><span>{{activeLabel}} <b>{{active}}</b> {{comparison.unit}}</span></div></div></template><ConsoleTrendChart :data="data" :label="seriesLabel" unit="次" unit-placement="legend" :comparison="comparison"/></UCard><slot name="secondary-trend"/></div>
</template>
<style scoped>
.workbench-analysis{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:stretch}@media(min-width:1280px){.workbench-analysis{grid-template-columns:repeat(4,minmax(0,1fr))}.workbench-trend{grid-column:span 3}}
.workbench-trend{width:100%;max-width:none}.workbench-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.workbench-section-title h2{font-size:16px;font-weight:600}.trend-summary{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px 20px;font-size:11px;color:var(--ui-text-muted)}.trend-summary b{font-size:15px;font-weight:600;color:var(--ui-text-highlighted);margin:0 3px}
.workbench-analysis.without-aside{grid-template-columns:minmax(0,1fr)}.without-aside .workbench-trend{grid-column:auto}
.workbench-analysis.with-secondary{grid-template-columns:minmax(0,1fr)}.with-secondary .workbench-trend{grid-column:auto}.with-secondary :deep(.qisvc-console-trend-chart){height:280px}@media(min-width:1280px){.workbench-analysis.with-secondary{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
