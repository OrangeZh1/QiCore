<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
withDefaults(defineProps<{modelValue:'orders'|'after-sales';orders?:boolean}>(),{orders:true})
const emit=defineEmits<{'update:modelValue':[value:'orders'|'after-sales']}>()
function select(value:string|number){if(value==='orders'||value==='after-sales')emit('update:modelValue',value)}
</script>
<template><ConsolePageHeading title="订单管理"/><UTabs :model-value="modelValue" :items="[...(orders?[{label:'订单',value:'orders'}]:[]),{label:'售后',value:'after-sales'}]" :content="false" variant="link" :ui="{trigger:'cursor-pointer'}" aria-label="订单管理" @update:model-value="select"/></template>
