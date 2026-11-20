<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount,onActivated,watch,nextTick} from 'vue'
import {useColorMode} from '#imports'
import {init,use,type EChartsType} from 'echarts/core'
import {LineChart} from 'echarts/charts'
import {GridComponent,TooltipComponent,AriaComponent,LegendComponent} from 'echarts/components'
import {CanvasRenderer} from 'echarts/renderers'
use([LineChart,GridComponent,TooltipComponent,AriaComponent,LegendComponent,CanvasRenderer])
type Point={day:string;total:number}
const props=withDefaults(defineProps<{data:Point[];label?:string;unit?:string;unitPlacement?:'axis'|'legend';comparison?:{label:string;unit:string;data:Point[]}}>(),{label:'平台活跃',unit:'次',unitPlacement:'axis'})
const container=ref<HTMLElement|null>(null),mode=useColorMode()
const description=computed(()=>props.data.map(d=>d.day+'：'+props.label+' '+d.total+' '+props.unit+(props.comparison?'，'+props.comparison.label+' '+(props.comparison.data.find(v=>v.day===d.day)?.total??'无数据')+' '+props.comparison.unit:'')).join('；'))
let chart:EChartsType|undefined,observer:ResizeObserver|undefined
const safe=(value:unknown)=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!))
function axisMaximum(values:number[]){
 const peak=Math.max(0,...values),step=Math.max(1,peak/5),magnitude=10**Math.floor(Math.log10(step))
 const interval=([1,2,3,5,10].find(value=>value*magnitude>=step)??10)*magnitude
 return Math.max(5,Math.ceil(peak/interval)*interval)
}
function render(){
 if(!chart)return
 const legendUnits=props.unitPlacement==='legend'
 const dark=mode.value==='dark',text=dark?'#94a3b8':'#64748b',border=dark?'#273449':'#e7edf5'
 const series=[{name:props.label,unit:props.unit,values:props.data.map(d=>d.total),color:'#3b82f6'}]
 if(props.comparison)series.push({name:props.comparison.label,unit:props.comparison.unit,values:props.data.map(d=>props.comparison!.data.find(v=>v.day===d.day)?.total??0),color:'#06b6d4'})
 chart.setOption({
  animation:false,aria:{enabled:true,description:description.value},
  grid:{left:48,right:props.comparison?48:22,top:legendUnits?44:64,bottom:35},
  legend:{show:!!props.comparison||legendUnits,formatter:(name:string)=>{const item=series.find(item=>item.name===name);return legendUnits&&item?.unit?`${name}（${item.unit}）`:name},top:4,left:0,selectedMode:true,icon:'roundRect',itemWidth:16,itemHeight:3,itemGap:24,textStyle:{color:text,fontSize:12}},
  tooltip:{trigger:'axis',confine:true,backgroundColor:dark?'#182235':'#ffffff',borderColor:border,textStyle:{color:dark?'#e2e8f0':'#334155',fontSize:13},
   axisPointer:{type:'line',lineStyle:{color:'#94a3b8',type:'dashed'}},
   formatter:(input:unknown)=>{const rows=input as {axisValueLabel:string;seriesName:string;value:unknown;seriesIndex:number;marker:string}[];return safe(rows[0]?.axisValueLabel||'')+rows.map(row=>'<div style="display:flex;gap:20px;justify-content:space-between;margin-top:8px"><span>'+row.marker+safe(row.seriesName)+'</span><b>'+safe(row.value)+' '+safe(series[row.seriesIndex]?.unit||'')+'</b></div>').join('')}
  },
  xAxis:{type:'category',boundaryGap:false,data:props.data.map(d=>d.day.slice(5).replace('-','/')),axisLine:{lineStyle:{color:border}},axisTick:{show:false},axisLabel:{color:text,fontSize:11,hideOverlap:true,margin:12}},
  // Keep each scale based on its full data, even when the legend hides its series.
  yAxis:series.map((item,index)=>({type:'value',name:legendUnits?'':item.unit,nameTextStyle:{color:item.color,fontSize:11},position:index===0?'left':'right',max:index===1?Math.max(5,Math.ceil(Math.max(0,...item.values)/5)*5):axisMaximum(item.values),min:0,minInterval:1,splitNumber:5,axisLabel:{color:text,fontSize:11},splitLine:{show:index===0,lineStyle:{color:border}}})),
  series:series.map((item,index)=>({name:item.name,type:'line',yAxisIndex:index,smooth:0.3,smoothMonotone:'x',data:item.values,symbol:index===0?'emptyCircle':'emptyDiamond',symbolSize:6,itemStyle:{color:item.color},lineStyle:{color:item.color,width:2.5,type:index===0?'solid':'dashed'},areaStyle:index===0?{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(59,130,246,0.13)'},{offset:1,color:'rgba(59,130,246,0.01)'}]}}:undefined}))
 },true)
}
onMounted(()=>{if(!container.value)return;chart=init(container.value);render();observer=new ResizeObserver(()=>chart?.resize());observer.observe(container.value)})
watch([()=>props.data,()=>props.label,()=>props.unit,()=>props.unitPlacement,()=>props.comparison,()=>mode.value],render,{deep:true})
onActivated(async()=>{await nextTick();chart?.resize()})
onBeforeUnmount(()=>{observer?.disconnect();chart?.dispose()})
</script>
<template><div ref="container" class="qisvc-console-trend-chart" role="img" :aria-label="description" tabindex="0"/></template>
<style scoped>
.qisvc-console-trend-chart{width:100%;height:350px;min-width:0}@media(max-width:640px){.qisvc-console-trend-chart{height:290px}}
</style>

