<script setup lang="ts">
const {data,error}=await useFetch<{message:string}>('/api/apps/hello/hello')
if(error.value) throw createError({statusCode:error.value.statusCode||403,statusMessage:'无法访问示例'})
</script>
<template><CoreShell title="问候示例"><section>{{data?.message}}</section></CoreShell></template>
