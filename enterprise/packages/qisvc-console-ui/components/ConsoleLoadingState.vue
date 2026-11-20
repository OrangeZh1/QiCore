<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: '正在载入数据…' })
</script>

<template>
  <div class="qisvc-console-loading-state grid min-h-64 place-items-center" role="status" aria-live="polite">
    <div class="qisvc-console-loading-pill flex items-center gap-3 rounded-full border border-default bg-default/90 px-4 py-2.5 text-sm text-muted shadow-sm">
      <UIcon name="i-lucide-loader-circle" class="qisvc-console-loading-icon size-5 text-primary" />
      <span>{{ label }}</span>
    </div>
  </div>
</template>
