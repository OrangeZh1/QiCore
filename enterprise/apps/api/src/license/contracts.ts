import { z } from 'zod'

// Receipt and signing subset of the campus QiLicense v2 contract.
export const LICENSE_ISSUER = 'https://license.mcent.cn' as const
export const LICENSE_AUDIENCE = 'qiadmin-runtime' as const
export const LEGACY_LICENSE_PROTOCOL_VERSION = 'license-api-v1' as const
export const LICENSE_PROTOCOL_VERSION = 'license-api-v2' as const
export const RELEASE_SCHEMA_VERSION = 'qiadmin-release-v1' as const
export const RELEASE_SIGNATURE_DOMAIN = 'QiAdmin.ReleaseSignature.v1\0' as const
export const RELEASE_SIGNATURE_ENVELOPE_FORMAT = 'qiadmin-release-signature-v1' as const
export const MAX_RELEASE_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024

// Wire timestamps are canonical UTC values with exactly millisecond precision.
// This keeps signed bytes identical across Node and PHP and rejects alternate
// but semantically equivalent representations before signature verification.
export const utcDateTimeMillisSchema = z.iso.datetime({ precision: 3 })

export const bindingModeSchema = z.enum(['none', 'domain', 'domain_ip'])
export const releaseChannelSchema = z.enum(['stable', 'beta'])
export const componentTypeSchema = z.enum(['framework', 'app', 'plugin'])
export const releaseArtifactPackageTypeSchema = z.enum(['framework_update', 'app_update', 'plugin_update'])
export const entitlementSubjectSchema = componentTypeSchema

export const entitlementSnapshotSchema = z.object({
  packageKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  type: entitlementSubjectSchema,
  useExpiresAt: utcDateTimeMillisSchema.nullable(),
  updatesExpiresAt: utcDateTimeMillisSchema.nullable(),
  channel: releaseChannelSchema,
  // Missing in an older receipt means unknown; only an explicit null means unlimited.
  tenantLimit: z.number().int().nonnegative().nullable().optional(),
  licenseValidationEnabled: z.boolean().default(true),
  verificationMode: bindingModeSchema.default('domain_ip'),
  onlineUpdateEnabled: z.boolean().default(true),
  unauthorizedMessage: z.string().max(500).nullable().default(null),
  licenseExpiredMessage: z.string().max(500).nullable().default(null),
  updateExpiredMessage: z.string().max(500).nullable().default(null),
  suspendedMessage: z.string().max(500).nullable().default(null),
}).strict()

export const licenseDecisionReasonSchema = z.enum([
  'AUTHORIZED',
  'PRODUCT_AUTHORIZATION_NOT_FOUND',
  'LICENSE_DELETED',
  'LICENSE_SUSPENDED',
  'LICENSE_REVOKED',
  'LICENSE_EXPIRED',
  'COMPONENT_DISABLED',
  'PRODUCT_NOT_ENTITLED',
  'ENTITLEMENT_SUSPENDED',
  'ENTITLEMENT_REVOKED',
  'ENTITLEMENT_EXPIRED',
  'INSTANCE_PENDING',
  'INSTANCE_REPLACED',
  'INSTANCE_REVOKED',
  'DOMAIN_MISMATCH',
  'IP_MISMATCH',
])

export const bindingDirectiveSchema = z.object({
  request_id: z.string().min(1).max(191),
  status: z.enum(['approved', 'applied']),
  source_domain: z.string().min(1).max(253).nullable(),
  target_domain: z.string().min(1).max(253),
  target_ip: z.string().min(1).max(64).nullable(),
  binding_mode: bindingModeSchema,
  approved_at: utcDateTimeMillisSchema,
}).strict()

