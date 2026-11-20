<script setup lang="ts">
import {ref,watch,computed} from 'vue'
const props=defineProps<{unitId:string}>(),failed=ref(false)
const validUnit=computed(()=>/^adunit-[a-zA-Z0-9]{8,64}$/.test(props.unitId)?props.unitId:'')
const emit=defineEmits<{visible:[value:boolean]}>()
watch(validUnit,value=>{failed.value=false;emit('visible',!!value)},{immediate:true})
</script>
<template>
 <!-- #ifdef MP-WEIXIN -->
 <view v-if="validUnit" v-show="!failed" class="native-banner"><ad :key="validUnit" :unit-id="validUnit" @load="failed=false;emit('visible',true)" @error="failed=true;emit('visible',false)"/></view>
 <!-- #endif -->
</template>
<style scoped>.native-banner{overflow:hidden}</style>
