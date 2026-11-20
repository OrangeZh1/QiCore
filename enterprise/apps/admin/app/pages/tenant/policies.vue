<script setup lang="ts">
import AdminConsole from '~/components/console/AdminConsole.vue'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import {dateTime} from '~/utils/update-center'
definePageMeta({layout:'tenant',key:route=>route.path})
type View={applicationKey:string|null;applications:{key:string;name:string}[];canWrite:boolean;items:{kind:string;label:string;title:string;updatedAt:string|null}[]}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,route=useRoute(),endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/policies'
const key=ref(typeof route.query.applicationKey==='string'?route.query.applicationKey:'')
const initial=await useAsyncData<View>('policy-list:'+auth.session.value?.id+':'+tenantId+':'+key.value,(_nuxt,{signal})=>auth.api<View>(endpoint+(key.value?'?applicationKey='+encodeURIComponent(key.value):''),'GET',undefined,{signal}))
const data=ref(initial.data.value||null),busy=ref<'refresh'|'retry'|'switch'|null>(null),error=ref(initial.error.value?.message||'')
key.value=data.value?.applicationKey||key.value
const controller=new AbortController();let disposed=false
const columns=[{accessorKey:'label',header:'协议类型'},{accessorKey:'title',header:'协议标题'},{accessorKey:'updatedAt',header:'修改时间'},{id:'actions',header:'操作'}]
async function refresh(source:'refresh'|'retry'|'switch'='refresh',applicationKey=key.value){if(busy.value)return;busy.value=source;error.value='';try{const value=await auth.api<View>(endpoint+(applicationKey?'?applicationKey='+encodeURIComponent(applicationKey):''),'GET',undefined,{signal:controller.signal});if(!disposed){data.value=value;key.value=value.applicationKey||''}}catch(e:any){if(!disposed)error.value=e.message||'协议读取失败'}finally{if(!disposed)busy.value=null}}
onBeforeUnmount(()=>{disposed=true;controller.abort();busy.value=null})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="refresh()"><div class="space-y-5"><ConsolePageHeading title="协议管理"><template #actions><USelect v-if="data&&data.applications.length>1" :model-value="key" :items="data.applications.map(a=>({label:a.name,value:a.key}))" :disabled="!!busy" :loading="busy==='switch'" aria-label="协议所属应用" @update:model-value="refresh('switch',String($event))"/></template></ConsolePageHeading>
 <UAlert v-if="error" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <ConsoleDataTable row-key="kind" :pagination="false" :show-sequence="false" :data="data?.items||[]" :columns="columns"><template #updatedAt-cell="{row}">{{row.original.updatedAt?dateTime(row.original.updatedAt):'—'}}</template><template #actions-cell="{row}"><UButton variant="link" size="sm" :to="{path:'/admin/policy-editor',query:{kind:row.original.kind,applicationKey:key}}">{{data?.canWrite?'设置':'查看'}}</UButton></template></ConsoleDataTable>
</div></AdminConsole></template>