export const licenseReceiptPayloadSchema = z.object({
  protocol: z.literal(LICENSE_PROTOCOL_VERSION),
  key_id: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  issuer: z.literal(LICENSE_ISSUER),
  audience: z.literal(LICENSE_AUDIENCE),
  license_id: z.string().min(1).max(191).nullable(),
  company_name: z.string().max(191).nullable().optional(),
  revision: z.number().int().positive(),
  product_id: z.string().min(1).max(191),
  instance_id: z.string().min(32).max(191),
  instance_public_key_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  authorized_domain: z.string().min(1).max(253).nullable(),
  authorized_server_ip: z.string().min(1).max(64).nullable(),
  mode: bindingModeSchema,
  domain_matched: z.boolean().nullable(),
  server_ip_matched: z.boolean().nullable(),
  decision: z.enum(['allow', 'deny']),
  reason_code: licenseDecisionReasonSchema,
  decision_id: z.string().min(1).max(191),
  entitlements: z.array(entitlementSnapshotSchema),
  issued_at: utcDateTimeMillisSchema,
  refresh_after: utcDateTimeMillisSchema,
  online_valid_until: utcDateTimeMillisSchema,
  grace_until: utcDateTimeMillisSchema,
  binding_directive: bindingDirectiveSchema.nullable(),
}).strict().superRefine((payload, context) => {
  const issuedAt = Date.parse(payload.issued_at)
  const refreshAfter = Date.parse(payload.refresh_after)
  const onlineValidUntil = Date.parse(payload.online_valid_until)
  const graceUntil = Date.parse(payload.grace_until)
  if (!(issuedAt <= refreshAfter && refreshAfter <= onlineValidUntil && onlineValidUntil <= graceUntil)) {
    context.addIssue({ code: 'custom', path: ['issued_at'], message: 'Receipt timestamps must be monotonically ordered' })
  }
  if (payload.decision === 'allow' && payload.license_id === null) {
    context.addIssue({ code: 'custom', path: ['license_id'], message: 'Allowed receipts must identify a license' })
  }
  if (payload.decision === 'allow' && payload.reason_code !== 'AUTHORIZED') {
    context.addIssue({ code: 'custom', path: ['reason_code'], message: 'Allowed receipts must use AUTHORIZED' })
  }
  if (payload.decision === 'deny' && payload.reason_code === 'AUTHORIZED') {
    context.addIssue({ code: 'custom', path: ['reason_code'], message: 'Denied receipts must carry a denial reason' })
  }
  if (payload.instance_id !== payload.instance_public_key_sha256) {
    context.addIssue({ code: 'custom', path: ['instance_public_key_sha256'], message: 'Instance id must equal the public-key fingerprint' })
  }
  const anonymousDiscoveryReasons = [
    'PRODUCT_AUTHORIZATION_NOT_FOUND',
    'LICENSE_SUSPENDED',
    'LICENSE_REVOKED',
    'LICENSE_EXPIRED',
    'ENTITLEMENT_SUSPENDED',
    'ENTITLEMENT_REVOKED',
    'ENTITLEMENT_EXPIRED',
  ]
  if (payload.license_id === null && (
    payload.decision !== 'deny'
    || !anonymousDiscoveryReasons.includes(payload.reason_code)
    || payload.entitlements.length !== 0
    || payload.binding_directive !== null
    || payload.authorized_domain !== null
    || payload.authorized_server_ip !== null
    || payload.domain_matched !== null
    || payload.server_ip_matched !== null
  )) {
    context.addIssue({ code: 'custom', path: ['license_id'], message: 'Anonymous receipts are restricted to installation discovery denials' })
  }
  if (payload.mode === 'domain_ip' && payload.decision === 'allow' && payload.authorized_server_ip === null) {
    context.addIssue({ code: 'custom', path: ['authorized_server_ip'], message: 'DOMAIN_IP receipts must identify the authorized server IP' })
  }
  if (payload.mode === 'domain' && payload.authorized_server_ip !== null) {
    context.addIssue({ code: 'custom', path: ['authorized_server_ip'], message: 'Domain-only receipts must not bind a server IP' })
  }
  if (payload.mode !== 'domain_ip' && payload.server_ip_matched !== null) {
    context.addIssue({ code: 'custom', path: ['server_ip_matched'], message: 'Only DOMAIN_IP receipts may carry an IP match result' })
  }
  if (payload.binding_directive?.binding_mode === 'domain_ip' && payload.binding_directive.target_ip === null) {
    context.addIssue({ code: 'custom', path: ['binding_directive', 'target_ip'], message: 'DOMAIN_IP directives must identify the approved target IP' })
  }
  if (payload.binding_directive && payload.binding_directive.binding_mode !== 'domain_ip' && payload.binding_directive.target_ip !== null) {
    context.addIssue({ code: 'custom', path: ['binding_directive', 'target_ip'], message: 'Only DOMAIN_IP directives may carry a target IP' })
  }
  const packageKeys = new Set<string>()
  payload.entitlements.forEach((entitlement, index) => {
    if (packageKeys.has(entitlement.packageKey)) {
      context.addIssue({ code: 'custom', path: ['entitlements', index, 'packageKey'], message: 'Duplicate entitlement package key' })
    }
    packageKeys.add(entitlement.packageKey)
  })
})


