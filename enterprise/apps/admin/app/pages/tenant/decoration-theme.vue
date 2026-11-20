<script setup lang="ts">
import TenantDecorationSettings from '../../components/tenant/TenantDecorationSettings.vue'
definePageMeta({layout:'tenant',key:route=>route.fullPath})
</script>
<template><TenantDecorationSettings section="theme"/></template>
