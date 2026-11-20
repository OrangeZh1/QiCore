<script setup lang="ts">
import { dateTime } from '../../utils/core-date-time'
import ConsoleDataTable from '../../console-ui/ConsoleDataTable.vue'
definePageMeta({ middleware: 'core-access', corePermission: 'core.content.read', key: route => route.path })
type View={canWrite:boolean;items:{kind:string;label:string;title:string;updatedAt:string|null}[]}
const {api}=useCoreApi(), {data:account}=await useCoreSession()
const endpoint='/admin/policies'
const initial=await useAsyncData<View>('policy-list:'+account.value?.account.id,(_nuxt,{signal})=>api<View>(endpoint,'GET',undefined,{signal}))
const data=ref(initial.data.value||null),busy=ref<'refresh'|'retry'|null>(null),error=ref(initial.error.value?.message||'')
const controller=new AbortController();let disposed=false
const columns=[{accessorKey:'label',header:'协议类型'},{accessorKey:'title',header:'协议标题'},{accessorKey:'updatedAt',header:'修改时间'},{id:'actions',header:'操作'}]
async function refresh(source:'refresh'|'retry'='refresh'){if(busy.value)return;busy.value=source;error.value='';try{const value=await api<View>(endpoint,'GET',undefined,{signal:controller.signal});if(!disposed){data.value=value}}catch(e:any){if(!disposed)error.value=e.message||'协议读取失败'}finally{if(!disposed)busy.value=null}}
onBeforeUnmount(()=>{disposed=true;controller.abort();busy.value=null})
</script>
<template><CoreShell title="协议管理" :refresh-page="() => refresh()"><div class="space-y-5">
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <ConsoleDataTable row-key="kind" :pagination="false" :show-sequence="false" :data="data?.items||[]" :columns="columns"><template #updatedAt-cell="{row}">{{row.original.updatedAt?dateTime(row.original.updatedAt):'—'}}</template><template #actions-cell="{row}"><UButton variant="link" size="sm" :to="{path:'/admin/policy-editor',query:{kind:row.original.kind}}">{{data?.canWrite?'设置':'查看'}}</UButton></template></ConsoleDataTable>
</div></CoreShell></template>
