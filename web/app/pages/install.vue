<script setup lang="ts">
import ConsoleInput from '../console-ui/ConsoleInput.vue'

const { data: state, error, refresh } = await useFetch<{ installed: boolean; product: string }>('/api/install/status')
const product = computed(() => state.value?.product || 'QiCore')
const mark = useAppConfig().qicore.brandMark
useHead(() => ({ title: '安装向导 · ' + product.value }))
const form = reactive({ token: '', database: '', login: '', password: '' })
const installing = ref(false)
const retrying = ref(false)
const ready = ref(false)
const message = ref('')
const installed = useState('qicore-installed', () => false)
onMounted(() => {
  if (location.hash) {
    form.token = new URLSearchParams(location.hash.slice(1)).get('token') || ''
    history.replaceState(history.state, '', location.pathname + location.search)
  }
  ready.value = true
})
async function retry() {
  retrying.value = true
  try { await refresh() } finally { retrying.value = false }
}
async function install() {
  if (!ready.value || installing.value || installed.value) return
  installing.value = true
  message.value = ''
  try {
    await $fetch('/api/install/complete', { method: 'POST', body: form })
    installed.value = true
    Object.assign(form, { password: '', database: '', token: '' })
    await navigateTo('/login', { replace: true, external: true })
  } catch (cause) {
    message.value = coreError(cause, '安装服务暂时不可用')
  } finally {
    installing.value = false
  }
}
</script>

<template>
  <main class="min-h-dvh bg-muted p-5 sm:p-8">
    <div class="mx-auto max-w-3xl space-y-6">
      <header class="flex items-center gap-3 py-4"><img :src="mark" alt="" class="size-9"><strong class="text-lg">{{ product }}</strong></header>
      <UCard class="surface-card">
        <template #header><h1>安装向导</h1></template>
        <div v-if="error" class="space-y-4">
          <UAlert color="error" title="无法连接安装服务" description="请确认 API 已启动后重新检测。" />
          <UButton color="neutral" variant="outline" :loading="retrying" @click="retry">重新检测</UButton>
        </div>
        <form v-else method="post" class="core-editor space-y-6" @submit.prevent="install">
          <fieldset class="grid gap-4" :disabled="installing">
            <legend class="mb-4 font-semibold">实例与数据库</legend>
            <UFormField label="安装凭据" required description="使用本实例安装链接中的一次性凭据。">
              <ConsoleInput v-model="form.token" type="password" autocomplete="off" required />
            </UFormField>
            <UFormField label="MySQL 连接地址" required description="使用本企业实例的专用 MySQL 数据库。">
              <ConsoleInput v-model="form.database" type="password" autocomplete="off" placeholder="mysql://用户名:密码@主机:3306/数据库" required />
            </UFormField>
          </fieldset>
          <fieldset class="grid gap-4 border-t border-default pt-5" :disabled="installing">
            <legend class="font-semibold">初始管理员</legend>
            <UFormField label="管理员账号" required>
              <ConsoleInput v-model="form.login" autocomplete="username" minlength="2" maxlength="80" required />
            </UFormField>
            <UFormField label="管理员密码" required description="密码长度为 12 至 128 个字符。">
              <ConsoleInput v-model="form.password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required />
            </UFormField>
          </fieldset>
          <UAlert v-if="message" role="alert" color="error" :title="message" />
          <div class="flex justify-end">
            <UButton type="submit" :loading="installing" :disabled="!ready || installing || installed" :aria-busy="installing">完成安装</UButton>
          </div>
        </form>
      </UCard>
    </div>
  </main>
</template>
