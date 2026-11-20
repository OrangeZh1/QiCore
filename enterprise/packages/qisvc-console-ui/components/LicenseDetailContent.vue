<script setup lang="ts">
import ConsoleEmptyState from './ConsoleEmptyState.vue'

type LicenseRecord = {
  useExpiresAt?: string | null
  authorizedDomain?: string | null
  bindingMode?: string | null
  rebindPolicy?: string | null
  rebindLimitMode?: 'ONCE' | 'COOLDOWN' | string | null
  rebindCooldownDays?: number | null
  freeRebindsRemaining?: number | null
  rebindEligibility?: {
    canRequestFree: boolean
    reasonCode?: string | null
    nextAllowedAt?: string | null
    paidRebindRequired?: boolean
    noticeVersion?: string | null
  } | null
  entitlements?: Array<{ type?: string, name?: string | null, packageKey: string }>
  instances?: Array<{ id: string, domain?: string | null, domainVerifiedAt?: string | null, status?: string | null }>
  rebindRequests?: Array<{ id: string, targetDomain?: string | null, targetIp?: string | null, createdAt?: string | null, status?: string | null, reviewReasonCode?: string | null, licenseSuspended?: boolean }>
}

const props = defineProps<{
  license: LicenseRecord
  formatDate: (value?: string | null) => string
}>()

const emit = defineEmits<{
  requestRebind: [instance?: NonNullable<LicenseRecord['instances']>[number]]
}>()

const groupMeta = {
  FRAMEWORK: { label: '框架', icon: 'i-lucide-blocks' },
  APP: { label: '应用', icon: 'i-lucide-app-window' },
  PLUGIN: { label: '插件', icon: 'i-lucide-plug' },
} as const
const entitlementGroups = computed(() => Object.entries(groupMeta).map(([type, meta]) => ({
  type,
  ...meta,
  items: props.license.entitlements?.filter(item => item.type === type) ?? [],
})))
const entitlementCount = computed(() => props.license.entitlements?.length ?? 0)
const instances = computed(() => props.license.instances ?? [])
const requests = computed(() => props.license.rebindRequests ?? [])
const approvedRebindPendingCompletion = computed(() => requests.value.some(request => request.status === 'APPROVED'))
const canRequestFreeRebind = computed(() => props.license.rebindEligibility?.canRequestFree === true)
const paidRebindRequired = computed(() => props.license.rebindEligibility?.paidRebindRequired === true)
const rebindLimitLabel = computed(() => props.license.rebindLimitMode === 'COOLDOWN'
  ? `冷却 ${props.license.rebindCooldownDays ?? 0} 天后可再次免费申请`
  : '仅 1 次免费换绑')
const remainingLabel = computed(() => props.license.freeRebindsRemaining === null || props.license.freeRebindsRemaining === undefined
  ? '剩余机会以提交时校验为准'
  : `剩余 ${props.license.freeRebindsRemaining} 次免费机会`)
const eligibilityLabel = computed(() => {
  if (approvedRebindPendingCompletion.value) return '换绑申请已批准，完成新域名验证后生效'
  if (canRequestFreeRebind.value) return '当前可申请免费换绑'
  const reason = props.license.rebindEligibility?.reasonCode ?? ''
  if (['FREE_REBIND_USED', 'FREE_REBIND_LIMIT_REACHED', 'NO_FREE_REBINDS'].includes(reason) || props.license.freeRebindsRemaining === 0) return '免费换绑机会已用完'
  if (reason === 'COOLDOWN_ACTIVE' && props.license.rebindEligibility?.nextAllowedAt) return `免费换绑冷却中，${props.formatDate(props.license.rebindEligibility.nextAllowedAt)} 后可再次申请`
  if (['PENDING_REBIND_REQUEST', 'ACTIVE_REBIND_REQUEST'].includes(reason)) return approvedRebindPendingCompletion.value
    ? '换绑申请已批准，完成新域名验证后生效'
    : '已有换绑申请正在处理中'
  if (reason === 'LICENSE_NOT_ACTIVE') return '许可证当前不可用，无法申请换绑'
  if (reason === 'ACTIVE_SOURCE_INSTANCE_REQUIRED') return '当前可申请免费换绑'
  if (reason === 'CUSTOMER_REBIND_DISABLED') return '当前授权不支持客户自助换绑'
  return '当前不可发起免费换绑'
})
const unavailableActionLabel = computed(() => {
  const reason = props.license.rebindEligibility?.reasonCode ?? ''
  if (reason === 'COOLDOWN_ACTIVE') return '免费换绑冷却中'
  if (['PENDING_REBIND_REQUEST', 'ACTIVE_REBIND_REQUEST'].includes(reason)) return approvedRebindPendingCompletion.value
    ? '已批准 · 待域名验证'
    : '换绑申请待审核'
  return '暂不可申请换绑'
})

