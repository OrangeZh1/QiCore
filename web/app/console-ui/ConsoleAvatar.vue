<script setup lang="ts">
defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ src?: string | null; fallbackSrc?: string; icon?: string }>(), { icon: 'i-lucide-user-round' })
</script>

<template>
  <UAvatar v-bind="$attrs" :src="src || fallbackSrc || undefined" :icon="icon">
    <template v-if="$slots.default" #default><slot /></template>
  </UAvatar>
</template>
