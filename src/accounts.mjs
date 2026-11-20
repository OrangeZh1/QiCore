import { z } from 'zod'
import { validateSelectedImage } from './material-images.mjs'
import { enterpriseDirectory, coreDirectoryLabels } from './enterprise-directory.mjs'
import { can, passwordHash, passwordMatches } from './identity.mjs'

const title = z.string().trim().min(1).max(100)
const roleId = z.string().regex(/^[a-z][a-z0-9_.-]{0,47}$/)
const password = z.string().min(12).max(128)
const accountInput = z.object({
  login: z.string().trim().regex(/^[\w.@-]{2,80}$/), displayName: title, password, roleId,
}).strict()
const select = { id: true, login: true, displayName: true, enabled: true, roleId: true }
const roleInput = z.object({ title, permissions: z.array(z.string()).max(200) }).strict()
const listing = z.object({
  page: z.coerce.number().int().min(1).max(1000000),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'enabled', 'disabled']).default('all'),
}).strict()

export const directoryPermissions = Object.keys(coreDirectoryLabels)

export function registerAccounts(api, db, identity, fail, permissions, clearSessionCookie, ownerId, application) {
  const directory = enterpriseDirectory(db, identity, fail, permissions, ownerId, application)
  directory.registerAdministrators(api)
  async function admin(req) {
    const account = await identity(req)
    if (account.roleId !== 'admin') throw fail(403, '仅系统管理员可管理账号与角色')
    return account
  }
  async function reader(req, permission) {
    if (!can(await identity(req), permission)) throw fail(403, '没有查看权限')
  }
  async function requireRole(id) {
    if (!await db.role.findFirst({ where: { id, enabled: true, deletedAt: null }, select: { id: true } })) throw fail(400, '所选角色不存在')
  }
  function roleData(id, input, existing = []) {
    if (id === 'admin' || id === 'member') throw fail(400, '内置角色由框架保留')
    const body = roleInput.parse(input)
    if (body.permissions.some(p => !permissions.has(p) && !existing.includes(p))) throw fail(400, '包含未知权限')
    return { ...body, permissions: [...new Set(body.permissions)] }
  }

  api.get('/admin/accounts', async (req, res) => {
    await reader(req, 'core.accounts.read')
    const orderBy = { login: 'asc' }
    if (!Object.keys(req.query).length) {
      return res.json(await db.account.findMany({ select, orderBy, where: { deletedAt: null } }))
    }
    const { page, pageSize, q, status } = listing.parse(req.query)
    const where = {
      deletedAt: null,
      ...(q ? { OR: [{ login: { contains: q } }, { displayName: { contains: q } }] } : {}),
      ...(status === 'all' ? {} : { enabled: status === 'enabled' }),
    }
    const [total, items] = await db.$transaction([
      db.account.count({ where }),
      db.account.findMany({ where, orderBy, select: { ...select, role: { select: { title: true } } },
        skip: (page - 1) * pageSize, take: pageSize }),
    ])
    res.json({ total, items })
  })
  api.get('/admin/roles', async (req, res) => {
    if (Object.keys(req.query).length) return directory.roles(req, res)
    await reader(req, 'core.roles.read')
    const roles = await db.role.findMany({ where: { deletedAt: null, enabled: true }, orderBy: { id: 'asc' }, include: { _count: { select: { accounts: { where: { deletedAt: null } } } } } })
    res.json({ roles, permissions: [...permissions] })
  })
  api.post('/admin/roles', async (req, res) => {
    if (req.body && typeof req.body === 'object' && 'name' in req.body) return directory.createRole(req, res)
    await admin(req)
    const { id, ...body } = roleInput.extend({ id: roleId }).parse(req.body)
    res.status(201).json(await db.role.create({ data: { id, ...roleData(id, body) } }))
  })
  api.delete('/admin/roles/:id', (req, res) => directory.updateRole(req, res, true))
  api.put('/admin/roles/:id', async (req, res) => {
    if (req.body && typeof req.body === 'object' && 'name' in req.body) return directory.updateRole(req, res)
    await admin(req)
    const id = roleId.parse(req.params.id)
    const saved = await db.$transaction(async tx => {
      const existing = await tx.role.findUnique({ where: { id }, select: { permissions: true, deletedAt: true } })
      if (existing?.deletedAt) throw fail(409, '角色已移除')
      const data = roleData(id, req.body, existing?.permissions ?? [])
      return tx.role.upsert({ where: { id }, create: { id, ...data }, update: { ...data, version: { increment: 1 } } })
    }, { isolationLevel: 'Serializable' })
    res.json(saved)
  })
  api.post('/admin/accounts', async (req, res) => {
    await admin(req)
    const { password: secret, ...data } = accountInput.parse(req.body)
    await requireRole(data.roleId)
    res.status(201).json(await db.account.create({ data: { ...data, passwordHash: await passwordHash(secret) }, select }))
  })
  api.patch('/admin/accounts/:id', async (req, res) => {
    const actor = await admin(req), id = z.uuid().parse(req.params.id).toLowerCase()
    const updates = z.object({ displayName: title.optional(), enabled: z.boolean().optional(), roleId: roleId.optional() }).strict().parse(req.body)
    if (id === ownerId?.toLowerCase() && actor.id.toLowerCase() !== id) throw fail(403, '不能更改实例负责人')
    if (id === actor.id.toLowerCase() && (updates.enabled === false || (updates.roleId && updates.roleId !== 'admin'))) {
      throw fail(400, '当前管理员不能停用自己或移除自己的管理员角色')
    }
    if (updates.roleId) await requireRole(updates.roleId)
    const result = await db.$transaction(async tx => {
      // Serialize decisions that could remove the last administrator.
      if (updates.enabled === false || (updates.roleId && updates.roleId !== 'admin')) {
        const admins = await tx.$queryRaw`SELECT id FROM qc_accounts WHERE roleId = 'admin' AND enabled = TRUE ORDER BY id FOR UPDATE`
        if (!admins.some(row => row.id === actor.id.toLowerCase())) throw fail(403, '当前账号的管理权限已变更')
      }
      const row = await tx.account.update({ where: { id, deletedAt: null }, data: { ...updates, version: { increment: 1 } }, select })
      if (updates.enabled === false || updates.roleId) await tx.session.deleteMany({ where: { accountId: id } })
      return row
    })
    res.json(result)
  })
  api.patch('/me', async (req, res) => {
    const actor = await identity(req)
    const data = z.object({
      displayName: title.optional(), avatar: z.string().max(120000).nullable().optional(),
    }).strict().refine(input => Object.keys(input).length > 0).parse(req.body)
    if (typeof data.avatar === 'string') {
      try { await validateSelectedImage(data.avatar) }
      catch { throw fail(400, '头像无效，请从素材库重新选择') }
    }
    res.json(await db.account.update({
      where: { id: actor.id, deletedAt: null }, data: { ...data, version: { increment: 1 } }, select: { ...select, avatar: true },
    }))
  })
  api.put('/me/password', async (req, res) => {
    const actor = await identity(req)
    const body = z.object({ currentPassword: z.string().min(1).max(128), password }).strict().parse(req.body)
    const row = await db.account.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true } })
    if (!await passwordMatches(body.currentPassword, row.passwordHash)) throw fail(400, '当前密码不正确')
    if (body.currentPassword === body.password) throw fail(400, '新密码不能与当前密码相同')
    const hash = await passwordHash(body.password)
    await db.$transaction(async tx => {
      const result = await tx.account.updateMany({ where: { id: actor.id, enabled: true, deletedAt: null, passwordHash: row.passwordHash }, data: { passwordHash: hash, version: { increment: 1 } } })
      if (result.count !== 1) throw fail(409, '账号已变更，请重新登录')
      await tx.session.deleteMany({ where: { accountId: actor.id } })
    })
    clearSessionCookie(res).status(204).end()
  })
  api.put('/admin/accounts/:id/password', async (req, res) => {
    const actor = await admin(req), id = z.uuid().parse(req.params.id).toLowerCase()
    if (id === ownerId?.toLowerCase() && actor.id.toLowerCase() !== id) throw fail(403, '不能重置实例负责人的密码')
    if (id === actor.id.toLowerCase()) throw fail(400, '请在个人资料中修改自己的密码')
    const body = z.object({ password }).strict().parse(req.body)
    await db.$transaction([
      db.account.update({ where: { id, deletedAt: null }, data: { passwordHash: await passwordHash(body.password), version: { increment: 1 } }, select }),
      db.session.deleteMany({ where: { accountId: id } }),
    ])
    res.status(204).end()
  })
}
