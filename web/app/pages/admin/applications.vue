<script setup lang="ts">
definePageMeta({ middleware: 'core-access' })
const home = useAppConfig().qicore.workbenchPath || '/'
await navigateTo(home, { replace: true, redirectCode: 302 })
</script>
<template><div /></template>
