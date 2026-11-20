<script setup lang="ts">
import TenantCurrentDecoration from '../../components/tenant/TenantCurrentDecoration.vue'
definePageMeta({layout:'tenant',key:route=>route.fullPath})
</script>
<template><TenantCurrentDecoration/></template>
