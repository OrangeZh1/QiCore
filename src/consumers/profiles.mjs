import { z } from 'zod'
import { passwordHash } from '../identity.mjs'
import { validateSelectedImage } from '../material-images.mjs'
import { readConsumerSettings } from '../consumer-settings.mjs'
import { initializeMember, memberOptions, memberSummary, readBaseLevel } from './membership.mjs'
import { walletSummary } from './wallet.mjs'
import { audit, conflict, id, paging, pageRange, reject, transaction, userIdInput, version } from './shared.mjs'

export const consumerScope = application => application?.key || '@framework'
const optionalText = max => z.string().trim().max(max)
const profileFields = {
  nickname: z.string().trim().min(1).max(64),
  avatar: z.string().max(106700).nullable().default(null), phone: optionalText(32).refine(v => !v || /^\+?[\d][\d ()-]{5,30}$/.test(v)),
  email: z.union([z.literal(''),z.email().max(254)]), gender: z.enum(['unknown','male','female']),
  enabled: z.boolean(), password: z.string().min(12).max(128).optional(),
}
const createInput = z.object({ userId: userIdInput, ...profileFields }).strict()
const editInput = z.object({ version, ...profileFields }).strict()
const listing = z.object({ ...paging, q: optionalText(100).default(''), levelId: z.union([id,z.literal('none')]).optional(), tagId: id.optional() }).strict()

/** Called within the registration or administrator creation transaction. */
export async function createConsumerInTransaction(tx, scope, input, settings) {
  const { userId, nickname, avatar = null, phone = '', email = '', gender = 'unknown', enabled = true, passwordHash: secret = null } = input
  const numbering = settings || (await readConsumerSettings(tx, scope)).users
  const counter = await tx.coreConsumerCounter.upsert({ where: { scope }, create: { scope, nextNumber: numbering.start + 1 }, update: { nextNumber: { increment: 1 } } })
  const serial = String(counter.nextNumber - 1)
  if (serial.length > numbering.digits) reject(409, '会员编号位数已用完，请调整编号设置')
  const memberNumber = numbering.prefix + serial.padStart(numbering.digits, '0')
  await tx.coreConsumer.create({ data: { scope, userId, memberNumber, nickname, avatar, phone, email, gender, enabled, passwordHash: secret } })
  await initializeMember(tx, scope, userId)
  return tx.coreConsumer.findUniqueOrThrow({ where: { scope_userId: { scope, userId } } })
}
async function editable(data) {
  const { password, ...fields } = data
  if (fields.avatar) await validateSelectedImage(fields.avatar)
  if (password) fields.passwordHash = await passwordHash(password)
  return fields
}

export async function createConsumer(db, scope, actor, input) {
  const fields = await editable(createInput.parse(input))
  return transaction(db, async tx => {
    const row = await createConsumerInTransaction(tx, scope, fields)
    await audit(tx, actor, 'consumer.create', scope, { userId: row.userId })
    return { userId: row.userId, version: row.version }
  })
}
export async function updateConsumer(db, scope, userId, actor, input) {
  const { version: expected, ...fields } = await editable(editInput.parse(input))
  return transaction(db, async tx => {
    const old = await tx.coreConsumer.findUnique({ where: { scope_userId: { scope, userId } } })
    if (!old || old.deletedAt) reject(404, '用户不存在')
    const revoke = fields.passwordHash || fields.enabled !== old.enabled
    const done = await tx.coreConsumer.updateMany({ where: { scope, userId, version: expected, deletedAt: null }, data: {
      ...fields, version: { increment: 1 }, ...(revoke ? { authVersion: { increment: 1 } } : {}),
    } })
    if (!done.count) conflict()
    await audit(tx, actor, 'consumer.update', scope, { userId, version: expected + 1 })
    return { saved: true, version: expected + 1 }
  })
}
export async function deleteConsumers(db, scope, actor, input) {
  const q = z.object({ users: z.array(z.object({ userId: userIdInput, version, memberNumber: z.string().nullable().optional() }).strict()).min(1).max(100).refine(rows => new Set(rows.map(r => r.userId)).size === rows.length), confirm: z.literal('删除用户') }).strict().parse(input)
  return transaction(db, async tx => {
    for (const row of q.users) {
      const removed = await tx.coreConsumer.updateMany({ where: { scope, userId: row.userId, version: row.version, deletedAt: null }, data: {
        enabled: false, deletedAt: new Date(), version: { increment: 1 }, authVersion: { increment: 1 },
      } })
      if (!removed.count) conflict()
    }
    await audit(tx, actor, 'consumer.delete', scope, { users: q.users.map(row => row.userId) })
    return { deleted: q.users.length }
  })
}
function profileView(row, member, wallet, defaultAvatar) {
  return { userId: row.userId, memberNumber: row.memberNumber, version: row.version, phone: row.phone, email: row.email, gender: row.gender,
    enabled: row.enabled, hasPassword: !!row.passwordHash, user: { id: row.userId, nickname: row.nickname, avatar: row.avatar, defaultAvatar },
    firstSeenAt: row.firstSeenAt, lastActivityAt: row.lastActivityAt, member, metrics: [],
    ...(wallet ? { wallet: { points: wallet.points, balanceCents: wallet.balance } } : {}) }
}
export async function consumerList(db, scope, input, readWallet) {
  const q = listing.parse(input)
  const where = { scope, deletedAt: null, ...(q.levelId ? { memberLevelId: q.levelId === 'none' ? null : q.levelId } : {}),
    ...(q.tagId ? { memberTags: { some: { tagId: q.tagId } } } : {}),
    ...(q.q ? { OR: ['userId','nickname','memberNumber','phone','email'].map(name => ({ [name]: { contains: q.q } })) } : {}) }
  const total = await db.coreConsumer.count({ where }), range = pageRange(q, total)
  const rows = await db.coreConsumer.findMany({ where, orderBy: [{ lastActivityAt: 'desc' },{ userId: 'asc' }], skip: range.skip, take: range.take,
    include: { memberLevel: true, memberTags: { include: { tag: { select: { id: true, name: true } } } } } })
  const balances = readWallet && rows.length ? await db.coreConsumerWallet.findMany({ where: { scope, userId: { in: rows.map(r => r.userId) } } }) : []
  const byUser = new Map()
  for (const row of balances) {
    if (!byUser.has(row.userId)) byUser.set(row.userId, { points: 0, balance: 0 })
    byUser.get(row.userId)[row.asset] = Number(row.amount)
  }
  const opts = await memberOptions(db, scope), settings = await readConsumerSettings(db, scope)
  return { items: rows.map(row => profileView(row, { growth: row.growth, level: row.memberLevel || opts.defaultLevel,
    tags: row.memberTags.map(x => x.tag) }, readWallet ? byUser.get(row.userId) || { points: 0, balance: 0 } : null, settings.users.defaultAvatar)), memberOptions: opts, total, page: range.page, pageSize: range.take }
}
export async function consumerDetail(db, scope, userId, readWallet) {
  const row = await db.coreConsumer.findFirst({ where: { scope, userId, deletedAt: null } })
  if (!row) reject(404, '用户不存在')
  const balances = readWallet ? await walletSummary(db, scope, userId) : null
  const settings = await readConsumerSettings(db, scope)
  return { ...profileView(row, await memberSummary(db, scope, userId), balances ? { points: balances.points.amount, balance: balances.balance.amount } : null, settings.users.defaultAvatar),
    fields: [{ label: '会员编号', value: row.memberNumber }], metrics: [] }
}
