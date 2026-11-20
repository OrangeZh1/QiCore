<script setup lang="ts">
withDefaults(defineProps<{ title?: string, description?: string }>(), {
  title: '加载失败',
  description: '请稍后重试。',
})
</script>

<template>
  <UAlert class="qisvc-console-error-state" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="title" :description="description">
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UAlert>
</template>
