import { z } from 'zod'
import { activeConsumer, audit, conflict, description, hash, id, pageRange, paging, reject, transaction, version } from './shared.mjs'
import { defaultMemberLevel, memberBenefitDefinitions, memberBenefits, memberBenefitsSchema, upgradedLevel } from './levels.mjs'

const name = z.string().trim().min(1).max(32).regex(/^[^\u0000-\u001f\u007f]+$/)
const amount = z.number().int().min(0).max(2147483647)
const criteria = z.object({ growth: amount.optional(), paidCents: z.string().regex(/^[1-9]\d{0,14}$/).optional(), paidOrders: amount.positive().optional() }).strict()
const baseInput = { version, name, description }
const levelInput = z.object({ ...baseInput, rank: z.number().int().min(-1).max(2147483647), upgradeMode: z.enum(['all','any']), conditions: criteria, benefits: memberBenefitsSchema }).strict()
const tagInput = z.object(baseInput).strict()
const ruleInput = z.object({ version, registrationGrowth: amount, purchaseGrowthPerYuan: amount }).strict()
const queryInput = z.object({ ...paging, q: z.string().trim().max(100).default('') }).strict()
const reason = z.string().trim().min(1).max(200)
const changeInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('growth'), version, requestId: id, reason, delta: z.number().int().min(-2147483647).max(2147483647).refine(n => n !== 0) }).strict(),
  z.object({ kind: z.literal('level'), version, requestId: id, reason, levelId: id.nullable() }).strict(),
  z.object({ kind: z.literal('recalculate'), version, requestId: id, reason }).strict(),
  z.object({ kind: z.literal('tags'), version, requestId: id, reason, tagIds: z.array(id).max(20).refine(v => new Set(v).size === v.length) }).strict(),
])

