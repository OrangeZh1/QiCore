<script setup lang="ts">
const portal=String(useRoute().params.portal)
if(!['admin','tenant'].includes(portal))throw createError({statusCode:404})
await navigateTo(`/${portal}/login`)
</script>
<template><div /></template>
