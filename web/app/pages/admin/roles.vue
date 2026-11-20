<script setup lang="ts">
import { dateTime } from '../../utils/core-date-time'
import ConsoleDrawer from '../../console-ui/ConsoleDrawer.vue'
import ConsoleQueryButton from '../../console-ui/ConsoleQueryButton.vue'
import ConsoleDiscardChangesDialog from '../../console-ui/ConsoleDiscardChangesDialog.vue'
import ConsoleDataTable from '../../console-ui/ConsoleDataTable.vue'
import ConsoleListFilters from '../../console-ui/ConsoleListFilters.vue'
import ConsoleListSearch from '../../console-ui/ConsoleListSearch.vue'
import ConsoleInput from '../../console-ui/ConsoleInput.vue'
import ConsoleSettingsField from '../../console-ui/ConsoleSettingsField.vue'
import ConsoleFormActions from '../../console-ui/ConsoleFormActions.vue'
import ConsoleActionConfirmationDialog from '../../console-ui/ConsoleActionConfirmationDialog.vue'

definePageMeta({ middleware: 'core-access', corePermission: 'core.roles.read' })

type Role = { id: string; name: string; permissions: string[]; enabled: boolean; version: number; userCount: number; editable: boolean; createdAt: string | null }
type Permission = { key: string; label: string; group: string; grantable: boolean }
type Listing = { items: Role[]; total: number; catalog: Permission[]; canWrite: boolean }

const endpoint = '/api/admin/roles'
const { data: session } = await useCoreSession()
const request = useRequestFetch()
const toast = useToast()
const q = ref('')
const search = ref('')
const status = ref('all')
const appliedStatus = ref('all')
const page = ref(1)
const pageSize = ref(20)
const loadAction = ref('')
const mutation = ref<'' | 'save' | 'confirm'>('')
const error = ref('')

function getPage(signal: AbortSignal) {
  return request<Listing>(endpoint, {
    query: { q: search.value, status: appliedStatus.value, page: page.value, pageSize: pageSize.value },
    signal,
  })
}
const initial = await useAsyncData('core-role-directory:' + session.value?.account.id, (_nuxt, { signal }) => getPage(signal))
const rows = ref<Listing>(initial.data.value || { items: [], total: 0, catalog: [], canWrite: false })
error.value = initial.error.value ? coreError(initial.error.value, '无法读取角色列表') : ''
const columns = [
  { accessorKey: 'name', header: '角色名称' }, { id: 'permissions', header: '功能权限' },
  { accessorKey: 'userCount', header: '关联管理员' }, { id: 'status', header: '状态' },
  { id: 'created', header: '创建时间' }, { id: 'actions', header: '操作' },
]
const editing = ref<Role | null>(null)
const editorOpen = ref(false)
const readonly = ref(false)
const formError = ref('')
const requestId = ref('')
const form = reactive({ name: '', permissions: [] as string[], enabled: true })
const baseline = ref('')
const dirty = computed(() => editorOpen.value && !readonly.value && JSON.stringify(form) !== baseline.value)
const discard = useDiscardChanges(() => !!mutation.value)
const available = computed(() => rows.value.catalog.filter(p => p.grantable))
const groups = computed(() => [...new Set(rows.value.catalog.map(p => p.group))].map(name => ({
  name, items: rows.value.catalog.filter(p => p.group === name),
})))
const confirmOpen = ref(false)
const target = ref<Role | null>(null)
const operation = ref<'toggle' | 'delete'>('toggle')
const lifetime = new AbortController()
let controller: AbortController | undefined

async function load(source: string) {
  controller?.abort()
  controller = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, controller.signal])
  loadAction.value = source
  try {
    const result = await getPage(signal)
    if (!signal.aborted) { rows.value = result; error.value = '' }
  } catch (cause) {
    if (!signal.aborted) error.value = coreError(cause, '无法读取角色列表')
  } finally {
    if (!signal.aborted) loadAction.value = ''
  }
}
function guard(action: () => void) {
  if (mutation.value) return
  if (dirty.value) discard.request(action)
  else action()
}
async function refresh() {
  if (mutation.value) return
  if (dirty.value && !await discard.decide(() => { editorOpen.value = false })) return
  editorOpen.value = false
  await load('refresh')
}
function filter(source: 'search' | 'reset') {
  if (source === 'reset') { q.value = ''; status.value = 'all' }
  search.value = q.value.trim()
  appliedStatus.value = status.value
  page.value = 1
  void load(source)
}
function changePage(next: number) {
  if (page.value === next) return
  page.value = next
  void load('page')
}
function changePageSize(size: number) {
  if (pageSize.value === size) return
  pageSize.value = size
  page.value = 1
  void load('page')
}

