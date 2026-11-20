<script setup lang="ts">
import ConsoleActionConfirmationDialog from '../../console-ui/ConsoleActionConfirmationDialog.vue'
import ConsoleDataTable from '../../console-ui/ConsoleDataTable.vue'
import ConsoleDiscardChangesDialog from '../../console-ui/ConsoleDiscardChangesDialog.vue'
import ConsoleDrawer from '../../console-ui/ConsoleDrawer.vue'
import ConsoleFormActions from '../../console-ui/ConsoleFormActions.vue'
import ConsoleInput from '../../console-ui/ConsoleInput.vue'
import ConsoleListFilters from '../../console-ui/ConsoleListFilters.vue'
import ConsoleListSearch from '../../console-ui/ConsoleListSearch.vue'
import ConsoleQueryButton from '../../console-ui/ConsoleQueryButton.vue'
import ConsoleSettingsField from '../../console-ui/ConsoleSettingsField.vue'

definePageMeta({ middleware: 'core-access', corePermission: 'core.accounts.read' })

interface Administrator {
  id: string
  username: string
  nickname: string
  avatar: string | null
  phone: string
  roleId: string | null
  role: { name: string; enabled: boolean }
  enabled: boolean
  accountEnabled: boolean
  allowMultipleSessions: boolean
  version: number
  accountVersion: number
  createdAt: string
  editable: boolean
  accountEditable: boolean
  owner: boolean
}
type Listing = { items: Administrator[]; total: number; canWrite: boolean }
type RoleChoice = { id: string; name: string; assignable: boolean }
type Mode = 'create' | 'edit' | 'password'
type Status = 'all' | 'enabled' | 'disabled'
type ListAction = 'search' | 'reset' | 'page' | 'refresh' | 'mutation' | 'retry'

