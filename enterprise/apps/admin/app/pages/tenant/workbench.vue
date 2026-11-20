<script setup lang="ts">
import TenantWorkbench from '../../components/tenant/TenantWorkbench.vue'
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
definePageMeta({layout:'tenant'})
const context=useTenantContext(),loadAction=ref<'refresh'|'retry'|null>(null),error=ref('')
let controller:AbortController|undefined
async function refresh(action:'refresh'|'retry'='refresh'){
 if(loadAction.value)return;loadAction.value=action;error.value='';controller=new AbortController()
 try{const entry=await context.refresh(controller.signal);if(!entry||controller.signal.aborted)return;if(!entry.tenant||['forbidden','tenant-disabled','tenant-expired','system-unavailable'].includes(entry.access))throw new Error('后台当前不可用，请联系管理员');else {const target=entry.tenant.consoleRoutes?.find(item=>item.group==='workbench')?.path;if(target)await navigateTo(target,{external:true,replace:true})}}
 catch(e){if(!controller.signal.aborted)error.value=e instanceof Error?e.message:'工作台读取失败，请重试'}finally{loadAction.value=null}
}
onBeforeUnmount(()=>controller?.abort())
</script>
<template><div><ConsoleErrorState v-if="error" class="mb-5" title="工作台更新失败" :description="error"><template #actions><UButton :loading="loadAction==='retry'" :disabled="!!loadAction" @click="refresh('retry')">重试</UButton></template></ConsoleErrorState><TenantWorkbench :refreshing="loadAction==='refresh'" @refresh="refresh('refresh')"/></div></template>