function open(row: Role | null, view = false) {
  editing.value = row
  readonly.value = view
  formError.value = ''
  requestId.value = crypto.randomUUID()
  Object.assign(form, { name: row?.name || '', permissions: [...(row?.permissions || [])], enabled: row?.enabled ?? true })
  baseline.value = JSON.stringify(form)
  editorOpen.value = true
}
function state(items: Permission[]): boolean | 'indeterminate' {
  const count = items.filter(p => form.permissions.includes(p.key)).length
  return count === 0 ? false : count === items.length ? true : 'indeterminate'
}
function select(items: Permission[], value: boolean | 'indeterminate') {
  const keys = items.filter(p => p.grantable).map(p => p.key)
  const selected = new Set(form.permissions)
  for (const key of keys) {
    if (value === true) {
      selected.add(key)
      const read = key.replace(/\.(write|manage)$/, '.read')
      if (rows.value.catalog.some(p => p.key === read && p.grantable)) selected.add(read)
    } else {
      selected.delete(key)
      if (key.endsWith('.read')) {
        for (const suffix of ['write', 'manage']) {
          const dependent = key.replace(/read$/, suffix)
          if (rows.value.catalog.some(p => p.key === dependent && p.grantable)) selected.delete(dependent)
        }
      }
    }
  }
  form.permissions = [...selected].sort()
}
async function save() {
  if (mutation.value || readonly.value) return
  if (!form.name.trim()) { formError.value = '请输入角色名称'; return }
  mutation.value = 'save'
  formError.value = ''
  try {
    const edited = editing.value
    await $fetch(edited ? endpoint + '/' + edited.id : endpoint, {
      method: edited ? 'PUT' : 'POST',
      body: { ...form, name: form.name.trim(), ...(edited ? { version: edited.version } : { requestId: requestId.value }) },
      signal: lifetime.signal,
    })
    if (lifetime.signal.aborted) return
    editorOpen.value = false
    toast.add({ title: '角色已保存', color: 'success' })
    await load('mutation')
  } catch (cause) {
    if (!lifetime.signal.aborted) formError.value = coreError(cause, '保存角色失败')
  } finally {
    mutation.value = ''
  }
}
function ask(row: Role, action: 'toggle' | 'delete') {
  target.value = row
  operation.value = action
  confirmOpen.value = true
}
async function confirm() {
  const row = target.value
  if (!row || mutation.value) return
  mutation.value = 'confirm'
  try {
    const deleting = operation.value === 'delete'
    await $fetch(endpoint + '/' + row.id, {
      method: deleting ? 'DELETE' : 'PUT',
      body: deleting ? { version: row.version } : { name: row.name, permissions: row.permissions, enabled: !row.enabled, version: row.version },
      signal: lifetime.signal,
    })
    if (lifetime.signal.aborted) return
    confirmOpen.value = false
    toast.add({ title: deleting ? '角色已删除' : '角色状态已更新', color: 'success' })
    await load('mutation')
  } catch (cause) {
    if (!lifetime.signal.aborted) toast.add({ title: coreError(cause, '操作失败'), color: 'error' })
  } finally {
    mutation.value = ''
  }
}
onBeforeRouteLeave(to => {
  if (mutation.value) return false
  if (dirty.value) {
    discard.request(() => { editorOpen.value = false; void navigateTo(to.fullPath) })
    return false
  }
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || mutation.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  controller?.abort()
  lifetime.abort()
  if (import.meta.client) window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
 <CoreShell title="角色" :refresh-page="refresh">
 <template #actions><UButton v-if="rows.canWrite" icon="i-lucide-plus" :disabled="!!error||!!mutation" @click="open(null)">新增角色</UButton></template>
 <div class="space-y-5">
 <form class="core-editor core-role-filters" @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索角色名称"/><USelect v-model="status" :items="[{label:'全部状态',value:'all'},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]" aria-label="角色状态筛选"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="loadAction==='reset'" @click="filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
 <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" empty-title="暂无角色" empty-description="按工作职责创建角色，再分配给管理员。" @retry="load('retry')" @update:page="changePage" @update:page-size="changePageSize">
  <template #name-cell="{row}"><span class="font-medium text-highlighted">{{row.original.name}}</span></template><template #permissions-cell="{row}">{{row.original.permissions.length}} 项权限</template>
  <template #status-cell="{row}"><UBadge :color="row.original.enabled?'success':'neutral'" variant="subtle">{{row.original.enabled?'启用':'停用'}}</UBadge></template><template #created-cell="{row}"><span class="text-xs text-muted">{{dateTime(row.original.createdAt)}}</span></template>
  <template #actions-cell="{row}"><div class="flex gap-3"><UButton class="px-0" variant="link" size="sm" @click="open(row.original,true)">详情</UButton><template v-if="row.original.editable"><UButton class="px-0" variant="link" size="sm" @click="open(row.original)">编辑</UButton><UButton class="px-0" variant="link" size="sm" :color="row.original.enabled?'error':'primary'" @click="ask(row.original,'toggle')">{{row.original.enabled?'停用':'启用'}}</UButton><UButton class="px-0" variant="link" size="sm" color="error" @click="ask(row.original,'delete')">删除</UButton></template></div></template>
 </ConsoleDataTable>
 <ConsoleDrawer :open="editorOpen" :title="readonly?'角色详情':editing?'编辑角色':'新增角色'" :dismissible="!mutation" :close="!mutation" wide @update:open="!$event&&guard(()=>editorOpen=false)"><template #body><form id="core-role-form" class="core-editor core-role-drawer space-y-6" @submit.prevent="save">
  <ConsoleSettingsField label="角色名称" required><ConsoleInput v-model="form.name" aria-label="角色名称" required :maxlength="50" :disabled="!!mutation||readonly" placeholder="例如：运营人员"/></ConsoleSettingsField>
  <div class="flex items-center justify-between border-y border-default py-4"><UCheckbox v-if="!readonly" label="全选可授予权限" :model-value="state(available)" :disabled="!!mutation" @update:model-value="select(available,$event)"/><span class="text-sm text-muted">已选 {{form.permissions.length}} 项</span></div>
  <div v-for="group in groups" :key="group.name" class="space-y-4 border-b border-default pb-5"><h3 v-if="readonly" class="drawer-section-title">{{group.name}}</h3><UCheckbox v-else :label="group.name+'（全选）'" :model-value="state(group.items.filter(p=>p.grantable))" :disabled="!!mutation||!group.items.some(p=>p.grantable)" @update:model-value="select(group.items,$event)"/><div class="grid gap-3 sm:grid-cols-2"><UCheckbox v-for="item in group.items" :key="item.key" :label="item.label" :model-value="form.permissions.includes(item.key)" :disabled="!!mutation||readonly||!item.grantable" @update:model-value="select([item],$event)"/></div></div>
  <p v-for="key in form.permissions.filter(key=>!rows.catalog.some(p=>p.key===key))" :key="key" class="text-sm text-muted">{{key}}（当前不可授予）</p>
  <ConsoleSettingsField label="状态"><USwitch v-model="form.enabled" label="启用角色" :disabled="!!mutation||readonly"/></ConsoleSettingsField><p v-if="editing&&!readonly" class="text-xs text-muted">修改权限或状态后，关联管理员需重新登录。</p><UAlert v-if="formError" color="error" :title="formError"/>
 </form></template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="!!mutation" @click="guard(()=>editorOpen=false)">{{readonly?'关闭':'取消'}}</UButton><UButton v-if="!readonly" type="submit" form="core-role-form" :loading="mutation==='save'" :aria-busy="mutation==='save'" :disabled="!!mutation">{{editing?'保存修改':'创建角色'}}</UButton></ConsoleFormActions></template></ConsoleDrawer>
 <ConsoleActionConfirmationDialog v-model:open="confirmOpen" :title="operation==='delete'?'删除角色？':target?.enabled?'停用角色？':'启用角色？'" :subject="target?.name" :description="operation==='delete'?'有关联管理员的角色不能删除，请先调整管理员角色。':'状态变更后，关联管理员需重新登录。'" :confirm-label="operation==='delete'?'删除':target?.enabled?'停用':'启用'" :color="operation==='delete'||target?.enabled?'error':'primary'" :loading="mutation==='confirm'" @confirm="confirm"/>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div>
 </CoreShell>
</template>

<style scoped>
.core-role-drawer, .core-role-filters { display: block; }
</style>
