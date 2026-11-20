<script setup lang="ts">
const props = defineProps<{ title: string; back?: string }>()
const { data: site } = await useFetch<{ name: string; logo: string | null; favicon: string | null }>('/api/public/site-brand', { key: 'h5-public-brand' })
const brandMark = useAppConfig().qicore.brandMark
useHead(() => ({
  title: props.title + ' · ' + (site.value?.name || 'QiCore'),
  link: [{ key: 'favicon', rel: 'icon', href: site.value?.favicon || site.value?.logo || brandMark }],
}))
</script>
<template>
  <main class="h5-public">
    <header class="app-navigation">
      <NuxtLink v-if="back" :to="back" class="app-navigation-back" aria-label="返回上一级"><i aria-hidden="true" /></NuxtLink>
      <h1>{{ title }}</h1>
    </header>
    <slot :brand="site?.name || 'QiCore'" :logo="site?.logo || brandMark" />
  </main>
</template>
<style>
.h5-public { --client-primary:#2874f0; --client-primary-soft:#edf3ff; --client-text:#203450; --client-muted:#718198; --client-page-background:#f3f9ff; --client-surface:#fff; --client-page-gutter:10px; --client-content-top:16px; box-sizing:border-box; width:100%; max-width:480px; margin:0 auto; min-height:100dvh; padding-bottom:env(safe-area-inset-bottom); background:var(--client-page-background); color:var(--client-text); font:14px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif; }
.h5-public .app-navigation { position:sticky; top:0; z-index:2; display:flex; justify-content:center; align-items:center; height:48px; background:var(--client-page-background); }
.h5-public .app-navigation h1 { max-width:76%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0; font-size:17px; font-weight:650; color:var(--client-text); }
.h5-public .app-navigation-back { position:absolute; inset-inline-start:8px; width:40px; height:40px; display:grid; place-items:center; border-radius:50%; }
.h5-public .app-navigation-back i { width:10px; height:10px; border-left:2px solid currentColor; border-bottom:2px solid currentColor; transform:rotate(45deg); }
.h5-public .h5-state, .h5-public .h5-error { padding:28px 16px; text-align:center; color:var(--client-muted); }
.h5-public .h5-error { color:#b84039; }
.h5-public .h5-action { display:inline-block; min-height:36px; padding:6px 12px; border:0; border-radius:8px; background:var(--client-primary-soft); color:var(--client-primary); font:inherit; }
.h5-public .h5-rich { overflow-wrap:anywhere; }
.h5-public .h5-rich p { color:inherit; margin:0 0 12px; }
.h5-public .h5-rich img { max-width:100%; height:auto; }
.h5-public .h5-rich table { display:block; max-width:100%; overflow:auto; }
.h5-public .h5-rich a { color:var(--client-primary); text-decoration:underline; }
.h5-public button[aria-busy="true"]::after { content:''; display:inline-block; width:.8em; height:.8em; margin-left:.5em; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; vertical-align:middle; animation:h5-pending .7s linear infinite; }
@keyframes h5-pending { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .h5-public button[aria-busy="true"]::after { animation:none; } }
</style>
