<script setup lang="ts">
import ConsoleBreadcrumbs from './ConsoleBreadcrumbs.vue'
withDefaults(defineProps<{ breadcrumbs: {label:string;to?:string;icon?:string}[]; refreshing?:boolean; refreshDisabled?:boolean }>(),{refreshing:false})
const emit=defineEmits<{refresh:[]}>()
</script>
<template><div class="qisvc-console-toolbar flex min-h-16 items-center justify-between gap-3 border-b border-default px-4 lg:px-8"><div class="flex min-w-0 items-center gap-3"><UDashboardSidebarToggle icon="i-lucide-menu" aria-label="打开导航"/><UButton size="xs" square color="neutral" variant="ghost" icon="i-lucide-refresh-cw" aria-label="刷新当前页面" title="刷新当前页面" :loading="refreshing" :disabled="refreshing||refreshDisabled" @click="emit('refresh')"/><ConsoleBreadcrumbs :items="breadcrumbs"/></div><div class="flex shrink-0 items-center gap-2"><slot name="actions"/></div></div></template>

