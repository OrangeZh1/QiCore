<script setup lang="ts">
defineOptions({inheritAttrs:false})
withDefaults(defineProps<{loading?:boolean;kind?:'search'|'reset'}>(),{loading:false,kind:'search'})
</script>
<template><UButton v-bind="$attrs" :icon="kind==='reset'?'i-lucide-rotate-ccw':'i-lucide-search'" :loading="loading" :ui="{base:loading?'disabled:opacity-100':''}"><slot/></UButton></template>
