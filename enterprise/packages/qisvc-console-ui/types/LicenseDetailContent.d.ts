import type { DefineComponent, PropType } from 'vue'

export type LicenseDetailInstance = {
  id: string
  domain?: string | null
  domainVerifiedAt?: string | null
  status?: string | null
}

export type LicenseDetailRecord = {
  useExpiresAt?: string | null
  authorizedDomain?: string | null
  bindingMode?: string | null
  rebindPolicy?: 'DENY' | 'APPROVAL' | 'AUTO_REVIEW' | 'IMMEDIATE' | 'AUTO' | 'ALLOW' | string | null
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
  instances?: LicenseDetailInstance[]
  rebindRequests?: Array<{ id: string, targetDomain?: string | null, targetIp?: string | null, createdAt?: string | null, status?: string | null }>
}

type WithEmits<T> = T & { new(): { $emit: {
  (event: 'requestRebind', instance?: LicenseDetailInstance): void
} } }

declare const component: WithEmits<DefineComponent<{
  license: { type: PropType<LicenseDetailRecord>; required: true }
  formatDate: { type: PropType<(value?: string | null) => string>; required: true }
}>>
export default component
