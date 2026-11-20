<script setup lang="ts">
definePageMeta({ middleware: 'core-access' })
const { data: session } = await useCoreSession()
const { data: summary, error, refresh } = await useFetch<CoreOverview>('/api/core/overview')
const shortcuts = computed(() => [
  {label:'站点设置',description:'管理企业名称与基础信息',icon:'i-lucide-settings',to:'/admin/site',permission:'core.site.read'},
  {label:'管理员',description:'管理后台成员',icon:'i-lucide-users',to:'/admin/accounts',permission:'core.accounts.read'},
  {label:'角色权限',description:'配置成员的操作权限',icon:'i-lucide-shield-check',to:'/admin/roles',permission:'core.roles.read'},
  {label:'素材管理',description:'管理企业公共素材',icon:'i-lucide-images',to:'/admin/materials',permission:'core.materials.read'},
].filter(item=>coreCan(session.value,item.permission)))
</script>
<template>
 <CoreShell title="工作台" :refresh-page="refresh">
  <UAlert v-if="error" color="error" :title="coreError(error, '工作台读取失败')" />
  <div v-else-if="summary" class="space-y-6">
   <UCard :ui="{body:'p-5 sm:p-6'}">
    <div class="flex flex-wrap items-start justify-between gap-5">
     <div class="flex min-w-0 items-start gap-4"><span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><UIcon name="i-lucide-building-2" class="size-6"/></span><div class="min-w-0"><h2 class="break-words text-xl font-semibold">{{session?.brand||'企业工作台'}}</h2><p class="mt-2 text-sm text-muted">在这里管理企业成员和应用。</p></div></div>
     <UBadge color="success" variant="soft">实例已启用</UBadge>
    </div>
    <dl class="mt-6 grid gap-5 border-t border-default pt-5 text-sm sm:grid-cols-3">
     <div><dt class="text-xs text-muted">框架版本</dt><dd class="mt-2 break-all font-medium">{{summary?.frameworkVersion}}</dd></div>
     <div><dt class="text-xs text-muted">当前账号</dt><dd class="mt-2 break-words font-medium">{{session?.account.displayName||session?.account.login||'—'}}</dd></div>
     <div><dt class="text-xs text-muted">当前角色</dt><dd class="mt-2 font-medium">{{session?.account.role.title||'—'}}</dd></div>
    </dl>
   </UCard>
   <UCard v-if="!summary?.application" :ui="{body:'flex items-center gap-3 p-4 sm:p-5'}"><UIcon name="i-lucide-package" class="size-5 shrink-0 text-muted"/><div><h2 class="text-sm font-medium">未接入应用</h2><p class="mt-1 text-xs text-muted">当前使用框架默认工作台。</p></div></UCard>
   <UCard v-if="shortcuts.length" :ui="{body:'p-4 sm:p-5'}"><template #header><h2 class="font-semibold">常用功能</h2></template>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><NuxtLink :prefetch-on="{visibility:false,interaction:true}" v-for="item in shortcuts" :key="item.to" :to="item.to" class="flex items-center gap-3 rounded-lg border border-default p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"><UIcon :name="item.icon" class="size-5 shrink-0 text-primary"/><div><h3 class="text-sm font-medium">{{item.label}}</h3><p class="mt-1 text-xs text-muted">{{item.description}}</p></div></NuxtLink></div>
   </UCard>

    <UCard v-if="session?.menus.length"><template #header><h2>应用入口</h2></template>
    <UButton v-for="item in session.menus" :key="item.path" :to="item.path" :icon="item.icon" color="neutral" variant="ghost">{{ item.title }}</UButton>
  </UCard>
  </div>
 </CoreShell>
</template>
