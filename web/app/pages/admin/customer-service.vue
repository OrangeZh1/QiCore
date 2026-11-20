<script setup lang="ts">
import AccountImageInput from '../../components/material/AccountImageInput.vue'
import ConsoleInput from '../../console-ui/ConsoleInput.vue'
import ConsoleSettingsField from '../../console-ui/ConsoleSettingsField.vue'
import ConsoleValidatedForm from '../../console-ui/ConsoleValidatedForm.vue'
import ConsoleFormActions from '../../console-ui/ConsoleFormActions.vue'
import ConsoleDiscardChangesDialog from '../../console-ui/ConsoleDiscardChangesDialog.vue'

definePageMeta({ middleware: 'core-access', corePermission: 'core.content.read' })

type Contact = { miniMode: 'official' | 'page'; avatar: string | null; qrCode: string | null; phone: string; wechat: string; description: string }
type Settings = { config: Contact; canWrite: boolean; version: number }
const { api } = useCoreApi()
const toast = useToast()
const { data: account } = await useCoreSession()
const endpoint = '/admin/customer-service'
const initial = await useAsyncData('core-contact:' + account.value?.account.id, (_nuxt, { signal }) => api<Settings>(endpoint, 'GET', undefined, { signal }))
const data = ref(initial.data.value)
const form = ref<Contact>({ ...data.value?.config || { miniMode: 'page', avatar: null, qrCode: null, phone: '', wechat: '', description: '' } })
const baseline = ref(JSON.stringify(form.value))
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value)
const error = ref(initial.error.value?.message || '')
const busy = ref<'' | 'save' | 'refresh' | 'retry'>('')
const imageBusy = reactive({ avatar: false, qrCode: false })
const picking = computed(() => imageBusy.avatar || imageBusy.qrCode)
const locked = computed(() => !data.value?.canWrite || !!busy.value || picking.value)
const discard = useDiscardChanges(() => !!busy.value || picking.value)
const lifetime = new AbortController()

function fill(settings: Settings) {
  data.value = settings
  form.value = { ...settings.config }
  baseline.value = JSON.stringify(form.value)
  error.value = ''
}
function cancel() {
  form.value = JSON.parse(baseline.value)
  error.value = ''
}
async function refresh(action: 'refresh' | 'retry' = 'refresh') {
  if (busy.value || picking.value) return
  if (dirty.value && !await discard.decide(cancel)) return
  busy.value = action
  try { fill(await api<Settings>(endpoint, 'GET', undefined, { signal: lifetime.signal })) }
  catch (cause) { if (!lifetime.signal.aborted) error.value = (cause as Error).message }
  finally { busy.value = '' }
}
async function save() {
  if (locked.value || !dirty.value || !data.value) return
  busy.value = 'save'
  error.value = ''
  try {
    const updated = await api<Settings>(endpoint, 'PUT', { config: form.value, version: data.value.version }, { signal: lifetime.signal })
    fill(updated)
    toast.add({ title: '客服设置已保存', color: 'success' })
  } catch (cause) {
    if (!lifetime.signal.aborted) error.value = (cause as Error).message
  } finally {
    busy.value = ''
  }
}
onBeforeRouteLeave(to => {
  if (busy.value || picking.value) return false
  if (dirty.value) {
    discard.request(() => { cancel(); void navigateTo(to.fullPath) })
    return false
  }
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value || picking.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  lifetime.abort()
  if (import.meta.client) window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template>
  <CoreShell title="客服设置" :refresh-page="refresh">
    <div class="space-y-5">
      <UAlert v-if="error" role="alert" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy === 'retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
      <ConsoleValidatedForm v-if="data" class="consumer-settings surface-card" @submit="save" @invalid="error = $event">
        <div class="space-y-6 p-5 sm:p-7">
          <ConsoleSettingsField label="微信官方客服"><USwitch :model-value="form.miniMode === 'official'" :disabled="locked" aria-label="使用微信官方小程序客服" @update:model-value="form.miniMode = $event ? 'official' : 'page'" /><p class="mt-2 text-xs text-muted">开启后，小程序入口直接打开微信客服。H5 端始终显示下方的联系方式。</p></ConsoleSettingsField>
          <ConsoleSettingsField label="客服头像"><AccountImageInput v-model="form.avatar" label="客服头像" endpoint="/admin/materials/shared" fallback="" :image-size="256" :disabled="locked" @busy="imageBusy.avatar = $event" /></ConsoleSettingsField>
          <ConsoleSettingsField label="客服二维码"><AccountImageInput v-model="form.qrCode" label="客服二维码" endpoint="/admin/materials/shared" fallback="" :image-size="512" fit="contain" :disabled="locked" @busy="imageBusy.qrCode = $event" /><p class="mt-2 text-xs text-muted">保留完整二维码和四周留白。</p></ConsoleSettingsField>
          <ConsoleSettingsField label="联系电话" input-id="customer-phone"><ConsoleInput id="customer-phone" v-model="form.phone" :maxlength="30" :disabled="locked" placeholder="手机号或固定电话" /></ConsoleSettingsField>
          <ConsoleSettingsField label="客服微信号" input-id="customer-wechat"><ConsoleInput id="customer-wechat" v-model="form.wechat" :maxlength="64" :disabled="locked" placeholder="选填，用户可复制微信号" /></ConsoleSettingsField>
          <ConsoleSettingsField label="客服说明" input-id="customer-description"><UTextarea id="customer-description" v-model="form.description" :maxlength="1000" :rows="5" :disabled="locked" class="w-full" placeholder="例如服务时间、联系须知" /></ConsoleSettingsField>
        </div>
        <div v-if="data.canWrite" class="border-t border-default px-5 py-4 sm:px-7">
          <ConsoleFormActions>
            <UButton color="neutral" variant="outline" :disabled="locked || !dirty" @click="discard.request(cancel)">取消修改</UButton>
            <UButton type="submit" :loading="busy === 'save'" :disabled="locked || !dirty">保存设置</UButton>
          </ConsoleFormActions>
        </div>
      </ConsoleValidatedForm>
      <ConsoleDiscardChangesDialog :controller="discard" />
    </div>
  </CoreShell>
</template>
<style scoped>
.consumer-settings { --settings-label-width: 9rem; --settings-content-width: 32rem; display: block; padding: 0; }
</style>
