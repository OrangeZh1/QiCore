<script setup lang="ts">
defineProps<{ title: string, description?: string }>()
</script>

<template>
  <header class="qisvc-console-page-heading flex min-w-0 max-w-full flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0 space-y-1">
      <h1 class="qisvc-console-page-heading-title text-2xl font-semibold tracking-tight text-highlighted">{{ title }}</h1>
      <p v-if="description" class="qisvc-console-page-heading-description text-sm leading-6 text-muted">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="qisvc-console-page-heading-actions flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
