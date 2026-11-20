<template>
  <div class="qisvc-console-list-filters flex w-full flex-wrap items-center gap-3">
    <slot />
    <slot name="search" />
  </div>
</template>

<style scoped>
.qisvc-console-list-filters :deep(input),
.qisvc-console-list-filters :deep(button) {
  height: 2rem;
  font-size: 0.875rem;
}
.qisvc-console-list-filters :deep(button[role='combobox']) {
  width: 13rem;
  max-width: 100%;
}
@media (max-width: 639px) {
  .qisvc-console-list-filters :deep(button[role='combobox']) { width: 100%; }
}
</style>
