<script setup lang="ts">
import TenantMessages from '../../components/tenant/TenantMessages.vue'
definePageMeta({layout:'tenant',key:route=>route.path})
</script>
<template><TenantMessages view="notifications"/></template>
