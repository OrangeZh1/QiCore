<script setup lang="ts">
import {ref,watch} from 'vue'
const props=defineProps<{modelValue:string;label:string;placeholder?:string;disabled?:boolean;autocomplete?:string}>()
const emit=defineEmits<{'update:modelValue':[value:string];confirm:[]}>(),visible=ref(false)
const asset=(name:string)=>(import.meta.env.UNI_PLATFORM==='h5'?'/h5-assets':'')+'/static/auth/'+name
watch(()=>props.modelValue,value=>{if(!value)visible.value=false});watch(()=>props.disabled,value=>{if(value)visible.value=false})
function input(event:Event){const value=(event as Event&{detail?:{value?:unknown}}).detail?.value;if(typeof value==='string')emit('update:modelValue',value)}
</script>
<template><view class="password-control"><input class="password-input" :value="modelValue" :password="!visible" :aria-label="label" :placeholder="placeholder" :disabled="disabled" :maxlength="128" :autocomplete="autocomplete" confirm-type="done" @input="input" @confirm="emit('confirm')"/><button role="button" class="password-toggle" :disabled="disabled" :aria-label="(visible?'隐藏':'显示')+label" :aria-pressed="visible" @click="visible=!visible"><image class="password-icon" :src="asset(visible?'eye-slashed.png':'eye-open.png')" mode="aspectFit"/></button></view></template>
<style scoped>.password-control{display:flex;align-items:center;flex:1;min-width:0;width:0;gap:12rpx}.password-input{box-sizing:border-box;flex:1;min-width:0;width:0;height:96rpx;padding:0;border:0;border-radius:0;background:transparent;font-size:28rpx;color:#203450}.password-toggle{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:72rpx;min-width:44px;min-height:44px;margin:0 -8rpx 0 0;padding:0;background:transparent;border:0}.password-toggle::after{border:0}.password-icon{width:34rpx;height:34rpx}</style>