const bindingLabel = (value?: string | null) => ({
  DOMAIN: '域名绑定', DOMAIN_IP: '域名 + IP', INSTANCE: '实例绑定', NONE: '不限制绑定',
} as Record<string, string>)[value ?? ''] ?? '未配置'
const rebindLabel = (value?: string | null) => ({
  DENY: '禁止换绑', APPROVAL: '审核后换绑', AUTO_REVIEW: '主体一致自动审核', IMMEDIATE: '立即换绑', AUTO: '自动换绑', ALLOW: '允许换绑',
} as Record<string, string>)[value ?? ''] ?? '未配置'
const instanceStatusLabel = (value?: string | null) => ({
  ACTIVE: '正常', INACTIVE: '未激活', DISABLED: '已停用', REVOKED: '已撤销',
} as Record<string, string>)[value ?? ''] ?? '未知状态'
const requestStatusLabel = (value?: string | null) => ({
  PENDING: '待审核', APPROVED: '已批准 · 待域名验证', REJECTED: '已拒绝', COMPLETED: '已完成',
} as Record<string, string>)[value ?? ''] ?? '未知状态'
const requestStatusColor = (value?: string | null) => ({
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', COMPLETED: 'success',
} as Record<string, 'warning' | 'info' | 'error' | 'success' | 'neutral'>)[value ?? ''] ?? 'neutral'
const requestReasonLabel = (value?: string | null) => ({
  PERSONAL_SUBJECT_MISMATCH_CONFIRMED: '目标域名登记人与首次授权个人主体不一致',
  ORGANIZATION_CODE_MISMATCH_CONFIRMED: '目标域名企业主体代码与首次授权主体不一致',
  ORGANIZATION_NAME_MISMATCH_CONFIRMED: '目标域名企业名称与首次授权主体不一致',
  ORGANIZATION_TO_PERSONAL_LEGAL_REPRESENTATIVE_MISMATCH_CONFIRMED: '目标域名登记人与原授权企业法人不一致',
  ORGANIZATION_TO_PERSONAL_SUBJECT_MISMATCH_CONFIRMED: '历史审核未核验原授权企业法人关系，需要人工复核',
} as Record<string, string>)[value ?? ''] ?? '未提供详细审核原因'
</script>