// QiLicense v2 signed framework component catalog. It is metadata, never a purchase grant.
export const componentCatalogPayloadSchema = z.object({
  protocol: z.literal(LICENSE_PROTOCOL_VERSION),
  key_id: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  productId: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  licenseId: z.string().min(1).max(191),
  revision: z.number().int().positive(),
  instanceId: z.string().regex(/^[a-f0-9]{64}$/),
  catalogRevision: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: utcDateTimeMillisSchema,
  validUntil: utcDateTimeMillisSchema,
  components: z.array(z.object({
    packageKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    type: z.enum(['app', 'plugin']),
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable(),
    plans: z.array(z.object({
      code: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/), name: z.string().min(1).max(100),
      priceCents: z.number().int().min(0).max(2_147_483_647), currency: z.string().regex(/^[A-Z]{3}$/),
      billingCycle: z.enum(['one_time','monthly','yearly']),
      licenseMonths: z.number().int().min(1).max(1200).nullable(),
      updateMonths: z.number().int().min(1).max(1200).nullable(),
    }).strict()).max(100),
  }).strict()).max(500),
}).strict().superRefine((catalog, context) => {
  const lifetime = Date.parse(catalog.validUntil) - Date.parse(catalog.issuedAt);
  if (lifetime <= 0 || lifetime > 300_000) context.addIssue({code:'custom',message:'Invalid catalog lifetime'});
  if (new Set(catalog.components.map(c=>c.packageKey)).size !== catalog.components.length
    || catalog.components.some(c=>new Set(c.plans.map(p=>p.code)).size !== c.plans.length)) {
    context.addIssue({code:'custom',message:'Duplicate catalog entries'});
  }
});

export const signedEnvelopeSchema = z.object({
  key_id: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  payload: z.string().regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).strict().superRefine((envelope, context) => {
  for (const field of ['payload', 'signature'] as const) {
    if (envelope[field].length % 4 === 1) {
      context.addIssue({ code: 'custom', path: [field], message: 'Base64url length is invalid' })
    }
  }
})


export function bootstrapSigningMessage(input: {
  protocol?: typeof LICENSE_PROTOCOL_VERSION
  licenseCodeSha256?: string
  appKey: string
  domain: string
  instancePublicKey: string
  timestamp: string
  nonce: string
}) {
  if (input.licenseCodeSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.licenseCodeSha256)) {
    throw new TypeError('Bootstrap license code SHA-256 is invalid')
  }
  const fields = [
    'qilicense-bootstrap-v1',
    ...(input.protocol ? [input.protocol] : []),
    ...(input.licenseCodeSha256 ? [`license-code-sha256:${input.licenseCodeSha256}`] : []),
    input.appKey,
    input.domain,
    input.instancePublicKey,
    input.timestamp,
    input.nonce,
  ]
  return fields.join('\n')
}


export function decodeCanonicalBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new TypeError('Invalid base64url value')
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const decoded = Uint8Array.from(atob(normalized + '='.repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0))
  let binary = ''
  for (let i = 0; i < decoded.length; i += 32768) binary += String.fromCharCode(...decoded.subarray(i, i + 32768))
  const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  if (encoded !== value) throw new TypeError('Non-canonical base64url value')
  return decoded
}


export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError('Canonical JSON input contains a non-JSON value')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON input contains a non-finite number')
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}


export type SignedEnvelope = z.infer<typeof signedEnvelopeSchema>
export type LicenseReceiptPayload = z.infer<typeof licenseReceiptPayloadSchema>
