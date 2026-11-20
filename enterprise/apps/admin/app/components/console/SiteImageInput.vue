<script setup lang="ts">
import MaterialPicker from './MaterialPicker.vue'
import ImageSelectTile from './ImageSelectTile.vue'
const props=defineProps<{label:string;kind:'icon'|'logo'|'login'|'avatar';fallback?:string|null;disabled?:boolean}>()
const model=defineModel<string|null>({default:null}),open=ref(false),busy=ref(false),cleared=ref(false)
const previewSrc=computed(()=>model.value||(!cleared.value?props.fallback:null))
watch(model,value=>{if(value)cleared.value=false})
function clear(){model.value=null;cleared.value=true}
const emit=defineEmits<{busy:[value:boolean]}>()
function pending(value:boolean){busy.value=value;emit('busy',value)}
</script>
<template><div class="space-y-2"><ImageSelectTile :src="previewSrc" :label="label" :disabled="disabled||busy" :removable="!!previewSrc" @select="open=true" @remove="clear"/><p class="text-xs leading-5 text-muted">JPG / PNG / WebP{{kind==='login'?'；保留图片比例':'；建议使用方形图片'}}</p><MaterialPicker v-model:open="open" purpose="site" kind="image" :site-kind="kind" @busy="pending" @select="model=$event.value||null"/></div></template>
