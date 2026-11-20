<script setup lang="ts">
withDefaults(defineProps<{ icon?: string, title: string, description?: string, compact?: boolean }>(), {
  icon: 'i-lucide-inbox',
  description: '',
  compact: false,
})
</script>

<template>
  <div class="qisvc-console-empty-state flex flex-col items-center px-6 text-center" :class="compact ? 'py-8' : 'py-14'" :data-compact="compact || undefined">
    <span class="qisvc-console-empty-icon grid size-12 place-items-center rounded-xl bg-elevated text-muted">
      <UIcon :name="icon" class="size-5" />
    </span>
    <h2 class="mt-4 font-semibold text-highlighted">{{ title }}</h2>
    <p v-if="description" class="mt-1 max-w-md text-sm leading-6 text-muted">{{ description }}</p>
    <div v-if="$slots.actions || $slots.default" class="mt-5">
      <slot name="actions"><slot /></slot>
    </div>
  </div>
</template>
