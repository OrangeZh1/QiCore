<script setup lang="ts">
definePageMeta({ publicLanding: true, colorMode: 'light' })
const links = [
  { title: '帮助中心', path: '/h5/help', icon: 'book-open' },
  { title: '联系客服', path: '/h5/contact', icon: 'headphones' },
  { title: '用户协议', path: '/h5/policy?kind=terms', icon: 'file-text' },
  { title: '隐私政策', path: '/h5/policy?kind=privacy', icon: 'shield-check' },
]
</script>
<template>
  <H5PublicPage v-slot="{ brand, logo }" title="服务中心">
    <div class="service-hub">
      <div class="service-brand"><img :src="logo" alt="" width="48" height="48" /><strong>{{ brand }}</strong></div>
      <nav aria-label="公开服务">
        <NuxtLink v-for="entry in links" :key="entry.path" :to="entry.path">
          <img :src="'/h5-assets/icons/' + entry.icon + '-blue.svg'" alt="" width="22" height="22" />
          <span>{{ entry.title }}</span><img src="/h5-assets/icons/chevron-right.svg" alt="" width="16" height="16" />
        </NuxtLink>
      </nav>
    </div>
  </H5PublicPage>
</template>
<style scoped>
.service-hub { padding:16px 10px 28px; }
.service-brand { display:flex;align-items:center;gap:14px;margin:0 6px 22px;font-size:20px; }
.service-brand img { border-radius:12px; object-fit:contain; }
.service-hub nav { padding:0 16px;background:#fff;border-radius:14px; }
.service-hub nav a { display:flex;align-items:center;gap:12px;padding:16px 0;color:var(--client-text);font-weight:550; }
.service-hub nav a + a { border-top:1px solid #edf0f5; }
.service-hub nav span { flex:1; }
</style>
