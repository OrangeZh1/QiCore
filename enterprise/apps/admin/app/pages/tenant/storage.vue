<script setup lang="ts">
import StorageSettings from '../../components/console/StorageSettings.vue'
definePageMeta({layout:'tenant'})
const {tenantId}=useTenantContext()
</script>
<template><StorageSettings :key="tenantId" :site-id="tenantId"/></template>