const endpoint = '/api/admin/administrators'
const { data: session } = await useCoreSession()
const toast = useToast()
const filters = reactive({ q: '', status: 'all' as Status })
const query = reactive({ q: '', status: 'all' as Status, page: 1, pageSize: 20 })
const { data: initial, error: initialError } = await useFetch<Listing>(endpoint, {
  query: { ...query }, key: 'core-administrators:' + session.value?.account.id, watch: false,
})
const rows = shallowRef<Listing>(initial.value ?? { items: [], total: 0, canWrite: false })
const listError = ref(initialError.value ? coreError(initialError.value, '管理员读取失败') : '')
const listAction = ref<ListAction>()
let listRequest: AbortController | undefined
const lifetime = new AbortController()
const statusOptions = [{ label: '全部状态', value: 'all' }, { label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]
const columns = [
  { id: 'staff', header: '管理员' }, { accessorKey: 'phone', header: '手机号' },
  { id: 'role', header: '所属角色' }, { id: 'status', header: '状态' },
  { id: 'created', header: '创建时间' }, { id: 'actions', header: '操作' },
]
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

async function load(action: ListAction) {
  listRequest?.abort()
  const request = new AbortController()
  listRequest = request
  listAction.value = action
  try {
    let result = await $fetch<Listing>(endpoint, { query: { ...query }, signal: request.signal })
    if (request.signal.aborted) return
    const lastPage = Math.max(1, Math.ceil(result.total / query.pageSize))
    if (query.page > lastPage) {
      query.page = lastPage
      result = await $fetch<Listing>(endpoint, { query: { ...query }, signal: request.signal })
    }
    if (!request.signal.aborted) { rows.value = result; listError.value = '' }
  } catch (cause) {
    if (!request.signal.aborted) listError.value = coreError(cause, '管理员读取失败')
  } finally {
    if (listRequest === request) listAction.value = undefined
  }
}
function filter(action: 'search' | 'reset') {
  if (action === 'reset') Object.assign(filters, { q: '', status: 'all' })
  Object.assign(query, { q: filters.q.trim(), status: filters.status, page: 1 })
  return load(action)
}
function changePage(value: number) {
  if (query.page === value) return
  query.page = value
  return load('page')
}
function changeSize(value: number) {
  if (query.pageSize === value) return
  Object.assign(query, { pageSize: value, page: 1 })
  return load('page')
}

const mode = ref<Mode>('create')
const selected = shallowRef<Administrator>()
const isSelf = computed(() => !!selected.value && selected.value.id === session.value?.account.id)
const editorOpen = ref(false)
const form = reactive({ username: '', nickname: '', phone: '', roleId: '', enabled: true, allowMultipleSessions: true, password: '', confirmation: '' })
const baseline = ref('')
const dirty = computed(() => editorOpen.value && JSON.stringify(form) !== baseline.value)
const mutation = ref<'save' | 'remove'>()
const discard = useDiscardChanges(() => !!mutation.value)
const formError = ref('')
const showPassword = ref(false)
const requestId = ref('')
const roleSearch = ref('')
const roleError = ref('')
const rolesLoading = ref(false)
const roleOptions = ref<{ label: string; value: string; disabled: boolean }[]>([])
const roleTotal = ref(0)
let roleRequest: AbortController | undefined
const editorTitle = computed(() => ({ create: '新增管理员', edit: '编辑管理员', password: '重置密码' })[mode.value])
const submitText = computed(() => ({ create: '创建管理员', edit: '保存修改', password: '确认重置' })[mode.value])
const roleLookupNeeded = computed(() => mode.value !== 'password' && !isSelf.value)
const canEditAccount = computed(() => mode.value === 'create' || !!selected.value?.accountEditable)

async function lookupRoles() {
  roleRequest?.abort()
  const request = new AbortController()
  roleRequest = request
  rolesLoading.value = true
  roleError.value = ''
  try {
    const result = await $fetch<{ items: RoleChoice[]; total: number }>(endpoint + '/roles', {
      query: { q: roleSearch.value.trim(), pageSize: 50 }, signal: request.signal,
    })
    if (request.signal.aborted) return
    roleTotal.value = result.total
    const options = result.items.map(role => ({ label: role.name, value: role.id, disabled: !role.assignable }))
    const row = selected.value
    if (row?.roleId && !options.some(role => role.value === row.roleId)) {
      options.push({ label: row.role.name, value: row.roleId, disabled: !row.role.enabled })
    }
    roleOptions.value = options
  } catch (cause) {
    if (!request.signal.aborted) roleError.value = coreError(cause, '角色读取失败')
  } finally {
    if (roleRequest === request) rolesLoading.value = false
  }
}
watch(roleSearch, () => { if (editorOpen.value && roleLookupNeeded.value) void lookupRoles() }, { flush: 'sync' })

function openEditor(type: Mode, row?: Administrator) {
  if (mutation.value) return
  mode.value = type
  selected.value = row
  showPassword.value = false
  formError.value = ''
  roleError.value = ''
  roleSearch.value = ''
  roleTotal.value = 0
  roleOptions.value = row?.roleId ? [{ label: row.role.name, value: row.roleId, disabled: !row.role.enabled }] : []
  requestId.value = crypto.randomUUID()
  Object.assign(form, {
    username: row?.username || '', nickname: row?.nickname || '', phone: row?.phone || '', roleId: row?.roleId || '',
    enabled: row?.enabled ?? true, allowMultipleSessions: row?.allowMultipleSessions ?? true, password: '', confirmation: '',
  })
  baseline.value = JSON.stringify(form)
  editorOpen.value = true
  if (roleLookupNeeded.value) void lookupRoles()
}
function close() {
  editorOpen.value = false
  roleRequest?.abort()
  form.password = ''
  form.confirmation = ''
}
function requestClose() {
  if (mutation.value) return
  if (dirty.value) discard.request(close)
  else close()
}

async function save() {
  if (mutation.value || (roleLookupNeeded.value && (rolesLoading.value || !!roleError.value))) return
  formError.value = ''
  if (mode.value !== 'password' && (!form.nickname.trim() || (roleLookupNeeded.value && !form.roleId))) {
    formError.value = '请填写名称并选择所属角色'
    return
  }
  if (mode.value !== 'edit' && form.password !== form.confirmation) {
    formError.value = '两次输入的密码不一致'
    return
  }
  const row = selected.value
  mutation.value = 'save'
  try {
    const fields = { nickname: form.nickname.trim(), phone: form.phone.trim(), allowMultipleSessions: form.allowMultipleSessions }
    const membership = { roleId: form.roleId, enabled: form.enabled }
    if (mode.value === 'create') {
      await $fetch(endpoint, { method: 'POST', body: { ...fields, ...membership, username: form.username.trim(), password: form.password, requestId: requestId.value }, signal: lifetime.signal })
    } else if (row && mode.value === 'password') {
      await $fetch(endpoint + '/' + row.id + '/password', { method: 'PUT', body: { password: form.password, version: row.version, accountVersion: row.accountVersion }, signal: lifetime.signal })
    } else if (row && isSelf.value) {
      const updated = await $fetch<{ displayName: string }>('/api/me', { method: 'PATCH', body: { displayName: fields.nickname }, signal: lifetime.signal })
      if (session.value?.account.id === row.id) {
        session.value = { ...session.value, account: { ...session.value.account, displayName: updated.displayName } }
        rows.value = { ...rows.value, items: rows.value.items.map(item => item.id === row.id ? { ...item, nickname: updated.displayName } : item) }
      }
    } else if (row) {
      await $fetch(endpoint + '/' + row.id, { method: 'PUT', body: {
        ...membership, ...(row.accountEditable ? fields : {}), version: row.version, accountVersion: row.accountVersion,
      }, signal: lifetime.signal })
    }
    if (!lifetime.signal.aborted) {
      close()
      toast.add({ title: { create: '管理员已创建', edit: '管理员已更新', password: '密码已重置，原有登录已失效' }[mode.value], color: 'success' })
      await load('mutation')
    }
  } catch (cause) {
    if (!lifetime.signal.aborted) formError.value = coreError(cause, '保存失败')
  } finally {
    mutation.value = undefined
  }
}

const removeTarget = shallowRef<Administrator>()
async function remove() {
  const row = removeTarget.value
  if (!row?.editable || row.id === session.value?.account.id || mutation.value) return
  mutation.value = 'remove'
  try {
    await $fetch(endpoint + '/' + row.id, { method: 'DELETE', body: { version: row.version }, signal: lifetime.signal })
    if (!lifetime.signal.aborted) {
      removeTarget.value = undefined
      toast.add({ title: '管理员已移除', color: 'success' })
      await load('mutation')
    }
  } catch (cause) {
    if (!lifetime.signal.aborted) toast.add({ title: coreError(cause, '移除失败'), color: 'error' })
  } finally {
    mutation.value = undefined
  }
}

onBeforeRouteLeave(to => {
  if (mutation.value) return false
  if (dirty.value) {
    discard.request(() => { close(); void navigateTo(to.fullPath) })
    return false
  }
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || mutation.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  listRequest?.abort()
  roleRequest?.abort()
  lifetime.abort()
  if (import.meta.client) window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template><CoreShell title="管理员" :refresh-page="() => load('refresh')">
 <template #actions><UButton v-if="rows.canWrite" icon="i-lucide-user-plus" :disabled="!!listError||!!mutation" @click="openEditor('create')">新增管理员</UButton></template>
 <div class="space-y-5">
 <form class="core-editor" role="search" aria-label="筛选管理员" @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="filters.q" placeholder="搜索账号、名称或手机号"/><USelect v-model="filters.status" :items="statusOptions" aria-label="管理员状态筛选"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="listAction==='search'" :aria-busy="listAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton type="button" kind="reset" color="neutral" variant="outline" :loading="listAction==='reset'" :aria-busy="listAction==='reset'" @click="filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
 <ConsoleDataTable :data="rows.items" :columns="columns" :error="listError" :page="query.page" :page-size="query.pageSize" :aria-busy="listAction==='page'" :total="rows.total" :client-pagination="false" empty-title="暂无管理员" empty-description="创建角色后可为管理员分配权限。" @retry="load('retry')" @update:page="changePage" @update:page-size="changeSize">
  <template #staff-cell="{row}"><div class="flex items-center gap-3"><img :src="row.original.avatar||'/brand/admin-avatar.png'" alt="" class="size-9 shrink-0 rounded-full object-cover"/><div><div class="flex items-center gap-2"><span class="font-medium text-highlighted">{{row.original.nickname}}</span><UBadge v-if="row.original.owner" size="sm" color="neutral" variant="subtle">负责人</UBadge><UBadge v-if="row.original.id===session?.account.id" size="sm" variant="subtle">本人</UBadge></div><p class="mt-1 text-xs text-muted">{{row.original.username}}</p></div></div></template>
  <template #phone-cell="{row}">{{row.original.phone||'—'}}</template><template #role-cell="{row}">{{row.original.role.name}}<span v-if="!row.original.role.enabled" class="ml-1 text-xs text-warning">角色已停用</span></template>
  <template #status-cell="{row}"><UBadge :color="row.original.enabled&&row.original.accountEnabled?'success':'neutral'" variant="subtle">{{!row.original.accountEnabled?'账号已停用':row.original.enabled?'启用':'停用'}}</UBadge></template><template #created-cell="{row}"><span class="text-xs text-muted">{{row.original.createdAt ? dateFormat.format(new Date(row.original.createdAt)) : '—'}}</span></template>
  <template #actions-cell="{row}">
   <div v-if="row.original.id === session?.account.id" class="flex gap-3">
     <UButton class="px-0" size="sm" variant="link" @click="openEditor('edit',row.original)">编辑</UButton>
     <UButton class="px-0" size="sm" variant="link" to="/admin/profile#password">修改密码</UButton>
   </div>
   <div v-else-if="rows.canWrite && row.original.editable" class="flex gap-3"><UButton class="px-0" size="sm" variant="link" @click="openEditor('edit',row.original)">编辑</UButton><UButton v-if="row.original.accountEditable" class="px-0" size="sm" variant="link" @click="openEditor('password',row.original)">重置密码</UButton><UButton class="px-0" size="sm" variant="link" color="error" @click="removeTarget=row.original">移除</UButton></div><span v-else class="text-xs text-muted">{{row.original.owner?'负责人受保护':'只读'}}</span></template>
   <template #errorActions><UButton size="sm" color="neutral" variant="outline" :loading="listAction==='retry'" @click="load('retry')">重新加载</UButton></template>
 </ConsoleDataTable>
 <p v-if="listAction==='page'" role="status" class="text-xs text-muted">正在读取第 {{ query.page }} 页…</p>
 <ConsoleDrawer :open="editorOpen" :title="editorTitle" :dismissible="!mutation" :close="!mutation" @update:open="!$event && requestClose()"><template #body><form id="core-administrator-form" class="core-editor space-y-6" @submit.prevent="save">
  <ConsoleSettingsField label="登录账号" required><ConsoleInput v-model="form.username" aria-label="登录账号" :disabled="!!mutation||mode!=='create'" autocomplete="off" required pattern="[a-zA-Z0-9_.@\-]{2,80}" :maxlength="80" placeholder="2–80 位字母、数字、点、@、横线或下划线"/></ConsoleSettingsField>
  <template v-if="mode!=='password'"><ConsoleSettingsField label="名称" required><ConsoleInput v-model="form.nickname" aria-label="名称" required :maxlength="100" :disabled="!!mutation||(!isSelf && !canEditAccount)"/></ConsoleSettingsField><ConsoleSettingsField label="手机号"><ConsoleInput v-model="form.phone" aria-label="手机号" type="tel" :maxlength="32" :disabled="!!mutation||isSelf||!canEditAccount"/></ConsoleSettingsField>
   <ConsoleSettingsField label="所属角色" required><ConsoleInput v-if="isSelf" :model-value="selected?.role.name" aria-label="所属角色" disabled /><USelectMenu v-else v-model="form.roleId" v-model:search-term="roleSearch" :items="roleOptions" value-key="value" ignore-filter :loading="rolesLoading" :disabled="!!mutation" class="w-full" placeholder="搜索并选择角色" aria-label="所属角色"/><p v-if="!isSelf&&!rolesLoading&&!roleError&&!roleOptions.length" class="mt-2 text-xs text-muted">暂无可分配角色，请先创建并启用角色。</p><p v-if="roleTotal>50" class="mt-2 text-xs text-muted">匹配 {{roleTotal}} 个角色，请搜索名称缩小范围。</p></ConsoleSettingsField>
   <UAlert v-if="roleError" color="error" :title="roleError"><template #actions><UButton size="sm" variant="outline" color="neutral" @click="lookupRoles">重试</UButton></template></UAlert>
  </template>
  <template v-if="mode!=='edit'"><ConsoleSettingsField :label="mode==='create'?'初始密码':'新密码'" required><ConsoleInput v-model="form.password" aria-label="密码" :type="showPassword?'text':'password'" autocomplete="new-password" required :minlength="12" :maxlength="128" :disabled="!!mutation"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" :icon="showPassword?'i-lucide-eye-off':'i-lucide-eye'" :aria-label="showPassword?'隐藏密码':'显示密码'" @click="showPassword=!showPassword"/></template></ConsoleInput></ConsoleSettingsField><ConsoleSettingsField label="确认密码" required><ConsoleInput v-model="form.confirmation" aria-label="确认密码" type="password" autocomplete="new-password" required :disabled="!!mutation"/></ConsoleSettingsField></template>
  <template v-if="mode!=='password'"><ConsoleSettingsField v-if="canEditAccount || isSelf" label="多处登录"><USwitch v-model="form.allowMultipleSessions" label="允许多处同时登录" :disabled="!!mutation||isSelf"/></ConsoleSettingsField><ConsoleSettingsField label="状态"><USwitch v-model="form.enabled" label="启用管理员" :disabled="!!mutation||isSelf"/></ConsoleSettingsField></template>
  <p v-if="mode!=='create' && !isSelf" class="text-xs text-muted">保存后，该管理员的原有登录会话将失效。</p><UAlert v-if="formError" color="error" :title="formError" role="alert"/>
 </form></template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="!!mutation" @click="requestClose">取消</UButton><UButton type="submit" form="core-administrator-form" :loading="mutation==='save'" :aria-busy="mutation==='save'" :disabled="roleLookupNeeded && (rolesLoading||!!roleError||!form.roleId)">{{submitText}}</UButton></ConsoleFormActions></template></ConsoleDrawer>
 <ConsoleActionConfirmationDialog :open="!!removeTarget" title="移除管理员？" :subject="removeTarget?.nickname" @update:open="value => { if (!value) removeTarget=undefined }" description="移除后，此管理员无法再登录，已有会话将失效。" confirm-label="移除" color="error" :loading="mutation==='remove'" @confirm="remove"/><ConsoleDiscardChangesDialog :controller="discard"/>
</div></CoreShell></template>
