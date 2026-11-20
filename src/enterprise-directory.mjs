import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { can, passwordHash, passwordMatches } from './identity.mjs'

export const coreDirectoryLabels = {
  'core.accounts.read': '查看管理员',
  'core.accounts.write': '管理管理员',
  'core.roles.read': '查看角色',
  'core.roles.write': '管理角色',
}
const active = { deletedAt: null }
const version = z.number().int().positive()
const requestId = z.uuid()
const roleKey = z.string().min(1).max(48)
const name = z.string().trim().min(1).max(100)
const password = z.string().min(12).max(128)
const query = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'enabled', 'disabled']).default('all'),
}).strict()
const roleFields = z.object({
  name, enabled: z.boolean(), permissions: z.array(z.string().min(1).max(140)).max(200).transform(v => [...new Set(v)].sort()),
}).strict()
const memberFields = z.object({
  nickname: name, phone: z.string().trim().max(32).regex(/^[0-9+() -]*$/),
  roleId: roleKey, enabled: z.boolean(), allowMultipleSessions: z.boolean(),
}).strict()
const memberCreate = memberFields.extend({
  username: z.string().trim().regex(/^[\w.@-]{2,80}$/), password, requestId,
})
const memberEdit = memberFields.extend({ version, accountVersion: version })
const roleInclude = { _count: { select: { accounts: { where: active } } } }
const accountSelect = {
  id: true, login: true, displayName: true, avatar: true, phone: true, enabled: true, roleId: true,
  role: true, version: true, allowMultipleSessions: true, createdAt: true,
}

const featureCatalog = {
  'core.site.read': ['站点设置','查看站点设置'], 'core.site.write': ['站点设置','管理站点设置'],
  'core.storage.read': ['存储设置','查看存储设置'], 'core.storage.write': ['存储设置','管理存储设置'],
  'core.materials.read': ['素材管理','查看素材'], 'core.materials.write': ['素材管理','管理素材'],
  'core.content.read': ['帮助与内容','查看内容'], 'core.content.write': ['帮助与内容','管理内容'],
}

