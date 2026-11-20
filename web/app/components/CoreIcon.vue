<script setup lang="ts">
defineProps<{name:string,size?:number}>()
</script>
<template><UIcon :name="name" :size="size??18" aria-hidden="true" /></template>
