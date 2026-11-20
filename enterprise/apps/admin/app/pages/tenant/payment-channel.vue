<script setup lang="ts">
import TenantPaymentSettings from '../../components/tenant/TenantPaymentSettings.vue'
definePageMeta({path:'/admin/payments/:provider(wechat|alipay|wechat-virtual)',layout:'tenant',key:route=>route.path,middleware:to=>{if(to.params.provider==='wechat-virtual')return navigateTo({path:'/admin/payments/wechat',query:{...to.query,tab:to.query.tab==='config'?'virtual':to.query.tab||'virtual'},hash:to.hash},{replace:true,redirectCode:301})}})
const route=useRoute()
const provider=computed(()=>route.params.provider as 'wechat'|'alipay'|'wechat-virtual')
</script>
<template><TenantPaymentSettings :initial-provider="provider"/></template>
