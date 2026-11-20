<script setup lang="ts">
import ConsoleInput from './ConsoleInput.vue'

defineProps<{ label: string; disabled?: boolean }>()
const start = defineModel<string>('start', { default: '' })
const end = defineModel<string>('end', { default: '' })
</script>

<template>
  <div role="group" :aria-label="label" class="qisvc-console-date-range flex w-full flex-wrap items-center gap-2 sm:w-auto">
    <span class="shrink-0 text-sm text-muted">{{ label }}</span>
    <div class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:w-80 sm:flex-none">
      <ConsoleInput v-model="start" type="date" :disabled="disabled" :aria-label="`${label}开始`" :max="end || undefined" />
      <span class="text-sm text-muted">至</span>
      <ConsoleInput v-model="end" type="date" :disabled="disabled" :aria-label="`${label}结束`" :min="start || undefined" />
    </div>
  </div>
</template>
