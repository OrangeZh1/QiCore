<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value: string | number
  icon?: string
  tone?: 'primary' | 'info' | 'success' | 'warning' | 'error' | 'neutral'
}>(), { icon: undefined, tone: 'primary' })
</script>

<template>
  <UCard class="qisvc-console-status-card qisvc-surface-card surface-card group">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="qisvc-console-status-label text-xs text-muted">{{ label }}</p>
        <p class="qisvc-console-status-value mt-2 text-3xl font-semibold tracking-tight text-highlighted">{{ value }}</p>
      </div>
      <span v-if="icon" class="qisvc-console-status-icon grid size-10 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-110" :data-tone="tone">
        <UIcon :name="icon" class="size-5" />
      </span>
    </div>
    <div v-if="$slots.default" class="qisvc-console-status-detail mt-3 text-xs text-muted"><slot /></div>
  </UCard>
</template>
