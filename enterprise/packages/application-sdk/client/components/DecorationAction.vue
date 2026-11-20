<script setup lang="ts">
import {computed,inject,useAttrs,type ComputedRef,type StyleValue} from 'vue'
import {customerServiceOpenType} from '@qicore/application-sdk/browser/customer-service.mjs'
import type {CustomerServiceConfig,DecorationLink} from '@qicore/application-sdk/browser/decoration-types'
// Native callers enable mergeVirtualHostAttributes; keep one native root so scoped classes reach it.
defineOptions({inheritAttrs:false,options:{virtualHost:true}})
const props=defineProps<{target?:DecorationLink;disabled?:boolean;nativeDisabled?:boolean;asButton?:boolean;rootClass?:unknown;rootStyle?:StyleValue}>()
const emit=defineEmits<{click:[event:Event]}>()
const attrs=useAttrs()
const settings=inject<ComputedRef<CustomerServiceConfig|undefined>>('qicore-customer-service',computed(()=>undefined))
const openType=computed(()=>props.nativeDisabled?undefined:customerServiceOpenType(props.target,settings.value,import.meta.env.UNI_PLATFORM))
function click(event:Event){if(!props.disabled&&!openType.value)emit('click',event)}
function keyboard(event:Event){if(!attrs.onKeydown)click(event)}
function failed(){if(openType.value)uni.showToast({title:'暂时无法打开客服，请稍后重试',icon:'none'})}
</script>
<template>
 <!-- #ifdef H5 -->
 <button v-if="asButton" v-bind="attrs" class="decoration-action-button qc-button" :class="rootClass" :style="rootStyle" :open-type="openType" :disabled="disabled" @click="click" @error="failed"><slot/></button><view v-else v-bind="attrs" :class="[rootClass,{'decoration-contact-host':!!openType}]" :style="rootStyle" :role="openType?undefined:'button'" :tabindex="openType?undefined:disabled?-1:0" :aria-disabled="disabled" @click="click" @keydown.enter.prevent="keyboard" @keydown.space.prevent="keyboard" class="qc-view"><slot/><button v-if="openType" class="decoration-contact-trigger qc-button" :open-type="openType" :disabled="disabled" aria-label="联系客服" @click.stop @error="failed"/></view>
 <!-- #endif -->
 <!-- #ifndef H5 -->
 <view :class="[rootClass,{'decoration-action-button':asButton,'decoration-contact-host':!!openType}]" :style="rootStyle" aria-role="button" :aria-label="String(attrs['aria-label']||'')" :aria-disabled="disabled" hover-class="none" @click="click" class="qc-view decoration-native-action"><slot/><button v-if="openType" class="decoration-contact-trigger qc-button" :open-type="openType" :disabled="disabled" aria-label="联系客服" @click.stop @error="failed"/></view>
 <!-- #endif -->
</template>
<style scoped>
.decoration-native-action{-webkit-tap-highlight-color:transparent}
.decoration-action-button{margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:inherit;text-align:inherit}.decoration-action-button::after{border:0}.decoration-contact-host{position:relative}.decoration-contact-trigger{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;z-index:2}.decoration-contact-trigger::after{border:0}
</style>
