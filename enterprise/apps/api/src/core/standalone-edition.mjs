import { randomUUID } from 'node:crypto'
import {maintenanceRoute} from './standalone-maintenance.mjs'
import { fail } from './errors.mjs'

// The edition is compiled into this delivery. The DB owns the enterprise identity.
export const productEdition = 'standalone'
const current = new WeakMap()
const owners = new WeakMap()
export const standaloneOwner = db => owners.get(db)
export function wholeProductRoute(parts,method) {
  const route=parts.join('/')
  return method==='GET'&&route==='admin/updates' ||
    method==='POST'&&['admin/updates/check','admin/updates/execute','admin/license/check'].includes(route)
}
export function requireProductOwner(session,site,main) {
  if(!main)fail('NOT_FOUND','当前站点没有商业整包',404)
  if(!site?.enabled||site.expiresAt&&site.expiresAt<=new Date()||site.id!==session.tenantId||
     session.role!=='tenant'||session.delegated||site.ownerAdminId!==session.id)fail('FORBIDDEN','仅站点负责人可管理整包更新',403)
}
const businessAreas = new Set([
  'overview','roles','administrators','storage','materials','after-sales','policies','help',
  'official-account','mini-program','page-sharing','page-routes','decoration','consumer-settings',
  'site-settings','branding','subscription-settings','sms-settings','payment-settings','payment-methods',
  'recharge','recharge-orders','points-ledger','entitlements','entitlement-ledger','transactions',
  'packages','member-levels','member-tags','member-rules','channels','h5','consumers','apps','config','records',
])
const ownAuth = new Map([['login','POST'],['me','GET'],['profile','PUT'],['password','PUT'],['logout','POST']])
const pathScoped = new Set(['policies','help','wechat-official','page-sharing'])

export function developmentBootstrapAllowed(env=process.env) {
  if (env.NODE_ENV !== 'development' || (!env.QICORE_DEV_WORKSPACE && env.QICORE_STANDALONE_BOOTSTRAP !== 'development')) return false
  try {
    const db = new URL(env.DATABASE_URL)
    return db.protocol === 'mysql:' && ['localhost','127.0.0.1','[::1]'].includes(db.hostname) &&
      db.username === 'qicore_dev' && db.pathname === '/qicore_development' && (env.API_HOST || '127.0.0.1') === '127.0.0.1'
  } catch { return false }
}

export async function provisionEnterprise(tx, { username, nickname, passwordHash, permissions, requestId }) {
  if (await tx.tenant.count() || await tx.adminAccount.count()) throw Error('STANDALONE_INSTALL_TARGET_NOT_EMPTY')
  const role = await tx.adminRole.upsert({
    where: { systemCode: 'tenant-admin' }, update: {},
    create: { id: randomUUID(), name: '管理员', portal: 'tenant', permissions, systemCode: 'tenant-admin' },
  })
  if (role.portal !== 'tenant' || !role.enabled) throw Error('STANDALONE_ADMIN_ROLE_INVALID')
  const owner = await tx.adminAccount.create({ data: { id: randomUUID(), username, nickname, passwordHash, roleId: role.id } })
  return bindNewOwner(tx, owner.id, requestId)
}

export async function bindNewOwner(tx, ownerId, requestId) {
  const enterprise = await tx.tenant.create({ data: { id: randomUUID(), name: '我的站点', ownerAdminId: ownerId, standaloneSlot: 1 } })
  await tx.adminTenantScope.create({ data: { adminId: ownerId, tenantId: enterprise.id } })
  await tx.audit.create({ data: { id: randomUUID(), scope: 'tenant', tenantId: enterprise.id, actor: ownerId,
    action: 'enterprise.bootstrap', details: requestId ? { attemptId: requestId } : {} } })
  return enterprise.id
}

