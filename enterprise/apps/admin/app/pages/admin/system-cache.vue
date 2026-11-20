<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleActionConfirmationDialog from '@orangezh1/qisvc-console-ui/components/ConsoleActionConfirmationDialog'
import AdminConsole from '../../components/console/AdminConsole.vue'
definePageMeta({layout:'admin'})
const auth=useApi(),toast=useToast(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('cache.read'))throw createError({statusCode:403,statusMessage:'没有系统缓存访问权限'})
type Cache={count:number;canClear:boolean}
const initial=await useAsyncData('system-cache',()=>auth.api<Cache>('/admin/system-cache'))
const data=ref<Cache|null>(initial.data.value??null),error=ref(initial.error.value?'缓存状态读取失败，请重试':''),active=ref<'refresh'|'retry'|'clear'|null>(null),confirmOpen=ref(false)
const columns=[{accessorKey:'name',header:'管理内容'},{id:'description',header:'内容说明'},{id:'actions',header:'操作'}]
let disposed=false
onBeforeUnmount(()=>{disposed=true})
async function load(source:'refresh'|'retry'='refresh'){if(active.value)return;active.value=source;try{const next=await auth.api<Cache>('/admin/system-cache');if(!disposed){data.value=next;error.value=''}}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'读取失败'}finally{if(!disposed)active.value=null}}
async function clearCache(){if(active.value)return;active.value='clear';try{const result=await auth.api<{cleared:number}>('/admin/system-cache/clear','POST',{});if(!disposed){confirmOpen.value=false;error.value='';toast.add({title:result.cleared?`已清理 ${result.cleared} 项缓存`:'当前没有需要清理的业务缓存',color:'success'})}const next=await auth.api<Cache>('/admin/system-cache');if(!disposed)data.value=next}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'清理失败'}finally{if(!disposed)active.value=null}}
</script>
<template><AdminConsole :refreshing="active==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading title="系统缓存"/>
  <UAlert title="温馨提示：管理系统运行过程中产生的可重建业务缓存。" color="warning" variant="subtle" icon="i-lucide-info"/>
  <UAlert v-if="error" :title="error" color="error"><template #actions><UButton variant="outline" color="neutral" :loading="active==='retry'" :disabled="!!active" @click="load('retry')">重试</UButton></template></UAlert>
  <ConsoleDataTable :data="[{name:'系统缓存'}]" :columns="columns" :pagination="false" :client-pagination="false" :show-sequence="false" min-table-width="620px">
    <template #description-cell><p>本实例运行过程中产生的业务缓存数据</p><p class="mt-1 text-xs text-muted">{{data?`当前 ${data.count} 项`:'缓存数量未获取'}} · 保留登录限流、有效会话、文件及备份</p></template>
    <template #actions-cell><UButton variant="link" :loading="active==='clear'" :disabled="!!active||!data?.canClear" @click="confirmOpen=true">清除系统缓存</UButton></template>
  </ConsoleDataTable>
  <ConsoleActionConfirmationDialog v-model:open="confirmOpen" title="清除系统缓存？" description="仅清理本实例的可重建业务缓存，后续访问会按需重新生成。" confirm-label="清除缓存" :loading="active==='clear'" @confirm="clearCache"/>
</div></AdminConsole></template>
