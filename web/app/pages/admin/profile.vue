<script setup lang="ts">
import AccountImageInput from '../../components/material/AccountImageInput.vue'
import ConsoleDiscardChangesDialog from '../../console-ui/ConsoleDiscardChangesDialog.vue'
import ConsoleFormActions from '../../console-ui/ConsoleFormActions.vue'
import ConsoleInput from '../../console-ui/ConsoleInput.vue'
import ConsoleProfileLayout from '../../console-ui/ConsoleProfileLayout.vue'

definePageMeta({ middleware: 'core-access' })

const { data: session } = await useCoreSession()
const { data: brand } = useNuxtData<{ defaultAvatar?: string | null }>('core-site-brand')
const route = useRoute()
const toast = useToast()
const nickname = ref(session.value?.account.displayName || '')
const avatar = ref<string | null>(session.value?.account.avatar || null)
const dirty = computed(() => nickname.value.trim() !== session.value?.account.displayName || avatar.value !== (session.value?.account.avatar || null))
const savingProfile = ref(false)
const selectingImage = ref(false)
const profileError = ref('')
const passwords = reactive({ current: '', next: '', confirm: '' })
const changingPassword = ref(false)
const passwordError = ref('')
const discard = useDiscardChanges(() => savingProfile.value || changingPassword.value || selectingImage.value)
let revision = 0

function focusCurrentPassword() {
  if (route.hash === '#password') document.getElementById('core-current-password')?.focus()
}
onMounted(focusCurrentPassword)
watch(() => route.hash, focusCurrentPassword, { flush: 'post' })

function resetProfile() {
  nickname.value = session.value?.account.displayName || ''
  avatar.value = session.value?.account.avatar || null
  profileError.value = ''
}
async function refreshProfile() {
  if (savingProfile.value || changingPassword.value || selectingImage.value) return
  if (dirty.value && !await discard.decide(resetProfile)) return
  const requestedAt = revision
  const latest = await $fetch<CoreSession>('/api/me')
  if (revision === requestedAt && !savingProfile.value && !changingPassword.value) {
    const preserveDraft = dirty.value
    session.value = latest
    if (!preserveDraft) resetProfile()
  }
}

async function saveProfile() {
  if (!session.value || savingProfile.value || changingPassword.value || selectingImage.value || !dirty.value) return
  const displayName = nickname.value.trim()
  if (!displayName || displayName.length > 100) {
    profileError.value = '请输入 1 到 100 个字符的昵称'
    return
  }
  savingProfile.value = true
  profileError.value = ''
  try {
    const body = {
      ...(displayName !== session.value.account.displayName ? { displayName } : {}),
      ...(avatar.value !== (session.value.account.avatar || null) ? { avatar: avatar.value } : {}),
    }
    const updated = await $fetch<{ displayName: string; avatar: string | null }>('/api/me', { method: 'PATCH', body })
    revision++
    session.value = { ...session.value, account: { ...session.value.account, displayName: updated.displayName, avatar: updated.avatar } }
    resetProfile()
    toast.add({ title: '个人资料已保存', color: 'success' })
  } catch (cause) {
    profileError.value = coreError(cause, '保存个人资料失败')
  } finally { savingProfile.value = false }
}

async function changePassword() {
  if (savingProfile.value || changingPassword.value || selectingImage.value) return
  passwordError.value = ''
  if (passwords.next !== passwords.confirm) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  if (passwords.current === passwords.next) {
    passwordError.value = '新密码不能与当前密码相同'
    return
  }
  changingPassword.value = true
  try {
    await $fetch('/api/me/password', { method: 'PUT', body: { currentPassword: passwords.current, password: passwords.next } })
    revision++
    Object.assign(passwords, { current: '', next: '', confirm: '' })
    clearNuxtData()
    await navigateTo('/login', { replace: true, external: true })
  } catch (cause) {
    passwordError.value = coreError(cause, '修改密码失败')
  } finally { changingPassword.value = false }
}
onBeforeRouteLeave(to => {
  if (!session.value) return
  if (savingProfile.value || changingPassword.value || selectingImage.value) return false
  if (dirty.value) {
    discard.request(() => { resetProfile(); void navigateTo(to.fullPath) })
    return false
  }
})
</script>

<template>
  <CoreShell title="个人资料" :refresh-page="refreshProfile">
    <div v-if="session" class="space-y-6">
      <ConsoleProfileLayout :show-heading="false">
        <form class="core-editor space-y-6" @submit.prevent="saveProfile">
          <AccountImageInput v-model="avatar" label="头像" purpose="profile" portal="tenant"
            :fallback="brand?.defaultAvatar || '/brand/admin-avatar.png'" clear-to-fallback
            :disabled="savingProfile || changingPassword" @busy="selectingImage = $event" />
          <UFormField label="登录账号"><ConsoleInput :model-value="session.account.login" disabled /></UFormField>
          <UFormField label="昵称" required>
            <ConsoleInput v-model="nickname" required :maxlength="100" autocomplete="nickname" :disabled="savingProfile || changingPassword" />
          </UFormField>
          <UAlert v-if="profileError" role="alert" color="error" :title="profileError" />
          <ConsoleFormActions>
            <UButton type="button" color="neutral" variant="outline" :disabled="!dirty || savingProfile || selectingImage || changingPassword" @click="discard.request(resetProfile)">取消修改</UButton>
            <UButton type="submit" :loading="savingProfile" :aria-busy="savingProfile" :disabled="!dirty || selectingImage || savingProfile || changingPassword">保存资料</UButton>
          </ConsoleFormActions>
        </form>
        <template #aside>
          <dl class="space-y-5 text-sm">
            <div><dt class="text-muted">账号角色</dt><dd class="mt-2">{{ session.account.role.title }}</dd></div>
            <div><dt class="text-muted">管理范围</dt><dd class="mt-2">{{ session.brand }}</dd></div>
          </dl>
        </template>
      </ConsoleProfileLayout>
      <UCard id="password" class="surface-card scroll-mt-20">
        <template #header><h2>登录密码</h2></template>
        <form class="core-editor max-w-lg" @submit.prevent="changePassword">
          <UFormField label="当前密码" name="core-current-password" required>
            <ConsoleInput id="core-current-password" aria-label="当前密码" v-model="passwords.current"
              type="password" required :maxlength="128" autocomplete="current-password" :disabled="changingPassword" />
          </UFormField>
          <UFormField label="新密码" help="使用 12 到 128 个字符。" required>
            <ConsoleInput v-model="passwords.next" type="password" required :minlength="12" :maxlength="128" autocomplete="new-password" :disabled="changingPassword" />
          </UFormField>
          <UFormField label="确认新密码" required>
            <ConsoleInput v-model="passwords.confirm" type="password" required :minlength="12" :maxlength="128" autocomplete="new-password" :disabled="changingPassword" />
          </UFormField>
          <UAlert v-if="passwordError" role="alert" color="error" :title="passwordError" />
          <p class="m-0 text-sm text-muted">修改后，所有设备都需要使用新密码重新登录。</p>
          <ConsoleFormActions>
            <UButton type="submit" :loading="changingPassword" :aria-busy="changingPassword" :disabled="changingPassword || savingProfile || selectingImage">修改密码</UButton>
          </ConsoleFormActions>
        </form>
      </UCard>
    </div>
    <ConsoleDiscardChangesDialog :controller="discard" />
  </CoreShell>
</template>
