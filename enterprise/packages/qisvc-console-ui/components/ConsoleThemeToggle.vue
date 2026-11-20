<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useColorMode } from '#imports'

const colorMode = useColorMode()
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const label = computed(() => !mounted.value ? '切换颜色模式' : colorMode.value === 'dark' ? '切换浅色模式' : '切换深色模式')
</script>

<template>
  <UColorModeButton color="neutral" variant="ghost" size="xs" square class="qisvc-console-theme-toggle" :aria-label="label" :title="label" />
</template>

<style scoped>
.qisvc-console-theme-toggle { position: relative; display: inline-grid; place-items: center; width: 2rem; height: 2rem; padding: 0; gap: 0; border-radius: var(--radius-md); }
.qisvc-console-theme-toggle :deep(:is(.iconify, svg, [data-slot="leadingIcon"])) { width: 1rem; height: 1rem; }
.qisvc-console-theme-toggle { transition: background-color 160ms ease, color 160ms ease, transform 160ms ease; }
.qisvc-console-theme-toggle:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) {
  .qisvc-console-theme-toggle { transition: none; }
  .qisvc-console-theme-toggle:active { transform: none; }
}
</style>
