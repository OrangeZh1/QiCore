<script setup lang="ts">
import TenantRecords from '../../components/tenant/TenantRecords.vue'
definePageMeta({layout:'tenant',key:route=>route.path})
</script>
<template><TenantRecords record-kind="transactions"/></template>
