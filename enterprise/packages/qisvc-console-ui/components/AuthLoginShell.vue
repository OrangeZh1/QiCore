<script setup lang="ts">
withDefaults(defineProps<{ title: string, description: string, icon?: string }>(), { icon: 'i-lucide-shield-check' })
</script>
<template><main class="grid min-h-screen place-items-center bg-elevated px-4 py-12"><UCard class="surface-card w-full max-w-md"><div class="text-center"><slot name="brand" /><div class="mx-auto mt-8 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><UIcon :name="icon" class="size-7" /></div><h1 class="mt-5 text-2xl font-semibold text-highlighted">{{ title }}</h1><p class="mt-2 text-sm leading-6 text-muted">{{ description }}</p></div><div class="mt-8"><slot /></div><div v-if="$slots.footer" class="mt-5 text-center text-xs text-muted"><slot name="footer" /></div></UCard></main></template>
