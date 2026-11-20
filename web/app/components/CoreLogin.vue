<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    brand?: string
    title?: string
    entry?: string
    productTitle?: string
    description?: string
    features?: string[]
    buttonLabel?: string
  }>(),
  {
    brand: 'QiCore',
    title: '管理员登录',
    entry: '管理后台',
    productTitle: 'QiCore 启承框架',
    description: '通过管理控制台维护账号、角色与已接入的应用。',
    features: () => ['管理后台账号与角色', '使用已授权的应用功能', '维护实例配置与文件'],
    buttonLabel: '登录后台',
  },
)
const config = useAppConfig().qicore as { brandMark?: string; workbenchPath?: string } | undefined
const {data:site} = useNuxtData<NonNullable<CoreSession['site']> & {version:number}>('core-site-brand')
const mark = computed(()=>site.value?.logo || config?.brandMark || '/brand/qicore.png')
const brandName = computed(()=>site.value?.version ? site.value.name : props.brand)
const destination = config?.workbenchPath || '/'
useHead(() => ({ title: props.title + ' · ' + brandName.value }))
const login = ref(''),
  password = ref(''),
  reveal = ref(false),
  ready = ref(false),
  busy = ref(false),
  error = ref('')
const accountInput = ref<HTMLInputElement>()
const passwordInput = ref<HTMLInputElement>()
const missing = computed(() => error.value === '请输入账号和密码')
const request = useRequestFetch()
const { data: restored } = await useAsyncData('core-login-restored', async () => {
  try {
    const me = await request<{ account: { id: string } }>('/api/me')
    return { authenticated: !!me.account?.id }
  } catch {
    return { authenticated: false }
  }
})
if (restored.value?.authenticated) await navigateTo(destination, { replace: true })
onMounted(() => {
  ready.value = true
})

