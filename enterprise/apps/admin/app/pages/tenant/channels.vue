<script setup lang="ts">
import AdminConsole from '../../components/console/AdminConsole.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
definePageMeta({layout:'tenant',key:route=>route.path})
type View={applicationKey:string|null;applications:{key:string;name:string}[];channels:{key:string;name:string;description:string;path:string;icon:string}[]}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/channels'
const initial=await useAsyncData('tenant-channels:'+auth.session.value?.id+':'+tenantId,(_,{signal})=>auth.api<View>(endpoint,'GET',undefined,{signal}))
const data=ref<View|null>(initial.data.value||null),error=ref(initial.error.value?.message||''),action=ref(''),controller=new AbortController();let disposed=false
async function load(source='refresh',key=data.value?.applicationKey||''){if(action.value)return;action.value=source;error.value='';try{const value=await auth.api<View>(endpoint+(key?'?applicationKey='+encodeURIComponent(key):''),'GET',undefined,{signal:controller.signal});if(!disposed)data.value=value}catch(e:any){if(!disposed)error.value=e.message}finally{if(!disposed)action.value=''}}
onBeforeUnmount(()=>{disposed=true;controller.abort()})
</script>
<template><AdminConsole :refreshing="action==='refresh'" @refresh="load()"><div class="space-y-5"><ConsolePageHeading title="渠道管理"/><UAlert v-if="error" color="error" :title="error"><template #actions><UButton :loading="action==='retry'" @click="load('retry')">重试</UButton></template></UAlert><USelect v-if="data&&data.applications.length>1" :model-value="data.applicationKey||undefined" :items="data.applications.map(a=>({label:a.name,value:a.key}))" placeholder="选择应用" aria-label="渠道所属应用" :disabled="!!action" @update:model-value="load('application',String($event))"/>
 <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><NuxtLink :prefetch-on="{visibility:false,interaction:true}" v-for="channel in data?.channels||[]" :key="channel.key" :to="channel.path+'?application='+encodeURIComponent(data?.applicationKey||'')" class="group flex min-h-44 flex-col rounded-lg border border-default bg-default p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><span class="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UIcon :name="channel.icon" class="size-5"/></span><h2 class="text-base font-semibold">{{channel.name}}</h2><p class="mt-2 text-sm leading-6 text-muted">{{channel.description}}</p><span class="mt-4 flex items-center gap-2 text-sm text-primary">进入配置<UIcon name="i-lucide-chevron-right" class="size-4"/></span></NuxtLink></div>
</div></AdminConsole></template>
