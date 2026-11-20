<script setup lang="ts">
import AdminConsole from '../../components/console/AdminConsole.vue'
import ReleaseNotesContent from '../../components/console/ReleaseNotesContent.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleActionConfirmationDialog from '@orangezh1/qisvc-console-ui/components/ConsoleActionConfirmationDialog'

definePageMeta({layout:'tenant'})
type ProductStatus={
  productName:string
  update:{currentVersion:string;latestVersion:string|null;releaseNotes:string;label:string;canCheck?:boolean}
  installer:{available:boolean;canInstall:boolean;reason:string}
  tasks:{id:string;status:string}[]
}
const auth=useApi('tenant')
const endpoint='/admin/updates'
const initial=await useAsyncData('whole-product-updates:'+auth.session.value?.id,()=>auth.api<ProductStatus>(endpoint))
if(initial.error.value)throw createError({statusCode:initial.error.value.statusCode||503,statusMessage:'无法读取整包更新状态'})
const data=ref(initial.data.value)
const action=ref<'refresh'|'check'|'apply'|null>(null),error=ref(''),confirmOpen=ref(false)
const toast=useToast()
let request:{requestId:string;targetVersion:string}|undefined

async function run(next:'refresh'|'check'|'apply'){
  if(action.value)return
  action.value=next
  error.value=''
  try{
    if(next==='check')data.value=await auth.api<ProductStatus>(endpoint+'/check','POST',{})
    else{
      if(next==='apply'){
        const version=data.value?.update.latestVersion
        if(!version||!data.value?.installer.canInstall)return
        if(request?.targetVersion!==version)request={requestId:crypto.randomUUID(),targetVersion:version}
        await auth.api(endpoint+'/execute','POST',request)
        confirmOpen.value=false
        toast.add({title:'已提交整包更新',color:'success'})
      }
      data.value=await auth.api<ProductStatus>(endpoint)
    }
  }catch(e){error.value=e instanceof Error?e.message:'操作未完成，请刷新状态'}
  finally{action.value=null}
}
</script>
<template>
  <AdminConsole :refreshing="action==='refresh'" @refresh="run('refresh')">
    <div class="space-y-5">
      <ConsolePageHeading title="整包更新"/>
      <UAlert v-if="error" color="error" :title="error"/>
      <UCard v-if="data">
        <div class="space-y-4">
          <h2 class="font-semibold">{{data.productName}}</h2>
          <p>当前版本 {{data.update.currentVersion}}</p>
          <p v-if="data.update.latestVersion">可用版本 {{data.update.latestVersion}}</p>
          <p class="text-muted">{{data.installer.reason||data.update.label}}</p>
          <ReleaseNotesContent v-if="data.update.releaseNotes" :notes="data.update.releaseNotes"/>
          <p v-for="task in data.tasks" :key="task.id" class="text-sm">更新任务 {{task.id}} · {{task.status}}</p>
          <div class="flex gap-3">
            <UButton :loading="action==='check'" :disabled="!!action||!data.installer.available||!data.update.canCheck" @click="run('check')">检查更新</UButton>
            <UButton v-if="data.installer.canInstall" :disabled="!!action" @click="confirmOpen=true">安装更新</UButton>
          </div>
        </div>
      </UCard>
      <ConsoleActionConfirmationDialog v-model:open="confirmOpen" title="安装整包更新？" :subject="data?.update.latestVersion||''" description="框架、主应用和随包插件将一起升级。" confirm-label="安装更新" :loading="action==='apply'" @confirm="run('apply')"/>
    </div>
  </AdminConsole>
</template>
