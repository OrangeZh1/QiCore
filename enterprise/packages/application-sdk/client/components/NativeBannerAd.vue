<script setup lang="ts">
import {ref,watch} from 'vue'
const props=defineProps<{unitId:string}>(),failed=ref(false)
const emit=defineEmits<{visible:[value:boolean]}>()
watch(()=>props.unitId,()=>{failed.value=false;emit('visible',true)},{immediate:true})
</script>
<template>
 <!-- #ifdef MP-WEIXIN -->
 <view v-if="unitId" v-show="!failed" class="native-banner"><ad :key="unitId" :unit-id="unitId" @load="failed=false;emit('visible',true)" @error="failed=true;emit('visible',false)"/></view>
 <!-- #endif -->
</template>
<style scoped>.native-banner{overflow:hidden}</style>
