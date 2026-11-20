<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import AdminConsole from '../../components/console/AdminConsole.vue'
import MaterialBrowser from '../../components/console/MaterialBrowser.vue'
import type {TenantEntryView} from '../../utils/tenant-entry'
definePageMeta({layout:'tenant',key:route=>route.fullPath})
const auth=useApi('tenant'),route=useRoute(),tenantId=useTenantContext().tenantId.value,browser=ref<InstanceType<typeof MaterialBrowser>|null>(null),refreshing=ref(false),switching=ref(false),scopeError=ref('')
const grants=auth.session.value?.permissions||[],shared=grants.includes('tenant:materials.read')
const {data:entry}=await useAsyncData<TenantEntryView>('tenant-material-scopes:'+auth.session.value?.id+':'+tenantId,(_nuxt,{signal})=>auth.api('/admin/tenant-entry?tenantId='+encodeURIComponent(tenantId),'GET',undefined,{signal}))
const choices=computed(()=>[...(shared?[{label:'公共素材',value:'shared'}]:[]),...(entry.value?.applications||[]).filter(app=>app.state==='available'&&(grants.includes(app.key+':materials.read'))).map(app=>({label:app.name+'专属',value:app.key}))])
const scope=String(route.query.scope||(shared?'shared':choices.value.length===1?choices.value[0]!.value:''))
if(!scope)await navigateTo('/admin/applications',{replace:true})
const endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/materials/'+encodeURIComponent(scope)
async function selectScope(value:string){if(value===scope||switching.value)return;switching.value=true;scopeError.value='';try{await navigateTo('/admin/materials?scope='+encodeURIComponent(value))}catch(e){scopeError.value=e instanceof Error?e.message:'切换范围失败，请重试'}finally{switching.value=false}}
</script>
<template><AdminConsole :refreshing="refreshing" @refresh="browser?.load('refresh')"><ConsolePageHeading title="素材管理" class="mb-5 shrink-0"><template #actions><USelect :model-value="scope" :items="choices" aria-label="素材范围" class="w-44" :loading="switching" :disabled="switching" @update:model-value="selectScope"/></template></ConsolePageHeading><UAlert v-if="scopeError" :title="scopeError" color="error" class="mb-4 shrink-0"/><MaterialBrowser :key="endpoint" ref="browser" portal="tenant" :endpoint="endpoint" full-height @refreshing="refreshing=$event"/></AdminConsole></template>
