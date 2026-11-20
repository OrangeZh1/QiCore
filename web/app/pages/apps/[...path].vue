<script setup lang="ts">
const {data:me}=await useFetch<{menus:{path:string,title:string}[]}>('/api/me',{key:'core-session'})
const path=useRoute().path
const menu=me.value?.menus.find(entry=>entry.path===path)
if(!menu) throw createError({statusCode:404,statusMessage:'无此页面'})
</script>
<template><CoreShell :title="menu!.title"><slot/></CoreShell></template>
