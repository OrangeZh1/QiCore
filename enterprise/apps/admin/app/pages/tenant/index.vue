<script setup lang="ts">
import TenantEntry from '../../components/tenant/TenantEntry.vue'
definePageMeta({layout:'tenant',key:route=>route.path+'?tenant='+String(route.query.tenant||'')})
</script>
<template><TenantEntry/></template>
