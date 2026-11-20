<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import AdminConsole from '../../components/console/AdminConsole.vue'
import MaterialBrowser from '../../components/console/MaterialBrowser.vue'
definePageMeta({layout:'admin'})
const auth=useApi(),session=await auth.restore(),browser=ref<InstanceType<typeof MaterialBrowser>|null>(null),refreshing=ref(false)
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('materials.read'))throw createError({statusCode:403,statusMessage:'没有素材管理访问权限'})
</script>
<template><AdminConsole :refreshing="refreshing" @refresh="browser?.load('refresh')"><ConsolePageHeading title="素材管理" class="mb-5 shrink-0"/><MaterialBrowser ref="browser" full-height @refreshing="refreshing=$event"/></AdminConsole></template>
