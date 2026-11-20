<script setup lang="ts">
import {computed} from 'vue'
import {isH5,money} from '../lib/api'
import type {PaymentMethod} from '../lib/wallet'
const props=withDefaults(defineProps<{modelValue:string;balanceCents?:number|null;allowBalance?:boolean;disabled?:boolean;methods?:PaymentMethod[]}>(),{balanceCents:null,allowBalance:true,disabled:false})
const emit=defineEmits<{ 'update:modelValue':[value:string] }>()
const labels:Record<string,string>={balance:'余额支付',wechat:'微信支付',alipay:'支付宝','wechat-virtual':'微信支付'}
const choices=computed(()=>props.methods===undefined?[...(props.allowBalance?[{id:'balance',label:labels.balance,available:true,reason:''}]:[]),{id:'wechat',label:labels.wechat,available:true,reason:''},{id:'alipay',label:labels.alipay,available:true,reason:''}]:props.methods.filter(item=>Object.prototype.hasOwnProperty.call(labels,item.provider)&&(props.allowBalance||item.provider!=='balance')).map(item=>({id:item.provider,label:labels[item.provider],available:item.available,reason:item.reason||''})))
const asset=(path:string)=>(isH5?'/h5-assets':'')+'/static/'+path
</script>
<template>
 <view class="payment-methods" role="radiogroup" aria-label="支付方式">
  <view v-for="choice in choices" :key="choice.id" class="method-line">
   <button role="radio" :aria-label="choice.label" :aria-checked="modelValue===choice.id" :aria-disabled="disabled||!choice.available" :disabled="disabled||!choice.available" class="method-option" @click="emit('update:modelValue',choice.id)">
    <view class="method-icon" :class="choice.id"><image :src="asset(choice.id==='balance'?'decoration/framework/icons/wallet-blue.svg':['wechat','wechat-virtual'].includes(choice.id)?'payments/wechat-pay.png':'payments/alipay.svg')" mode="aspectFit"/></view>
    <view class="method-copy"><text class="method-name">{{choice.label}}</text><text v-if="choice.id==='balance'" class="method-caption">可用余额 ¥{{money(balanceCents??0)}}</text><text v-if="choice.reason" class="method-caption">{{choice.reason}}</text></view>
    <view class="method-radio" :class="{checked:modelValue===choice.id}" aria-hidden="true">{{modelValue===choice.id?'✓':''}}</view>
   </button>
  </view>
 </view>
</template>
<style scoped>
.payment-methods{width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}.method-line{position:relative;display:flex;align-items:center;gap:12px}.method-line+.method-line{border-top:1px solid #f0f3f8}.payment-methods .method-option{box-sizing:border-box;display:flex;align-items:center;gap:12px;flex:1;min-width:0;min-height:64px;margin:0;padding:12px 30px 12px 0;border:0;border-radius:0;background:transparent;color:var(--client-text, #1e293b);text-align:left;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.payment-methods button::after{border:0}.method-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;flex-shrink:0}.method-icon image{width:25px;height:25px}.method-icon.balance{background:var(--client-primary-soft, #edf4ff)}.method-icon.wechat,.method-icon.wechat-virtual,.method-icon.alipay{background:transparent}.method-icon.wechat image,.method-icon.wechat-virtual image,.method-icon.alipay image{width:30px;height:30px}.method-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}.method-name{font-size:14px;font-weight:500}.method-caption{font-size:11px;color:#8a99ae}.method-radio{position:absolute;right:0;top:50%;transform:translateY(-50%);box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0;width:19px;height:19px;border:1.5px solid #d7dfeb;border-radius:50%;font-size:12px;line-height:1;color:#fff}.method-radio.checked{background:var(--client-primary, #2563eb);border-color:var(--client-primary, #2563eb)}.method-option:focus-visible{outline:2px solid var(--client-primary-border, #9bbcff);outline-offset:-2px}
</style>
