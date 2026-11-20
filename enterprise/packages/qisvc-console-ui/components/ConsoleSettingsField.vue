<script setup lang="ts">
defineProps<{ label: string; inputId?: string }>()
</script>

<template>
  <div class="qisvc-console-settings-field">
    <label v-if="inputId" :for="inputId" class="qisvc-console-settings-label">{{ label }}</label>
    <span v-else class="qisvc-console-settings-label">{{ label }}</span>
    <div class="qisvc-console-settings-control"><slot /></div>
  </div>
</template>

<style scoped>
.qisvc-console-settings-field { --settings-control-height: 2rem; display: grid; grid-template-columns: 1fr; align-items: start; gap: .5rem; min-width: 0; }
.qisvc-console-settings-label { display: flex; align-items: center; min-height: var(--settings-control-height); font-size: .875rem; line-height: 1.25rem; color: var(--ui-text-muted); }
.qisvc-console-settings-control { display: flex; flex-direction: column; justify-content: center; min-width: 0; min-height: var(--settings-control-height); }
.qisvc-console-settings-control :deep(input:not([type="checkbox"]):not([type="radio"])) { height: var(--settings-control-height); }
.qisvc-console-settings-control :deep([data-slot="leadingIcon"]), .qisvc-console-settings-control :deep([data-slot="trailingIcon"]) { width: 1rem; height: 1rem; }
@media (min-width: 640px) {
  .qisvc-console-settings-field { grid-template-columns: var(--settings-label-width, 10rem) minmax(0, var(--settings-content-width, 32rem)); gap: 1.5rem; }
  .qisvc-console-settings-label { justify-content: flex-end; text-align: right; }
}
</style>