export function enterpriseDirectory(db, identity, fail, permissions, ownerId, application) {
  const protectedRole = id => id === 'admin' || id === 'member'
  const covers = (actor, values) => values.every(key => can(actor, key))
  function canAssign(actor, role) {
    return role.id === 'admin' ? actor.roleId === 'admin' : covers(actor, role.permissions)
  }
  function roleEditable(actor, role) {
    return can(actor, 'core.roles.write') && !protectedRole(role.id) && role.id !== actor.roleId && canAssign(actor, role)
  }
  function accountEditable(actor, row) {
    return can(actor, 'core.accounts.write') && row.id !== ownerId && row.id !== actor.id && canAssign(actor, row.role)
  }
  function roleView(actor, row) {
    return { id: row.id, name: row.title, permissions: row.id === 'admin' ? [...permissions] : row.permissions, enabled: row.enabled,
      version: row.version, userCount: row._count.accounts, editable: roleEditable(actor, row), createdAt: row.createdAt }
  }
  function memberView(actor, row) {
    const editable = accountEditable(actor, row)
    return {
      id: row.id, username: row.login, nickname: row.displayName, avatar: row.avatar, phone: row.phone,
      roleId: row.roleId, role: { name: row.role.title, enabled: row.role.enabled },
      enabled: row.enabled, accountEnabled: row.enabled, allowMultipleSessions: row.allowMultipleSessions,
      version: row.version, accountVersion: row.version, createdAt: row.createdAt,
      editable, accountEditable: editable, owner: row.id === ownerId,
    }
  }
  function catalog(actor) {
    return [...permissions].map(key => ({
      key, group: Object.hasOwn(coreDirectoryLabels, key) ? '权限管理' : (featureCatalog[key]?.[0] || application?.title || '应用权限'),
      label: coreDirectoryLabels[key] || featureCatalog[key]?.[1] || application?.permissionLabels?.[key] || key,
      grantable: can(actor, key),
    }))
  }
  async function reader(req, key) {
    const actor = await identity(req)
    if (!can(actor, key)) throw fail(403, '没有所需权限')
    return actor
  }
  async function write(req, permission, run, isCreation = false) {
    const execute = () => db.$transaction(async tx => {
      // Session, actor, grant ceiling and target are checked within the same serialized mutation.
      const actor = await identity(req, tx)
      if (!can(actor, permission)) throw fail(403, '当前账号没有所需管理权限')
      return run(tx, actor)
    }, { isolationLevel: 'Serializable' })
    try {
      return await execute()
    } catch (error) {
      // A deadlock can arise from separate predicates (for example role-name uniqueness).
      if (isCreation && error.code === 'P2034') return execute()
      throw error
    }
  }
  async function provision(tx, actor, kind, input, create, lookup) {
    const key = { actorId: actor.id, requestId: input.requestId }
    const payload = createHash('sha256').update(JSON.stringify([kind, input])).digest('hex')
    // Do not read a missing key then contend for a range lock. Claim the exact
    // ledger key first so concurrent replays wait for the creating transaction.
    const subjectId = (kind === 'role' ? 'r-' : '') + randomUUID()
    const fingerprint = await passwordHash(payload)
    await tx.$executeRaw`INSERT INTO qc_directory_requests (actorId,requestId,fingerprint,subjectId)
      VALUES (${actor.id},${input.requestId},${fingerprint},${subjectId})
      ON DUPLICATE KEY UPDATE requestId = qc_directory_requests.requestId`
    const receipt = await tx.directoryRequest.findUniqueOrThrow({ where: { actorId_requestId: key } })
    if (receipt.subjectId === subjectId) return create(subjectId)
    if (!await passwordMatches(payload, receipt.fingerprint)) throw fail(409, '此请求已用于其他内容，请重新打开表单')
    const row = await lookup(receipt.subjectId)
    if (!row) throw fail(409, '原请求已完成，记录已移除')
    return row
  }
  async function roleFor(tx, actor, id) {
    const row = await tx.role.findFirst({ where: { id, ...active } })
    if (!row || !row.enabled) throw fail(400, '所选角色不可用')
    if (!canAssign(actor, row)) throw fail(403, '不能分配权限超出自身范围的角色')
    return row
  }
  function validateGrants(actor, values, previously = []) {
    for (const key of values) {
      if (!permissions.has(key) && !previously.includes(key)) throw fail(400, '包含未知权限')
      if (!can(actor, key)) throw fail(403, '不能授予超出自身范围的权限')
      const read = key.replace(/\.(write|manage)$/, '.read')
      if (read !== key && permissions.has(read) && !values.includes(read)) throw fail(400, '管理权限必须同时勾选对应查看权限')
    }
  }
  async function uniqueName(tx, title, except) {
    if (await tx.role.findFirst({ where: { ...active, title, ...(except ? { id: { not: except } } : {}) }, select: { id: true } })) {
      throw fail(409, '角色名称已存在')
    }
  }
  function checkVersion(row, expected) {
    if (expected !== row.version) throw fail(409, '记录已变更，请刷新后重试')
  }
  function pageArgs(page, size) { return { skip: (page - 1) * size, take: size } }
  function statusFilter(status) { return status === 'all' ? {} : { enabled: status === 'enabled' } }

  async function roles(req, res) {
    const actor = await reader(req, 'core.roles.read')
    const { q, status, page, pageSize } = query.parse(req.query)
    const where = { ...active, ...statusFilter(status), ...(q ? { title: { contains: q } } : {}) }
    const [rows, total] = await db.$transaction([
      db.role.findMany({ where, include: roleInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageArgs(page, pageSize) }),
      db.role.count({ where }),
    ])
    res.json({ items: rows.map(row => roleView(actor, row)), total, page, pageSize, catalog: catalog(actor), canWrite: can(actor, 'core.roles.write') })
  }
  async function createRole(req, res) {
    const input = roleFields.extend({ requestId }).parse(req.body)
    const result = await write(req, 'core.roles.write', async (tx, actor) => {
      validateGrants(actor, input.permissions)
      const row = await provision(tx, actor, 'role', input, async id => {
        await uniqueName(tx, input.name)
        return tx.role.create({ data: { id, title: input.name, enabled: input.enabled, permissions: input.permissions }, include: roleInclude })
      }, id => tx.role.findFirst({ where: { id, ...active }, include: roleInclude }))
      if (!canAssign(actor, row)) throw fail(403, '角色权限已变更')
      return roleView(actor, row)
    }, true)
    res.status(201).json(result)
  }
  async function updateRole(req, res, remove = false) {
    const id = roleKey.parse(req.params.id)
    const input = remove ? z.object({ version }).strict().parse(req.body) : roleFields.extend({ version }).parse(req.body)
    await write(req, 'core.roles.write', async (tx, actor) => {
      const row = await tx.role.findFirst({ where: { id, ...active }, include: roleInclude })
      if (!row) throw fail(404, '角色不存在')
      if (!roleEditable(actor, row)) throw fail(403, '不能修改内置角色、本人角色或超出自身范围的角色')
      if (ownerId && await tx.account.count({ where: { id: ownerId, roleId: row.id } })) throw fail(403, '不能更改实例负责人的角色')
      checkVersion(row, input.version)
      if (remove) {
        if (row._count.accounts) throw fail(409, '角色仍有关联账号，请先调整账号角色')
        await tx.role.update({ where: { id }, data: { enabled: false, deletedAt: new Date(), version: { increment: 1 } } })
      } else {
        validateGrants(actor, input.permissions, row.permissions)
        await uniqueName(tx, input.name, id)
        await tx.role.update({ where: { id }, data: { title: input.name, permissions: input.permissions, enabled: input.enabled, version: { increment: 1 } } })
        if (row.enabled !== input.enabled || JSON.stringify([...row.permissions].sort()) !== JSON.stringify(input.permissions)) {
          await tx.session.deleteMany({ where: { account: { roleId: id } } })
        }
      }
    })
    res.json({ updated: true })
  }
  function registerAdministrators(api) {
    const path = '/admin/administrators'
    api.get(path + '/roles', async (req, res) => {
      const actor = await reader(req, 'core.accounts.write')
      const { q, page, pageSize } = query.parse(req.query)
      const where = { ...active, enabled: true, ...(q ? { title: { contains: q } } : {}) }
      const [rows, total] = await db.$transaction([
        db.role.findMany({ where, orderBy: { title: 'asc' }, ...pageArgs(page, pageSize) }), db.role.count({ where }),
      ])
      res.json({ items: rows.map(role => ({ id: role.id, name: role.title, assignable: canAssign(actor, role) })), total })
    })
    api.get(path, async (req, res) => {
      const actor = await reader(req, 'core.accounts.read')
      const { q, status, page, pageSize } = query.parse(req.query)
      const where = { ...active, ...statusFilter(status), ...(q ? { OR: ['login', 'displayName', 'phone'].map(key => ({ [key]: { contains: q } })) } : {}) }
      const [rows, total] = await db.$transaction([
        db.account.findMany({ where, select: accountSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageArgs(page, pageSize) }),
        db.account.count({ where }),
      ])
      res.json({ items: rows.map(row => memberView(actor, row)), total, page, pageSize, canWrite: can(actor, 'core.accounts.write') })
    })
    api.post(path, async (req, res) => {
      const input = memberCreate.parse(req.body)
      const result = await write(req, 'core.accounts.write', async (tx, actor) => {
        await roleFor(tx, actor, input.roleId)
        const row = await provision(tx, actor, 'account', input, async id => {
          return tx.account.create({ data: {
            id, login: input.username, displayName: input.nickname, phone: input.phone, enabled: input.enabled,
            roleId: input.roleId, allowMultipleSessions: input.allowMultipleSessions, passwordHash: await passwordHash(input.password),
          }, select: accountSelect })
        }, id => tx.account.findFirst({ where: { id, ...active }, select: accountSelect }))
        if (!accountEditable(actor, row)) throw fail(403, '账号权限已变更')
        return memberView(actor, row)
      }, true)
      res.status(201).json(result)
    })
    async function changeMember(req, res, mode) {
      const id = z.uuid().parse(req.params.id)
      const input = mode === 'edit' ? memberEdit.parse(req.body) : mode === 'password'
        ? z.object({ version, accountVersion: version, password }).strict().parse(req.body) : z.object({ version }).strict().parse(req.body)
      await write(req, 'core.accounts.write', async (tx, actor) => {
        const row = await tx.account.findFirst({ where: { id, ...active }, select: accountSelect })
        if (!row) throw fail(404, '账号不存在')
        if (!accountEditable(actor, row)) throw fail(403, '不能更改本人、实例负责人或权限超出自身范围的账号')
        checkVersion(row, input.version)
        if (mode !== 'remove') checkVersion(row, input.accountVersion)
        let data
        if (mode === 'remove') data = { enabled: false, deletedAt: new Date() }
        else if (mode === 'password') data = { passwordHash: await passwordHash(input.password) }
        else {
          await roleFor(tx, actor, input.roleId)
          data = { displayName: input.nickname, phone: input.phone, roleId: input.roleId, enabled: input.enabled, allowMultipleSessions: input.allowMultipleSessions }
        }
        await tx.account.update({ where: { id }, data: { ...data, version: { increment: 1 } } })
        await tx.session.deleteMany({ where: { accountId: id } })
      })
      res.json({ updated: true })
    }
    api.put(path + '/:id', (req, res) => changeMember(req, res, 'edit'))
    api.put(path + '/:id/password', (req, res) => changeMember(req, res, 'password'))
    api.delete(path + '/:id', (req, res) => changeMember(req, res, 'remove'))
  }
  return { roles, createRole, updateRole, registerAdministrators }
}
