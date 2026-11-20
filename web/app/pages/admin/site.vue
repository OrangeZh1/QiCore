<script setup lang="ts">
import AccountImageInput from '../../components/material/AccountImageInput.vue'
import ConsoleDiscardChangesDialog from '../../console-ui/ConsoleDiscardChangesDialog.vue'
import ConsoleSettingsActions from '../../console-ui/ConsoleSettingsActions.vue'
import ConsoleSettingsField from '../../console-ui/ConsoleSettingsField.vue'
import ConsoleInput from '../../console-ui/ConsoleInput.vue'

definePageMeta({ middleware: 'core-access', corePermission: 'core.site.read' })
type Config = {
  name: string; logo: string | null; favicon: string | null; defaultAvatar: string | null; copyright: string
  filing: { icpNumber: string; icpLink: string; policeNumber: string; policeLink: string }
}
type Settings = { config: Config; version: number; updatedAt: string | null; inherited: boolean; canWrite: boolean }
const endpoint = '/api/admin/site-settings'
const toast = useToast()
const { data: initial, error: initialError } = await useFetch<Settings>(endpoint)
const data = shallowRef(initial.value)
const clone = (value: Config): Config => JSON.parse(JSON.stringify(value))
const form = ref<Config | null>(data.value ? clone(data.value.config) : null)
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(data.value?.config ?? null))
const busy = ref<'refresh' | 'retry' | 'save'>()
const uploads = ref(0)
const error = ref(initialError.value ? coreError(initialError.value, '站点设置读取失败') : '')
const locked = computed(() => !!busy.value || !data.value?.canWrite)
const discard = useDiscardChanges(() => !!busy.value || !!uploads.value)
const { data: publicBrand } = useNuxtData<Config & { version: number }>('core-site-brand')
const lifetime = new AbortController()
const brandMark = useAppConfig().qicore.brandMark
const images = [
  { key: 'logo', label: '网站 Logo', size: 512, fallback: brandMark },
  { key: 'favicon', label: '浏览器图标', size: 100, fallback: brandMark },
  { key: 'defaultAvatar', label: '默认头像', size: 256, fallback: '/brand/admin-avatar.png' },
] as const
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
function fill(value: Settings) {
  data.value = value
  form.value = clone(value.config)
  error.value = ''
}
function cancel() { if (data.value) fill(data.value) }
async function refresh(source: 'refresh' | 'retry' = 'refresh') {
  if (busy.value || uploads.value) return
  if (dirty.value && !await discard.decide(cancel)) return
  busy.value = source
  try {
    const value = await $fetch<Settings>(endpoint, { signal: lifetime.signal })
    if (!lifetime.signal.aborted) fill(value)
  } catch (cause) {
    if (!lifetime.signal.aborted) error.value = coreError(cause, '站点设置读取失败')
  } finally { busy.value = undefined }
}
async function save() {
  if (locked.value || uploads.value || !dirty.value || !data.value || !form.value) return
  busy.value = 'save'
  error.value = ''
  try {
    const saved = await $fetch<Settings>(endpoint, {
      method: 'PUT', signal: lifetime.signal, body: { config: clone(form.value), version: data.value.version },
    })
    if (lifetime.signal.aborted) return
    fill(saved)
    publicBrand.value = { ...saved.config, version: saved.version }
    await refreshNuxtData('core-session')
    toast.add({ title: '站点设置已保存', color: 'success' })
  } catch (cause) {
    if (!lifetime.signal.aborted) error.value = coreError(cause, '站点设置保存失败，修改已保留')
  } finally { busy.value = undefined }
}
onBeforeRouteLeave(to => {
  if (busy.value || uploads.value) return false
  if (dirty.value) {
    discard.request(() => { cancel(); void navigateTo(to.fullPath) })
    return false
  }
})
onBeforeUnmount(() => lifetime.abort())
</script>
<template><CoreShell title="站点设置" :refresh-page="() => refresh()"><div class="space-y-5">
 
 <UAlert v-if="error" role="alert" color="error" :title="error"><template v-if="!data" #actions><UButton :loading="busy==='retry'" @click="refresh('retry')">重试</UButton></template></UAlert>
 <form v-if="form&&data" class="tenant-site-settings core-editor space-y-5" @submit.prevent="save">
  <section class="surface-card space-y-6 p-5 sm:p-7"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-sm font-semibold">站点信息</h2><span class="text-xs text-muted">{{data.inherited || !data.updatedAt ? '当前使用框架默认配置' : '更新于 ' + dateFormat.format(new Date(data.updatedAt))}}</span></div>
   <ConsoleSettingsField label="显示名称" input-id="tenant-site-name"><ConsoleInput id="tenant-site-name" v-model="form.name" :maxlength="30" required :disabled="locked"/><p class="mt-2 text-xs text-muted">用于本站后台侧栏和浏览器标题，最多 30 字。</p></ConsoleSettingsField>
   <ConsoleSettingsField v-for="image in images" :key="image.key" :label="image.label"><AccountImageInput v-model="form[image.key]" :label="image.label" portal="tenant" fit="contain" :image-size="image.size" clear-to-fallback :fallback="image.fallback" :disabled="locked" @busy="uploads+=$event?1:-1"/><p class="mt-2 text-xs text-muted">移除自定义图片后使用默认图片。</p></ConsoleSettingsField>
  </section>
  <section class="surface-card space-y-6 p-5 sm:p-7"><h2 class="text-sm font-semibold">版权与备案</h2>
   <ConsoleSettingsField label="版权信息" input-id="tenant-site-copyright"><ConsoleInput id="tenant-site-copyright" v-model="form.copyright" :maxlength="160" :disabled="locked" placeholder="留空则不显示版权信息"/></ConsoleSettingsField>
   <ConsoleSettingsField label="ICP备案号" input-id="tenant-site-icp"><ConsoleInput id="tenant-site-icp" v-model="form.filing.icpNumber" :maxlength="80" :disabled="locked"/></ConsoleSettingsField>
   <ConsoleSettingsField label="ICP备案链接" input-id="tenant-site-icp-link"><ConsoleInput id="tenant-site-icp-link" v-model="form.filing.icpLink" type="url" :maxlength="2048" :disabled="locked" placeholder="https://beian.miit.gov.cn"/></ConsoleSettingsField>
   <ConsoleSettingsField label="公安备案号" input-id="tenant-site-police"><ConsoleInput id="tenant-site-police" v-model="form.filing.policeNumber" :maxlength="80" :disabled="locked"/></ConsoleSettingsField>
   <ConsoleSettingsField label="公安备案链接" input-id="tenant-site-police-link"><ConsoleInput id="tenant-site-police-link" v-model="form.filing.policeLink" type="url" :maxlength="2048" :disabled="locked" placeholder="https://www.beian.gov.cn"/></ConsoleSettingsField>
  </section>
  <ConsoleSettingsActions :dirty="dirty" :busy="!!busy||!!uploads" :saving="busy==='save'" :can-write="data.canWrite" :hint="uploads?'图片处理中…':''" @cancel="discard.request(cancel)"/>
 </form>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></CoreShell></template>
<style scoped>.tenant-site-settings{--settings-label-width:8rem;--settings-content-width:28rem}</style>
