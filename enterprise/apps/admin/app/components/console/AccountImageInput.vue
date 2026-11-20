<script setup lang="ts">
import MaterialPicker from './MaterialPicker.vue'
import ImageSelectTile from './ImageSelectTile.vue'
const props=withDefaults(defineProps<{label:string;disabled?:boolean;fallback?:string;purpose?:'account'|'tenant'|'profile';fit?:'cover'|'contain';imageSize?:number;imageShape?:'square'|'banner';clearToFallback?:boolean;portal?:'admin'|'tenant';endpoint?:string}>(),{disabled:false,fallback:'/brand/admin-avatar.png',purpose:'account',fit:'cover',imageSize:256,clearToFallback:false,portal:'admin',endpoint:'/admin/materials'})
const value=defineModel<string|null>({default:null}),open=ref(false),busy=ref(false),cleared=ref(false),error=ref('')
const previewSrc=computed(()=>value.value||(!cleared.value?props.fallback:null))
watch(value,next=>{if(next)cleared.value=false})
function clear(){value.value=null;cleared.value=!props.clearToFallback;error.value=''}
const emit=defineEmits<{busy:[value:boolean]}>()
function pending(next:boolean){if(busy.value===next)return;busy.value=next;emit('busy',next)}
function choose(){if(!props.disabled&&!busy.value){error.value='';open.value=true}}
function selected(result:{value?:string}){if(!result.value){error.value='图片选择失败，请重新选择';return}value.value=result.value;error.value=''}
</script>
<template><div class="space-y-2"><ImageSelectTile :src="previewSrc" :label="label" :fit="fit" :disabled="disabled||busy" :removable="!!previewSrc" :remove-disabled="clearToFallback&&!value" :remove-title="clearToFallback&&!value?'当前使用默认图片，可通过修改设置自定义图片':''" @select="choose" @remove="clear"/><p class="text-xs text-muted">从素材库选择，或在素材库上传图片</p><p v-if="error" role="alert" class="text-xs text-error">{{error}}</p><MaterialPicker v-model:open="open" :purpose="purpose" :portal="portal" :endpoint="endpoint" :image-fit="fit" :image-size="imageSize" :image-shape="imageShape" kind="image" @busy="pending" @select="selected"/></div></template>
