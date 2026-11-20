<script setup lang="ts">
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
const props=withDefaults(defineProps<{url:string;label?:string;allowOpen?:boolean}>(),{label:'访问地址',allowOpen:true})
const copying=ref(false),toast=useToast();let disposed=false
onBeforeUnmount(()=>{disposed=true})
async function copy(){if(copying.value||!props.url)return;copying.value=true;try{await navigator.clipboard.writeText(props.url);if(!disposed)toast.add({title:'链接已复制',color:'success'})}catch{if(!disposed)toast.add({title:'复制失败，请手动复制链接',color:'error'})}finally{if(!disposed)copying.value=false}}
</script>
<template><div class="console-access-link"><ConsoleInput :model-value="url" :aria-label="label" readonly placeholder="暂无可用地址"/><UButton color="neutral" variant="outline" icon="i-lucide-copy" :loading="copying" :disabled="copying||!url" @click="copy">复制</UButton><UButton v-if="allowOpen" :to="url||undefined" external target="_blank" rel="noopener noreferrer" color="neutral" variant="outline" icon="i-lucide-external-link" :disabled="!url" :aria-label="'打开'+label"/></div></template>
<style scoped>.console-access-link{display:flex;align-items:center;gap:10px;min-width:0;width:100%}.console-access-link>:first-child{flex:1;min-width:0}.console-access-link>button,.console-access-link>a{flex-shrink:0;white-space:nowrap}@media(max-width:500px){.console-access-link{gap:6px}}</style>