export async function bindStandaloneEnterprise(db) {
  const rows = await db.tenant.findMany({ select: { id: true, standaloneSlot: true, ownerAdminId: true }, take: 2 })
  if (rows.length !== 1 || rows[0].standaloneSlot !== 1 || !rows[0].ownerAdminId || !/^[\w-]{1,64}$/.test(rows[0].id)) {
    throw Error('STANDALONE_ENTERPRISE_BINDING_REQUIRED')
  }
  const record = rows[0]
  const owner = await db.adminTenantScope.findUnique({ where: { adminId_tenantId: { adminId: record.ownerAdminId, tenantId: record.id } },
    include: { admin: { include: { role: true } } } })
  if (!owner?.enabled || !owner.admin.enabled || owner.admin.deletedAt || !owner.admin.role.enabled || owner.admin.role.portal !== 'tenant') {
    throw Error('STANDALONE_OWNER_SCOPE_INVALID')
  }
  const previous = current.get(db)
  if (previous && previous !== record.id) throw Error('STANDALONE_ENTERPRISE_CHANGED')
  current.set(db, record.id)
  owners.set(db,record.ownerAdminId)
  return record.id
}

export function enterpriseId(db) {
  const id = current.get(db)
  if (!id) throw Error('STANDALONE_ENTERPRISE_NOT_READY')
  return id
}

// Older SDK requests include tenantId. Treat it only as an assertion about the server's binding.
export function scopedInput(id, input) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.isBuffer(input))) {
    fail('INPUT_INVALID','请求参数无效',400)
  }
  if (input?.tenantId !== undefined && input.tenantId !== id) fail('ENTERPRISE_SCOPE_MISMATCH','站点范围不匹配',403)
  return { ...input, tenantId: id }
}

export function assertEnterpriseSession(id, session) {
  if (session?.role !== 'tenant' || session.delegated || session.tenantId !== id ||
      session.tenantIds?.length !== 1 || session.tenantIds[0] !== id) {
    fail('ENTERPRISE_SESSION_REQUIRED','请从后台重新登录',401)
  }
}

export function assertEnterpriseRequest(id, { path, method, headers = {}, query, body }) {
  if (path === '/health') return
  if (!path.startsWith('/api/v1/')) fail('NOT_FOUND', '接口不存在',404)
  const p = path.slice('/api/v1/'.length).split('/').filter(Boolean)
  const denied = () => fail('NOT_FOUND','接口不存在',404)
  const scope = value => { if (value !== id) fail('ENTERPRISE_SCOPE_MISMATCH','站点范围不匹配',403) }
  if (['x-tenant-id','x-site-id','x-qicore-tenant-id','x-qicore-site-id'].some(h => headers[h] !== undefined)) {
    fail('ENTERPRISE_SCOPE_HEADER','站点范围由当前实例确定',400)
  }
  for (const values of [query, body]) {
    if (!values || Buffer.isBuffer(values) || typeof values !== 'object') continue
    if (Object.hasOwn(values, 'tenantId')) scope(values.tenantId)
    if (Object.hasOwn(values, 'siteId')) scope(values.siteId)
  }
  if (p[0] === 'admin') {
    if (headers['x-console-portal'] !== undefined && headers['x-console-portal'] !== 'tenant') return denied()
    // Login/logout may clear obsolete cookies. Delegation is never accepted as an identity.
    if (!(p[1] === 'auth' && ['login','logout'].includes(p[2])) &&
        /(?:^|;\s*)qicore_tenant_delegate=[^;\s]+/.test(headers.cookie || '')) fail('DELEGATION_UNAVAILABLE','当前实例不支持代登录',403)
    if (p[1] === 'auth' && p.length === 3 && ownAuth.get(p[2]) === method) {
      if (p[2] === 'login' && body?.portal !== undefined && body.portal !== 'tenant') return denied()
      return
    }
    if (maintenanceRoute(p.slice(1),method)) return
    if (wholeProductRoute(p,method)) return
    if (p[1] === 'tenant-entry' && p.length === 2 && method === 'GET') return
    if (p[1] !== 'tenants' || p.length < 4 || !businessAreas.has(p[3])) return denied()
    scope(p[2])
  }
  if (p[0] === 'public' && pathScoped.has(p[1])) scope(p[2])
  if (p[0] === 'payments' && p[1] === 'wechat-virtual') scope(p[2])
  if (p[0] === 'dev' || (p[0] === 'apps' && p[2] === 'dev') || p.includes('preview-login') ||
      (p[0] === 'consumer' && p[1] === 'auth' && p[2] === 'preview')) return denied()
}
