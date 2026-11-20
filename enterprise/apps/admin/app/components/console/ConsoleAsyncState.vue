<script setup lang="ts">
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
defineProps<{label:string;failed?:boolean}>()
function reload(){if(import.meta.client)window.location.reload()}
</script>
<template>
 <ConsoleErrorState v-if="failed" :title="label+'加载失败'" description="当前内容已保留。请先保存修改，再重新加载页面。" class="my-3">
  <template #actions><UButton color="neutral" variant="outline" @click="reload">重新加载页面</UButton></template>
 </ConsoleErrorState>
 <div v-else class="flex min-h-20 items-center justify-center gap-2 text-sm text-muted" role="status" aria-live="polite"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin"/>正在加载{{label}}…</div>
</template>
