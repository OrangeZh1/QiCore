<script setup lang="ts">
import AdminConsole from '../console/AdminConsole.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import {dateTime} from '../../utils/update-center'

defineProps<{refreshing?:boolean;updatedAt?:string}>()
const emit=defineEmits<{refresh:[]}>()
const auth=useApi('tenant'),context=useTenantContext()
const site=computed(()=>context.current.value?.site)
const shortcuts=computed(()=>[
 {label:'站点设置',description:'管理站点名称与基础信息',icon:'i-lucide-settings',to:'/admin/site',permission:'tenant:settings.read'},
 {label:'管理员',description:'管理后台成员',icon:'i-lucide-users',to:'/admin/administrators',permission:'tenant:accounts.read'},
 {label:'角色权限',description:'配置成员的操作权限',icon:'i-lucide-shield-check',to:'/admin/roles',permission:'tenant:roles.read'},
 {label:'素材管理',description:'管理公共素材',icon:'i-lucide-images',to:'/admin/materials',permission:'tenant:materials.read'},
].filter(item=>auth.session.value?.permissions.includes(item.permission)))
</script>

<template>
 <AdminConsole :refreshing="refreshing" @refresh="emit('refresh')">
  <div class="space-y-6">
   <ConsolePageHeading title="工作台"><template #actions><span v-if="updatedAt" class="text-xs text-dimmed">更新于 {{dateTime(updatedAt)}}</span></template></ConsolePageHeading>
   <UCard :ui="{body:'p-5 sm:p-6'}">
    <div class="flex flex-wrap items-start justify-between gap-5">
     <div class="flex min-w-0 items-start gap-4"><span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><UIcon name="i-lucide-building-2" class="size-6"/></span><div class="min-w-0"><h2 class="break-words text-xl font-semibold">站点概览</h2></div></div>
    </div>
    <dl class="mt-6 grid gap-5 border-t border-default pt-5 text-sm sm:grid-cols-3">
     <div><dt class="text-xs text-muted">当前角色</dt><dd class="mt-2 font-medium">{{auth.session.value?.roleName}}</dd></div>
     <div><dt class="text-xs text-muted">当前账号</dt><dd class="mt-2 break-words font-medium">{{auth.session.value?.username||'—'}}</dd></div>
     <div><dt class="text-xs text-muted">当前应用</dt><dd class="mt-2 font-medium">{{site?.application?.name||'独立运行'}}</dd></div>
    </dl>
   </UCard>
   <UCard v-if="!site?.application" :ui="{body:'flex items-center gap-3 p-4 sm:p-5'}"><UIcon name="i-lucide-package" class="size-5 shrink-0 text-muted"/><div><h2 class="text-sm font-medium">尚未接入应用</h2><p class="mt-1 text-xs text-muted">当前使用系统默认工作台，公共装修和系统自带页面可正常使用。</p></div></UCard>
   <UCard v-if="shortcuts.length" :ui="{body:'p-4 sm:p-5'}"><template #header><h2 class="font-semibold">常用功能</h2></template>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><NuxtLink :prefetch-on="{visibility:false,interaction:true}" v-for="item in shortcuts" :key="item.to" :to="item.to" class="flex items-center gap-3 rounded-lg border border-default p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"><UIcon :name="item.icon" class="size-5 shrink-0 text-primary"/><div><h3 class="text-sm font-medium">{{item.label}}</h3><p class="mt-1 text-xs text-muted">{{item.description}}</p></div></NuxtLink></div>
   </UCard>

  </div>
 </AdminConsole>
</template>
