<script setup lang="ts">
import MemberCatalog from '../../components/tenant/MemberCatalog.vue'
definePageMeta({layout:'tenant',key:route=>route.path})
</script>
<template><MemberCatalog kind="levels"/></template>
