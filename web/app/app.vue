<script setup lang="ts">
const config = useAppConfig().qicore
const { data: brand } = await useFetch<NonNullable<CoreSession['site']>>('/api/public/site-brand', { key: 'core-site-brand' })
useHead(() => ({ link: [{key:'favicon',rel:'icon',href:brand.value?.favicon || config.brandMark}] }))
</script>
<template><UApp><NuxtPage /></UApp></template>