<template>
  <div class="space-y-5">
    <UCard class="surface-card" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex items-center gap-3 border-b border-default px-5 py-4">
        <span class="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><UIcon name="i-lucide-key-round" class="size-4.5" /></span>
        <div><h2 class="font-semibold text-highlighted">许可证配置</h2><p class="mt-0.5 text-xs text-muted">期限、域名与绑定策略</p></div>
      </div>
      <dl class="grid sm:grid-cols-2 xl:grid-cols-4">
        <div class="border-b border-default px-5 py-4 sm:border-e xl:border-b-0"><dt class="text-xs text-muted">使用期限</dt><dd class="mt-1.5 truncate text-sm font-medium text-highlighted">{{ formatDate(license.useExpiresAt) }}</dd></div>
        <div class="border-b border-default px-5 py-4 xl:border-b-0 xl:border-e"><dt class="text-xs text-muted">当前授权域名</dt><dd class="mt-1.5 truncate text-sm font-medium text-highlighted" :title="license.authorizedDomain || ''">{{ license.authorizedDomain || '首次激活时确认' }}</dd></div>
        <div class="border-b border-default px-5 py-4 sm:border-e sm:border-b-0"><dt class="text-xs text-muted">绑定策略</dt><dd class="mt-1.5 text-sm font-medium text-highlighted">{{ bindingLabel(license.bindingMode) }}</dd></div>
        <div class="px-5 py-4"><dt class="text-xs text-muted">换绑策略</dt><dd class="mt-1.5 text-sm font-medium text-highlighted">{{ rebindLabel(license.rebindPolicy) }}</dd><p class="mt-1 text-xs text-muted">{{ rebindLimitLabel }} · {{ remainingLabel }}</p></div>
      </dl>
    </UCard>

    <UCard class="surface-card" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex items-center justify-between gap-4 border-b border-default px-5 py-4">
        <div><h2 class="font-semibold text-highlighted">产品权益</h2><p class="mt-0.5 text-xs text-muted">按产品类型查看当前许可证可用内容</p></div>
        <UBadge color="neutral" variant="outline">共 {{ entitlementCount }} 项</UBadge>
      </div>
      <div class="grid lg:grid-cols-3">
        <section v-for="group in entitlementGroups" :key="group.type" class="min-w-0 px-5 py-4 lg:border-e lg:border-default lg:last:border-e-0">
          <div class="flex items-center gap-2 pb-3">
            <UIcon :name="group.icon" class="size-4 text-muted" />
            <h3 class="text-sm font-medium text-highlighted">{{ group.label }}</h3>
            <span class="ms-auto text-xs tabular-nums text-muted">{{ group.items.length }} 项</span>
          </div>
          <div v-if="group.items.length" class="max-h-64 divide-y divide-default overflow-y-auto border-t border-default">
            <div v-for="item in group.items" :key="item.packageKey" class="px-0.5 py-3 first:pt-3">
              <p class="truncate text-sm font-medium text-highlighted" :title="item.name?.trim() || '未命名产品'">{{ item.name?.trim() || '未命名产品' }}</p>
            </div>
          </div>
          <p v-else class="border-t border-default py-8 text-center text-sm text-muted">暂无{{ group.label }}权益</p>
        </section>
      </div>
    </UCard>

    <UCard class="surface-card" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex flex-col gap-3 border-b border-default px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 class="font-semibold text-highlighted">绑定管理</h2><p class="mt-0.5 text-xs text-muted">{{ eligibilityLabel }}；无需部署实例也可申请换绑域名</p></div>
        <UBadge v-if="approvedRebindPendingCompletion" color="success" variant="subtle" size="sm" icon="i-lucide-circle-check-big" class="shrink-0">已批准 · 待域名验证</UBadge>
        <UButton v-else-if="canRequestFreeRebind" size="sm" icon="i-lucide-refresh-cw" class="shrink-0 justify-center rounded-md" @click="emit('requestRebind')">申请换绑域名</UButton>
        <UButton v-else-if="paidRebindRequired" color="warning" variant="soft" size="sm" icon="i-lucide-headphones" class="shrink-0 justify-center rounded-md" to="https://mcent.cn/contact" target="_blank" rel="noopener noreferrer">联系官方付费换绑</UButton>
        <UButton v-else color="neutral" variant="soft" size="sm" icon="i-lucide-lock" class="shrink-0 justify-center rounded-md" disabled>{{ unavailableActionLabel }}</UButton>
      </div>
        <div v-if="instances.length" class="max-h-80 divide-y divide-default overflow-y-auto">
          <div v-for="instance in instances" :key="instance.id" class="flex flex-wrap items-center gap-3 px-5 py-4">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated"><UIcon name="i-lucide-server" class="size-4 text-muted" /></span>
            <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-highlighted" :title="instance.domain || ''">{{ instance.domain || '未绑定域名' }}</p><p class="mt-0.5 text-xs text-muted">{{ instance.domainVerifiedAt ? '域名已验证' : '域名待验证' }}</p></div>
            <UBadge :color="instance.status === 'ACTIVE' ? 'success' : 'neutral'" variant="subtle">{{ instanceStatusLabel(instance.status) }}</UBadge>
          </div>
        </div>
        <ConsoleEmptyState
          v-else
          compact
          icon="i-lucide-server-off"
          title="尚无部署实例"
          description="不影响申请换绑域名"
        />
    </UCard>

    <UCard class="surface-card" :ui="{ body: 'p-0 sm:p-0' }">
        <div class="border-b border-default px-5 py-4"><h2 class="font-semibold text-highlighted">换绑审核</h2><p class="mt-0.5 text-xs text-muted">查看最近提交的域名变更与审核状态</p></div>
        <div v-if="requests.length" class="max-h-80 divide-y divide-default overflow-y-auto">
          <div v-for="request in requests" :key="request.id" class="flex items-center gap-3 px-5 py-4">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated"><UIcon name="i-lucide-history" class="size-4 text-muted" /></span>
            <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-highlighted" :title="request.targetDomain || ''">{{ request.targetDomain || '未指定域名' }}</p><p v-if="request.targetIp" class="mt-0.5 truncate font-mono text-xs text-muted" :title="request.targetIp">{{ request.targetIp }}</p><p class="mt-0.5 text-xs text-muted">{{ formatDate(request.createdAt) }}</p><p v-if="request.licenseSuspended" class="mt-1 break-words text-xs leading-5 text-error">授权已封禁：{{ requestReasonLabel(request.reviewReasonCode) }}。如需申诉请联系人工客服。</p></div>
            <UBadge :color="requestStatusColor(request.status)" variant="subtle">{{ requestStatusLabel(request.status) }}</UBadge>
          </div>
        </div>
        <ConsoleEmptyState
          v-else
          compact
          icon="i-lucide-inbox"
          title="暂无换绑申请"
          description="最近提交的域名变更与审核结果会显示在这里"
        />
    </UCard>
  </div>
</template>
