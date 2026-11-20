<script setup lang="ts">
defineProps<{image?:string|null;name:string;badge?:string}>()
</script>
<template><div class="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated/30"><img v-if="image" :src="image" :alt="name+'封面'" class="size-full rounded-lg object-contain"/><UIcon v-else name="i-lucide-package" class="size-6 text-muted" :aria-label="name+'未设置封面'"/><span v-if="badge" class="absolute right-0 top-0 max-w-full truncate rounded-bl-md bg-primary px-1.5 py-0.5 text-[10px] leading-4 text-inverted" :title="badge">{{badge}}</span></div></template>