async function submit() {
  if (!ready.value || busy.value) return
  if (!login.value.trim() || !password.value) {
    error.value = '请输入账号和密码'
    const firstMissing = !login.value.trim() ? accountInput.value : passwordInput.value
    firstMissing?.focus()
    return
  }
  error.value = ''
  busy.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { login: login.value.trim(), password: password.value },
    })
    password.value = ''
    clearNuxtData()
    await navigateTo(destination, { replace: true, external: true })
  } catch (cause) {
    const serverMessage = (cause as { data?: { message?: string } })?.data?.message
    error.value = typeof serverMessage === 'string' ? serverMessage : '登录未完成，请稍后重试。'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="console-entry">
    <aside class="entry-context">
      <NuxtLink class="entry-brand" to="/login">
        <img :src="mark" width="48" height="48" alt="" />
        <span>
          <b>{{ brandName }}</b>
          <small lang="en">MANAGEMENT CONSOLE</small>
        </span>
      </NuxtLink>
      <div class="entry-about">
        <p class="entry-kind">{{ entry }}入口</p>
        <h1>{{ productTitle }}</h1>
        <p class="entry-summary">{{ description }}</p>
        <ul>
          <li v-for="point in features" :key="point">
            <CoreIcon name="lucide:circle-check" :size="18" />
            {{ point }}
          </li>
        </ul>
      </div>
      <footer>
        {{ brandName }}
        <span>·</span>
        {{ entry }}
      </footer>
    </aside>
    <main class="entry-main">
      <div class="entry-panel">
        <div class="mobile-brand">
          <img :src="mark" width="28" height="28" alt="" />
          {{ brandName }}
        </div>
        <div class="entry-heading">
          <div class="shield"><CoreIcon name="lucide:shield-check" :size="28" /></div>
          <h2>{{ title }}</h2>
          <p>使用已获得授权的后台账号登录</p>
        </div>
        <form method="post" novalidate class="entry-fields" @submit.prevent="submit">
          <div class="field">
            <label for="console-login">
              账号
              <span aria-hidden="true">*</span>
            </label>
            <div class="entry-input">
              <CoreIcon name="lucide:user-round" :size="18" />
              <input
                id="console-login"
                ref="accountInput"
                :aria-invalid="(missing && !login.trim()) || undefined"
                :aria-describedby="error ? 'console-login-error' : undefined"
                v-model="login"
                name="username"
                aria-label="登录账号"
                required
                placeholder="请输入后台账号"
                autocomplete="username"
                maxlength="80"
                :disabled="!ready"
                :readonly="busy"
              />
            </div>
          </div>
          <div class="field">
            <label for="console-password">
              密码
              <span aria-hidden="true">*</span>
            </label>
            <div class="entry-input">
              <CoreIcon name="lucide:lock-keyhole" :size="18" />
              <input
                id="console-password"
                ref="passwordInput"
                :aria-invalid="(missing && !password) || undefined"
                v-model="password"
                name="password"
                aria-label="密码"
                required
                placeholder="请输入密码"
                autocomplete="current-password"
                :type="reveal ? 'text' : 'password'"
                maxlength="128"
                :disabled="!ready"
                :readonly="busy"
                :aria-describedby="error ? 'console-login-error' : undefined"
              />
              <button
                type="button"
                class="show-secret"
                :aria-label="reveal ? '隐藏密码' : '显示密码'"
                :aria-pressed="reveal"
                :disabled="busy || !ready"
                @click="reveal = !reveal"
              >
                <CoreIcon v-if="reveal" name="lucide:eye-off" :size="18" />
                <CoreIcon v-else name="lucide:eye" :size="18" />
              </button>
            </div>
          </div>
          <div class="entry-feedback" aria-live="polite">
            <p v-if="error" id="console-login-error" class="login-error" role="alert">{{ error }}</p>
          </div>
          <button class="entry-submit" type="submit" :disabled="busy || !ready" :aria-busy="busy">
            <CoreIcon v-if="busy" class="login-spinner" name="lucide:loader-circle" :size="18" />
            {{ buttonLabel }}
          </button>
        </form>
      </div>
    </main>
  </div>
</template>
<style scoped>
.console-entry {
  --entry-blue: #2563eb;
  --entry-border: #cbd5e1;
  --entry-dark: #0f172a;
  min-height: 100svh;
  display: grid;
  grid-template-columns: minmax(360px, 44%) minmax(0, 1fr);
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  color: var(--entry-dark);
  background: white;
}
.console-entry * {
  box-sizing: border-box;
}
.entry-context {
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  padding: 48px 54px;
  color: white;
  background: linear-gradient(145deg, #102d52, #145197);
}
.entry-brand,
.mobile-brand {
  display: flex;
  align-items: center;
  gap: 13px;
}
.entry-brand {
  width: fit-content;
  color: white;
  text-decoration: none;
}
.entry-brand img,
.mobile-brand img {
  object-fit: contain;
  flex: none;
}
.entry-brand b {
  display: block;
  color: white;
  font-size: 23px;
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: 2px;
}
.entry-brand small {
  display: block;
  margin-top: 5px;
  color: #bdd3eb;
  font-size: 8px;
  letter-spacing: 2.1px;
}
.entry-about {
  margin: auto 0;
  padding: 65px 0;
}
.entry-about .entry-kind {
  margin: 0 0 24px;
  color: #90b9e3;
  font-size: 12px;
  letter-spacing: 2.5px;
}
.entry-about h1 {
  margin: 0;
  color: white;
  font-size: 36px;
  line-height: 1.5;
  letter-spacing: 0.7px;
  font-weight: 650;
  white-space: pre-line;
}
.entry-about .entry-summary {
  max-width: 340px;
  margin: 22px 0 28px;
  color: #afc9e5;
  font-size: 14px;
  line-height: 1.9;
}
.entry-about ul {
  display: grid;
  gap: 15px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.entry-about li {
  display: flex;
  align-items: center;
  gap: 11px;
  color: #d4e4f7;
  font-size: 13px;
}
.entry-about li > span {
  color: #a4c7ed;
  flex: none;
}
.entry-context footer {
  font-size: 11px;
  letter-spacing: 0.3px;
  color: #a8c2e0;
}
.entry-context footer span {
  margin: 0 9px;
}
.entry-main {
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 100svh;
  padding: 38px;
  background: white;
}
.entry-panel {
  width: 100%;
  max-width: 448px;
  padding: 16px;
}
.mobile-brand {
  display: none;
}
.entry-heading {
  text-align: center;
}
.shield {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin: 0 auto;
  border-radius: 16px;
  color: #287dff;
  background: #e9f1ff;
}
.entry-heading h2 {
  color: var(--entry-dark);
  font-size: 26px;
  line-height: 1.3;
  font-weight: 650;
  margin: 20px 0 8px;
  letter-spacing: -0.035em;
}
.entry-heading p {
  color: #526684;
  font-size: 14px;
  line-height: 24px;
  margin: 0;
}
.console-entry .entry-fields {
  border: none;
  background: transparent;
  padding: 0;
  margin: 32px 0 0;
  display: grid;
  gap: 20px;
}
.field label {
  display: block;
  font-size: 14px;
  line-height: 20px;
  color: #334155;
  margin: 0 0 6px;
  font-weight: 500;
}
.field label span {
  color: #dc2626;
}
.entry-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  height: 42px;
  color: #8294b0;
  border: 1px solid var(--entry-border);
  border-radius: 7px;
  background: white;
}
.entry-input:focus-within {
  box-shadow: 0 0 0 2px #c6d9ff;
  border-color: #5085ed;
}
.console-entry .entry-input input {
  margin: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  outline: none;
  padding: 0;
  background: transparent;
  color: #1e293b;
  font-size: 14px;
  line-height: 1.4;
}
.entry-input input::placeholder {
  color: #8292a8;
}
.entry-input input::-ms-reveal {
  display: none;
}
.console-entry .show-secret {
  color: #7689a6;
  display: grid;
  place-items: center;
  flex: none;
  min-height: 36px;
  width: 36px;
  margin-right: -6px;
  border: 0;
  padding: 0;
  background: transparent;
}
.console-entry .show-secret:hover {
  color: var(--entry-blue);
  background: #f3f6fc;
}
.console-entry .entry-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  min-height: 34px;
  margin-top: 8px;
  color: white;
  background: var(--entry-blue);
  border: 0;
  border-radius: 7px;
  padding: 7px 12px;
  font-weight: 550;
  font-size: 14px;
  line-height: 20px;
}
.console-entry .entry-submit:hover:enabled {
  background: #1d4ed8;
  filter: none;
}
.console-entry .entry-submit:disabled {
  background: #588ef5;
  color: white;
  opacity: 1;
  cursor: default;
}
.console-entry button:focus-visible,
.entry-brand:focus-visible {
  outline: 3px solid #78a9ff;
  outline-offset: 3px;
}
.entry-feedback {
  min-height: 72px;
  display: grid;
  align-content: start;
}
.console-entry .login-error {
  margin: 0;
  color: #aa3028;
  background: #fff3f1;
  border: 1px solid #f2c6c1;
  border-radius: 6px;
  padding: 9px 11px;
  font-size: 13px;
}
.login-spinner {
  animation: entry-rotate 1s linear infinite;
}
@keyframes entry-rotate {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-spinner {
    animation: none;
  }
}
@media (max-width: 1023px) {
  .console-entry {
    grid-template-columns: minmax(300px, 42%) minmax(0, 1fr);
  }
  .entry-context {
    padding: 35px 30px;
  }
  .entry-about h1 {
    font-size: 29px;
  }
  .entry-main {
    padding: 25px;
  }
}
@media (max-width: 760px) {
  .console-entry {
    display: block;
  }
  .entry-context {
    display: none;
  }
  .entry-main {
    padding: 25px 18px;
  }
  .entry-panel {
    padding: 14px 4px;
  }
  .mobile-brand {
    display: flex;
    justify-content: center;
    gap: 9px;
    margin-bottom: 32px;
    font-size: 14px;
    font-weight: 650;
    color: var(--entry-blue);
  }
}
</style>