export async function readBaseLevel(db, scope) {
  const rule = await db.coreMemberRule.findUnique({ where: { scope } })
  return defaultMemberLevel(rule?.baseLevel)
}
function levelView(row, fallback) {
  return row ? { id: row.id, name: row.name, threshold: row.conditions?.growth || 0, rank: row.rank, conditions: row.conditions, upgradeMode: row.upgradeMode, benefits: row.benefits } : fallback
}
export async function memberOptions(db, scope) {
  const [levels, tags, defaultLevel] = await Promise.all([
    db.coreMemberLevel.findMany({ where: { scope }, orderBy: { rank: 'asc' } }),
    db.coreMemberTag.findMany({ where: { scope }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    readBaseLevel(db, scope),
  ])
  return { levels: levels.map(row => levelView(row)), tags, defaultLevel }
}
export async function memberSummary(db, scope, userId) {
  const profile = await db.coreConsumer.findUnique({ where: { scope_userId: { scope, userId } },
    include: { memberLevel: true, memberTags: { include: { tag: true } } } })
  if (!profile || profile.deletedAt) reject(404, '用户不存在')
  return { growth: profile.growth, level: levelView(profile.memberLevel, await readBaseLevel(db, scope)), tags: profile.memberTags.map(row => ({ id: row.tagId, name: row.tag.name })) }
}
export async function initializeMember(tx, scope, userId) {
  const rule = await tx.coreMemberRule.findUnique({ where: { scope } })
  const growth = rule?.registrationGrowth || 0
  const level = upgradedLevel(await tx.coreMemberLevel.findMany({ where: { scope } }), growth)
  if (!growth && !level) return
  await tx.coreConsumer.update({ where: { scope_userId: { scope, userId } }, data: { growth, memberLevelId: level?.id || null } })
  await tx.coreMemberGrowthEntry.create({ data: { scope, userId, requestId: 'registration', kind: 'registration',
    before: 0, after: growth, levelBefore: {}, levelAfter: levelView(level, defaultMemberLevel(rule?.baseLevel)),
    payloadHash: hash({ growth, level: level?.id || null }), actor: 'system', reason: '新用户注册' } })
}
export async function memberView(db, scope, userId, query = {}) {
  const q = z.object(paging).strict().parse(query)
  const row = await db.coreConsumer.findFirst({ where: { scope, userId, deletedAt: null }, select: { nickname: true, avatar: true, version: true } })
  if (!row) reject(404, '用户不存在')
  const profile = await memberSummary(db, scope, userId)
  const options = await memberOptions(db, scope)
  const total = await db.coreMemberGrowthEntry.count({ where: { scope, userId } }), range = pageRange(q, total)
  const records = await db.coreMemberGrowthEntry.findMany({ where: { scope, userId }, orderBy: [{ createdAt: 'desc' }, { requestId: 'asc' }], skip: range.skip, take: range.take,
    select: { requestId: true, kind: true, before: true, after: true, levelBefore: true, levelAfter: true, reason: true, createdAt: true } })
  return { ...profile, userId, user: { nickname: row.nickname, avatar: row.avatar }, version: row.version, levels: options.levels, tagOptions: options.tags, defaultLevel: options.defaultLevel, records, total, page: range.page, pageSize: range.take }
}
export async function changeMember(db, scope, userId, actor, input) {
  const q = changeInput.parse(input), payloadHash = hash(q)
  return transaction(db, async tx => {
    const prior = await tx.coreMemberGrowthEntry.findUnique({ where: { scope_userId_requestId: { scope, userId, requestId: q.requestId } } })
    if (prior) { if (prior.payloadHash !== payloadHash) conflict(); return { saved: true, replayed: true } }
    const consumer = await activeConsumer(tx, scope, userId)
    if (consumer.version !== q.version) conflict()
    const levels = await tx.coreMemberLevel.findMany({ where: { scope } })
    const current = levels.find(row => row.id === consumer.memberLevelId)
    let next = current
    const growth = q.kind === 'growth' ? consumer.growth + q.delta : consumer.growth
    if (growth < 0 || growth > 2147483647) reject(400, '成长值超出范围')
    if (q.kind === 'level') {
      next = levels.find(row => row.id === q.levelId)
      if (q.levelId && !next) reject(400, '所选等级不存在')
    }
    if (q.kind === 'growth' || q.kind === 'recalculate') next = upgradedLevel(levels, growth, current, consumer)
    if (q.kind === 'tags') {
      if (await tx.coreMemberTag.count({ where: { scope, id: { in: q.tagIds } } }) !== q.tagIds.length) reject(400, '所选标签不存在')
      await tx.coreConsumerTag.deleteMany({ where: { scope, userId } })
      if (q.tagIds.length) await tx.coreConsumerTag.createMany({ data: q.tagIds.map(tagId => ({ scope, userId, tagId })) })
    }
    const updated = await tx.coreConsumer.updateMany({ where: { scope, userId, version: q.version }, data: { growth, memberLevelId: next?.id || null, version: { increment: 1 } } })
    if (updated.count !== 1) conflict()
    const fallback = await readBaseLevel(tx, scope)
    await tx.coreMemberGrowthEntry.create({ data: { scope, userId, requestId: q.requestId, kind: q.kind, before: consumer.growth, after: growth,
      levelBefore: levelView(current, fallback), levelAfter: levelView(next, fallback), reason: q.reason, actor, payloadHash } })
    await audit(tx, actor, 'member.' + q.kind, scope, { userId, requestId: q.requestId, growth })
    return { saved: true }
  })
}

export async function catalog(db, scope, kind, input) {
  const q = queryInput.parse(input), levels = kind === 'levels'
  const model = levels ? db.coreMemberLevel : db.coreMemberTag
  const base = await readBaseLevel(db, scope)
  const includeBase = levels && !base.deleted && base.name.toLowerCase().includes(q.q.toLowerCase())
  const where = { scope, ...(q.q ? { name: { contains: q.q } } : {}) }
  const total = await model.count({ where }) + Number(includeBase), range = pageRange(q, total)
  const rows = await model.findMany({ where, orderBy: levels ? { rank: 'asc' } : [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: Math.max(0, range.skip - Number(includeBase)), take: range.take - Number(range.page === 1 && includeBase), include: { _count: { select: { members: true } } } })
  const items = rows.map(({ _count, ...row }) => ({ ...row, memberCount: _count.members }))
  if (includeBase && range.page === 1) items.unshift({ ...base, id: 'default', memberCount: await db.coreConsumer.count({ where: { scope, memberLevelId: null } }) })
  const rule = levels ? await db.coreMemberRule.findUnique({ where: { scope } }) : null
  return { items, total, page: range.page, pageSize: range.take, benefitDefinitions: levels ? memberBenefitDefinitions : [],
    rule: { registrationGrowth: rule?.registrationGrowth || 0, purchaseGrowthPerYuan: rule?.purchaseGrowthPerYuan || 0, version: rule?.version || 0 } }
}
export async function saveCatalog(db, scope, kind, target, actor, input) {
  const levels = kind === 'levels', { version: expected, ...data } = (levels ? levelInput : tagInput).parse(input)
  if (target !== 'default') id.parse(target)
  return transaction(db, async tx => {
    let changed
    if (levels && target === 'default') {
      const old = await readBaseLevel(tx, scope)
      if (old.deleted || old.version !== expected) conflict()
      if (data.rank !== -1 || Object.keys(data.conditions).length) reject(400, '普通会员不能设置升级条件')
      if (await tx.coreMemberLevel.count({ where: { scope, name: data.name } })) reject(409, '等级名称已存在')
      const baseLevel = { name: data.name, description: data.description, benefits: data.benefits, version: expected + 1, updatedAt: new Date().toISOString() }
      await tx.coreMemberRule.upsert({ where: { scope }, create: { scope, baseLevel }, update: { baseLevel } })
    } else {
      if (target === 'default') reject(400, '标签标识无效')
      const model = levels ? tx.coreMemberLevel : tx.coreMemberTag
      if (levels && (data.rank < 0 || data.name === (await readBaseLevel(tx, scope)).name)) reject(400, '等级序号或名称与普通会员冲突')
      if (!expected) {
        if (await model.count({ where: { scope } }) >= (levels ? 50 : 200)) reject(409, levels ? '最多支持 50 个等级' : '最多支持 200 个标签')
        await model.create({ data: { ...data, scope, id: target } })
      } else {
        changed = await model.updateMany({ where: { scope, id: target, version: expected }, data: { ...data, version: { increment: 1 } } })
        if (!changed.count) conflict()
      }
    }
    await audit(tx, actor, 'member.' + kind + '.save', scope, { id: target, version: expected + 1 })
    return { saved: true }
  })
}
export async function removeCatalog(db, scope, kind, actor, input) {
  const { items } = z.object({ items: z.array(z.object({ id: z.union([id, z.literal('default')]), version }).strict()).min(1).max(100) }).strict().parse(input)
  return transaction(db, async tx => {
    for (const row of items) {
      if (kind === 'levels' && row.id === 'default') {
        const old = await readBaseLevel(tx, scope)
        if (old.version !== row.version || old.deleted) conflict()
        if (await tx.coreConsumer.count({ where: { scope, memberLevelId: null } })) reject(409, '该等级仍有关联用户')
        const baseLevel = { ...old, deleted: true, version: old.version + 1, updatedAt: new Date().toISOString() }
        await tx.coreMemberRule.upsert({ where: { scope }, create: { scope, baseLevel }, update: { baseLevel } })
      } else {
        const referenced = kind === 'levels' ? await tx.coreConsumer.count({ where: { scope, memberLevelId: row.id } }) : await tx.coreConsumerTag.count({ where: { scope, tagId: row.id } })
        if (referenced) reject(409, '仍有用户关联，请先调整用户后删除')
        const model = kind === 'levels' ? tx.coreMemberLevel : tx.coreMemberTag
        const removed = await model.deleteMany({ where: { scope, id: row.id, version: row.version } })
        if (!removed.count) conflict()
      }
    }
    await audit(tx, actor, 'member.' + kind + '.delete', scope, { ids: items.map(row => row.id) })
    return { deleted: items.length }
  })
}
export async function saveMemberRules(db, scope, actor, input) {
  const { version: expected, ...values } = ruleInput.parse(input)
  return transaction(db, async tx => {
    const rule = await tx.coreMemberRule.findUnique({ where: { scope } })
    if ((rule?.version || 0) !== expected) conflict()
    await tx.coreMemberRule.upsert({ where: { scope }, create: { scope, ...values, version: 1 }, update: { ...values, version: { increment: 1 } } })
    await audit(tx, actor, 'member.rules.save', scope, values)
    return { saved: true }
  })
}
