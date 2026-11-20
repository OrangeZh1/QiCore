<script setup lang="ts">
definePageMeta({ publicLanding: true, colorMode: 'light' })
type Category = { id: string; name: string }
type Article = { id: string; title: string; category: Category }
type Listing = { categories: Category[]; items: Article[]; page: number; pageSize: number; total: number }
const { data, error } = await useFetch<Listing>('/api/public/help', { key: 'h5-help-first' })
const list = shallowRef<Listing | null>(data.value ?? null)
const selected = ref(''), action = ref(''), message = ref(error.value ? '帮助内容暂时无法加载' : '')
const expanded = ref(''), answer = ref(''), answerAction = ref(''), answerError = ref('')
let listRequest: AbortController | undefined, articleRequest: AbortController | undefined
function closeAnswer() {
  articleRequest?.abort(); expanded.value = ''; answer.value = ''; answerError.value = ''; answerAction.value = ''
}
let retryPage = 1
async function load(source: string, category: string, page = 1) {
  listRequest?.abort()
  const request = new AbortController()
  listRequest = request
  const changed = selected.value !== category
  selected.value = category; retryPage = page; action.value = source
  if (source !== 'retry') message.value = ''
  if (changed) {
    closeAnswer()
    if (list.value) list.value = { ...list.value, items: [], total: 0, page: 1 }
  }
  try {
    const next = await $fetch<Listing>('/api/public/help', { query: { categoryId: category || undefined, page }, signal: request.signal })
    if (request.signal.aborted) return
    list.value = page > 1 ? { ...next, items: Array.from(new Map([...(list.value?.items || []), ...next.items].map(item => [item.id, item])).values()) } : next
    message.value = ''
  } catch {
    if (!request.signal.aborted) message.value = '帮助内容暂时无法加载'
  } finally { if (listRequest === request) action.value = '' }
}
async function show(id: string, retry = false) {
  if (expanded.value === id && !retry) return closeAnswer()
  if (retry && answerAction.value) return
  if (!retry) closeAnswer()
  else articleRequest?.abort()
  const request = new AbortController()
  articleRequest = request; expanded.value = id; answerAction.value = retry ? 'retry' : 'open'
  try {
    const result = await $fetch<Article & { content: string }>('/api/public/help/' + encodeURIComponent(id), { signal: request.signal })
    if (!request.signal.aborted && result.id === id) { answer.value = result.content; answerError.value = '' }
  } catch {
    if (!request.signal.aborted) answerError.value = '回答暂时无法读取'
  } finally { if (articleRequest === request) answerAction.value = '' }
}
onBeforeUnmount(() => { listRequest?.abort(); articleRequest?.abort() })
</script>
<template>
  <H5PublicPage class="help-page" title="帮助中心" back="/h5">
    <div class="help-body">
      <div v-if="list?.categories.length" class="help-categories"><div class="help-category-row" role="group" aria-label="帮助分类">
        <button v-for="item in [{ id: '', name: '全部' }, ...list.categories]" :key="item.id" type="button"
          :class="{ chosen: selected === item.id }" :aria-pressed="selected === item.id" :aria-busy="action === 'category:' + item.id"
          @click="selected !== item.id && load('category:' + item.id, item.id)">{{ item.name }}</button>
      </div></div>
      <div v-if="list?.items.length" class="qa-list"><div v-for="item in list.items" :key="item.id" class="qa-item">
        <button class="qa-question" type="button" :aria-expanded="expanded === item.id" :aria-controls="'answer-' + item.id" :aria-busy="expanded === item.id && answerAction === 'open'" @click="show(item.id)">
          <span class="qa-title">{{ item.title }}</span><span class="qa-toggle" aria-hidden="true">{{ expanded === item.id ? '−' : '+' }}</span>
        </button>
        <div v-if="expanded === item.id" :id="'answer-' + item.id" class="qa-answer">
          <div v-if="answerError" role="alert">{{ answerError }} <button class="h5-action" :disabled="answerAction === 'retry'" :aria-busy="answerAction === 'retry'" @click="show(item.id, true)">重试</button></div>
          <span v-else-if="answerAction" role="status">正在读取回答…</span>
          <template v-else><div class="h5-rich" v-html="answer" /><NuxtLink class="h5-action" :to="{ path: '/h5/help/detail', query: { id: item.id } }">查看详情</NuxtLink></template>
        </div>
      </div></div>
      <div v-if="message" role="alert" class="h5-error">{{ message }} <button class="h5-action" :disabled="action === 'retry'" :aria-busy="action === 'retry'" @click="load('retry', selected, retryPage)">重新加载</button></div>
      <p v-else-if="action && !list?.items.length" class="h5-state" role="status">正在读取帮助内容…</p>
      <p v-else-if="!list?.items.length" class="h5-state">暂无帮助内容</p>
      <button v-else-if="list.items.length < list.total" class="more-button" :disabled="!!action" :aria-busy="action === 'more'" @click="load('more', selected, list.page + 1)">加载更多</button>
    </div>
  </H5PublicPage>
</template>
<style scoped>
.help-page button { box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit }
.help-page button::after { border:0 }
.help-body { padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) calc(24px + env(safe-area-inset-bottom)) }
.help-categories { white-space:nowrap;margin-bottom:16px }
.help-category-row { display:inline-flex;gap:8px }
.help-category-row button { padding:7px 13px;border-radius:8px;font-size:12px;color:var(--client-muted) }
.help-category-row button.chosen { background:var(--client-primary-soft);color:var(--client-primary);font-weight:600 }
.qa-list { padding:0 16px;border-radius:14px;background:var(--client-surface) }
.qa-item+.qa-item { border-top:1px solid #eef1f6 }
.qa-question { display:flex;align-items:flex-start;gap:10px;width:100%;padding:18px 0!important;text-align:left;line-height:1.7 }
.qa-title { flex:1;min-width:0;overflow-wrap:anywhere;font-size:14px;font-weight:600 }
.qa-toggle { flex-shrink:0;width:16px;text-align:center;font-size:18px;color:var(--client-muted);line-height:24px }
.qa-answer { padding:0 24px 18px 0 }
.help-page .more-button { width:100%;margin-top:16px;min-height:40px;color:var(--client-primary);font-size:13px }
.help-categories { overflow-x:auto; }
.help-category-row button:not(.chosen), .qa-question { background:transparent;color:var(--client-text); }
</style>
