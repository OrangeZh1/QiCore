<script setup lang="ts">
import TenantAfterSales from '../../components/tenant/TenantAfterSales.vue'
import TenantOrderManagementHeading from '../../components/tenant/TenantOrderManagementHeading.vue'
definePageMeta({layout:'tenant',key:route=>route.path})
const route=useRoute(),orders=useTenantContext().current.value?.site.consoleRoutes?.find(item=>item.afterSales)
if(orders)await navigateTo({path:orders.path,query:{...route.query,tab:'after-sales'},hash:route.hash},{external:true,replace:true,redirectCode:302})
</script>
<template><TenantAfterSales v-if="!orders"><template #heading><TenantOrderManagementHeading model-value="after-sales" :orders="false"/></template></TenantAfterSales></template>
