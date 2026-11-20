<script setup lang="ts">
import MaterialBrowser from '../../components/material/MaterialBrowser.vue'
definePageMeta({ middleware: 'core-access', key: route => route.fullPath })
const { data: session } = await useCoreSession()
const { data: overview } = await useFetch<CoreOverview>('/api/core/overview')
const choices = computed(() => [
  ...(coreCan(session.value,'core.materials.read') ? [{label:'企业共用',value:'shared'}] : []),
  ...(overview.value?.application && coreCan(session.value,overview.value.application.key+':materials.read') ? [{label:overview.value.application.title+'专属',value:overview.value.application.key}] : []),
])
const route = useRoute()
const scope = String(route.query.scope || choices.value[0]?.value || '')
if (!choices.value.some(item => item.value===scope)) throw createError({statusCode:403,statusMessage:'没有素材库访问权限'})
const browser = ref<InstanceType<typeof MaterialBrowser>>()
const switching = ref(false)
async function selectScope(value:string) {
  if (scope===value || switching.value) return
  switching.value=true
  try {await navigateTo({path:route.path,query:{scope:value}})} finally {switching.value=false}
}
</script>
<template>
  <CoreShell title="素材管理" fill :refresh-page="async () => { await browser?.load('refresh') }">
    <template #actions><USelect :model-value="scope" :items="choices" aria-label="素材范围" class="w-44" :loading="switching" @update:model-value="selectScope" /></template>
    <MaterialBrowser ref="browser" :endpoint="'/admin/materials/'+scope" full-height />
  </CoreShell>
</template>
