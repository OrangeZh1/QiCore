<script setup lang="ts">
import AdminLogin from '../../components/console/AdminLogin.vue'
const route=useRoute(),portal=String(route.params.portal)
if(!['admin','tenant'].includes(portal))throw createError({statusCode:404})
</script>
<template><AdminLogin :key="portal" :portal="portal==='admin'?'admin':'tenant'"/></template>
