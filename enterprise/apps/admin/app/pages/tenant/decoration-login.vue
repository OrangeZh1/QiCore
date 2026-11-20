<script setup lang="ts">
import TenantConsumerSettings from '../../components/tenant/TenantConsumerSettings.vue'
definePageMeta({layout:'tenant',key:route=>route.path})
</script>
<template><TenantConsumerSettings section="appearance"/></template>
