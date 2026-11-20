<script setup lang="ts">
defineProps<{ items: { label: string; to?: string; icon?: string }[] }>()
</script>
<template><UBreadcrumb :items="items" class="qisvc-console-breadcrumbs min-w-0" /></template>

