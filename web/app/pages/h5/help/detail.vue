<script setup lang="ts">
definePageMeta({ publicLanding: true, colorMode: 'light', key: to => to.fullPath.split('#')[0] || '/h5/help/detail' })
const route = useRoute()
const id = typeof route.query.id === 'string' ? route.query.id : ''
const valid = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
const { data, error, refresh, status } = await useAsyncData('h5-article-' + id, () => {
  if (!valid) throw createError({ statusCode: 404, statusMessage: '帮助文章不存在' })
  return $fetch<{ id: string; title: string; category: { name: string }; content: string }>('/api/public/help/' + encodeURIComponent(id))
})
const missing = computed(() => error.value?.statusCode === 404)
if (import.meta.server && error.value) setResponseStatus(useRequestEvent()!, missing.value ? 404 : 503)
</script>
<template>
  <H5PublicPage class="help-detail" :title="data?.title || '帮助详情'" back="/h5/help">
    <div class="article-body">
      <article v-if="data" class="help-article"><h2 class="article-title">{{ data.title }}</h2>
        <div class="article-category">{{ data.category.name }}</div><div class="h5-rich" v-html="data.content" />
      </article>
      <p v-else-if="missing" class="h5-state">帮助文章不存在或已隐藏。</p>
      <div v-else class="h5-error" role="alert">文章暂时无法加载。
        <button class="h5-action" :disabled="status === 'pending'" :aria-busy="status === 'pending'" @click="refresh()">重新加载</button>
      </div>
    </div>
  </H5PublicPage>
</template>
<style scoped>
.article-body { padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(24px + env(safe-area-inset-bottom)) }
.help-article { padding:20px 16px;background:var(--client-surface);border-radius:14px;overflow-wrap:anywhere;overflow:hidden }
.article-title { font-size:20px;font-weight:600;line-height:1.5 }
.article-category { margin:12px 0 20px;padding-bottom:14px;border-bottom:1px solid #edf0f5;font-size:12px;color:var(--client-muted) }
</style>
