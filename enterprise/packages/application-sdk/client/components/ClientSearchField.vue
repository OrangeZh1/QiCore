<script setup lang="ts">
import {computed,type StyleValue} from 'vue'
defineOptions({inheritAttrs:false,options:{virtualHost:true}})
const props=withDefaults(defineProps<{modelValue:string;placeholder?:string;label?:string;maxlength?:number;compact?:boolean;rootClass?:unknown;rootStyle?:StyleValue}>(),{placeholder:'搜索名称或尺寸',label:'搜索名称或尺寸',maxlength:64,compact:false})
const emit=defineEmits<{ 'update:modelValue':[value:string];confirm:[value:string] }>()
const icon=computed(()=>(import.meta.env.UNI_PLATFORM==='h5'?'/h5-assets':'')+'/static/decoration/framework/icons/search'+(props.compact?'':'-blue')+'.svg')
function input(event:Event|{detail:{value:string}}){const value=(event as {detail?:{value?:string}}).detail?.value;emit('update:modelValue',value??('target' in event?(event.target as HTMLInputElement|null)?.value:'')??'')}
</script>
<template>
 <view class="client-search-field qc-view" :class="[rootClass,{compact}]" :style="rootStyle">
  <button role="button" :aria-label="label" @click="$emit('confirm',modelValue)" class="qc-button"><image :src="icon" mode="aspectFit" aria-hidden="true" class="qc-image"/></button>
  <input :value="modelValue" :maxlength="maxlength" :placeholder="placeholder" :aria-label="label" confirm-type="search" @input="input" @confirm="$emit('confirm',modelValue)" class="qc-input"/>
 </view>
</template>
<style scoped>
.client-search-field{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:44px;padding:0 12px;box-sizing:border-box;border:1px solid #e3eaf3;border-radius:22px;background:#fff}
.client-search-field .qc-button{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:19px;min-height:32px;margin:0;padding:0;border:0;background:transparent;color:var(--client-primary,#246bfa);font:inherit;line-height:1.5}
.client-search-field .qc-button::after{border:0}.client-search-field .qc-button:focus-visible{outline:2px solid var(--client-primary,#246bfa);outline-offset:2px}
.client-search-field .qc-image{width:19px;height:19px;flex-shrink:0}
.client-search-field .qc-input{flex:1;min-width:0;width:0;height:30px;margin:0;padding:0;border:0;border-radius:0;background:transparent;font-size:13px}
@media(max-width:350px){.client-search-field{padding-inline:10px;gap:6px}.client-search-field .qc-input{font-size:12px}}
.client-search-field.compact{height:var(--client-search-height,60rpx);padding:0 20rpx;gap:12rpx;border-color:#e2e8f0;border-radius:36rpx;background:transparent;opacity:.7}
.compact .qc-button{width:22rpx;min-height:0;height:100%}.compact .qc-image{width:22rpx;height:22rpx}
.compact .qc-input{height:100%;font-size:22rpx;line-height:1.5}
</style>
