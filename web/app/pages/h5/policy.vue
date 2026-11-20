<script setup lang="ts">
definePageMeta({ publicLanding: true, colorMode: 'light', key: to => to.fullPath.split('#')[0] || '/h5/policy' })
const route = useRoute()
const kind = route.query.kind === 'privacy' ? 'privacy' : 'terms'
const tabs = [{ id: 'terms', label: '用户协议' }, { id: 'privacy', label: '隐私政策' }]
const label = kind === 'terms' ? '用户协议' : '隐私政策'
const requested = route.query[kind + 'Version']
const valid = requested === undefined || (typeof requested === 'string' && /^[1-9]\d*$/.test(requested) && Number.isSafeInteger(Number(requested)))
const { data, error, refresh, status } = await useAsyncData('h5-policy-' + kind + '-' + (requested ?? 'latest'), () => {
  if (!valid) throw createError({ statusCode: 400, statusMessage: '协议版本无效' })
  return $fetch<{ title: string; version: number; contentHtml: string; updatedAt: string }>('/api/public/policies/' + kind,
    { query: requested === undefined ? {} : { version: Number(requested) } })
})
const absent = computed(() => error.value?.statusCode === 404)
if (import.meta.server && error.value && (!absent.value || requested !== undefined)) {
  setResponseStatus(useRequestEvent()!, !valid ? 400 : absent.value ? 404 : 503)
}
const updated = computed(() => data.value?.updatedAt ? new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(data.value.updatedAt)) : '')
</script>
<template>
  <H5PublicPage class="policy-page" :title="label" back="/h5">
    <nav aria-label="协议类型" class="policy-tabs">
      <NuxtLink v-for="tab in tabs" :key="tab.id" :aria-current="tab.id === kind ? 'page' : undefined"
        :to="{ path: '/h5/policy', query: { ...route.query, kind: tab.id } }">{{ tab.label }}</NuxtLink>
    </nav>
    <div class="policy-body">
      <article v-if="data" class="policy-document">
        <h2 class="policy-title">{{ data.title }}</h2>
        <div class="policy-meta"><span>更新日期 {{ updated }}</span><span>版本 {{ data.version }}</span></div>
        <div class="h5-rich" v-html="data.contentHtml" />
      </article>
      <p v-else-if="!valid" class="h5-error" role="alert">协议版本无效。</p>
      <p v-else-if="absent" class="h5-state">{{ requested ? '该协议版本不可用。' : label + '暂未提供。' }}</p>
      <div v-else class="h5-error" role="alert">协议暂时无法加载。
        <button class="h5-action" :disabled="status === 'pending'" :aria-busy="status === 'pending'" @click="refresh()">重新加载</button>
      </div>
    </div>
  </H5PublicPage>
</template>
<style scoped>
.policy-tabs { display:flex; margin:0 10px; padding:4px; border-radius:12px; background:#eaf0f7; }
.policy-tabs a { flex:1; padding:7px; text-align:center; color:var(--client-muted); }
.policy-tabs a[aria-current] { border-radius:9px; background:#fff; color:var(--client-primary); font-weight:600; }

.policy-body { padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(28px + env(safe-area-inset-bottom)) }
.policy-document { padding:24px 20px;border-radius:14px;background:var(--client-surface);overflow:hidden;overflow-wrap:anywhere;font-size:13px;line-height:1.95 }
.policy-title { text-align:center;font-size:22px;font-weight:650;line-height:1.5 }
.policy-meta { display:flex;justify-content:center;flex-wrap:wrap;gap:6px 12px;margin:10px 0 24px;font-size:10px;color:var(--client-muted) }
</style>
