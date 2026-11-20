import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { passwordHash, passwordMatches, digest } from './identity.mjs'
import { readConsumerSettings, registerConsumerSettings } from './consumer-settings.mjs'
import { consumerScope, createConsumerInTransaction } from './consumers/profiles.mjs'
import { memberSummary } from './consumers/membership.mjs'
import { walletSummary } from './consumers/wallet.mjs'
import { validateSelectedImage } from './material-images.mjs'

const credentials = z.object({
  account: z.string().trim().min(1).max(64), password: z.string().min(1).max(128),
  consent: z.object({ terms: z.number().int().positive().optional(), privacy: z.number().int().positive().optional() }).strict().optional(),
}).strict()
const createAccount = credentials.extend({ account: z.string().trim().regex(/^[A-Za-z0-9]{3,64}$/), password: z.string().min(12).max(128) })
const profileUpdate = z.object({
  nickname: z.string().trim().min(1).max(64), gender: z.enum(['unknown', 'male', 'female']),
  avatar: z.string().max(106700).nullable().optional(), version: z.number().int().positive(),
}).strict()
const passwordChange = z.object({ oldPassword: z.string().min(1).max(128), password: z.string().min(12).max(128) }).strict()
const dummy = 'scrypt$' + '00'.repeat(16) + '$' + '00'.repeat(64)
const lifetime = 8 * 3600000

async function latestPolicies(db, scope) {
  const results = await Promise.all(['terms', 'privacy'].map(kind => db.corePolicyRevision.findFirst({
    where: { scope, kind }, orderBy: { version: 'desc' }, select: { kind: true, title: true, version: true },
  })))
  return results.filter(Boolean)
}
function publicProfile(row, defaultAvatar) {
  return {
    account: row.userId, nickname: row.nickname, avatar: row.avatar, defaultAvatar, memberNumber: row.memberNumber,
    phone: row.phone, email: row.email, gender: row.gender, version: row.version, hasPassword: !!row.passwordHash,
  }
}

export function registerConsumerAuth(api, { db, identity, fail, secure, adminCookie = 'qc_session', application }) {
  const scope = consumerScope(application)
  const cookieName = 'qcu_' + digest(adminCookie + '/' + scope).slice(0, 24)
  const cookie = { httpOnly: true, secure, sameSite: 'lax', path: '/' }
  registerConsumerSettings(api, { db, identity, fail, scope })
  function tokenDigest(req) {
    const prefix = cookieName + '='
    const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(prefix))?.slice(prefix.length)
    return value && /^[a-f0-9]{64}$/.test(value) ? digest(value) : null
  }
  async function limiter(kind, key, max, interval) {
    const now = Date.now()
    const bucket = Math.floor(now / interval)
    const id = digest(JSON.stringify([scope, kind, key, bucket]))
    const expiresAt = new Date((bucket + 1) * interval)
    await db.coreConsumerAuthLimit.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
    await db.$executeRaw`INSERT INTO qc_consumer_auth_limits (\`key\`,count,expiresAt) VALUES (${id},1,${expiresAt})
      ON DUPLICATE KEY UPDATE count=LEAST(count+1,1000000)`
    const row = await db.coreConsumerAuthLimit.findUnique({ where: { key: id }, select: { count: true } })
    if (row && row.count > max) throw fail(429, '尝试过于频繁，请稍后再试')
  }
  async function current(db, req) {
    const key = tokenDigest(req)
    const session = key && await db.coreConsumerLoginSession.findFirst({ where: { digest: key, scope, expiresAt: { gt: new Date() } } })
    const account = session && await db.coreConsumer.findUnique({ where: { scope_userId: { scope, userId: session.userId } } })
    if (!account?.enabled || account.deletedAt || account.authVersion !== session.authVersion) throw fail(401, '请先登录')
    return account
  }
  const transaction = fn => db.$transaction(fn, { isolationLevel: 'Serializable' })
  const authPath = '/consumer/auth'
  api.get(authPath + '/settings', async (_req, res) => {
    const { registration } = await readConsumerSettings(db, scope)
    res.json({ registration, policies: await latestPolicies(db, scope) })
  })
  async function authenticate(req, res, register) {
    const parsed = (register ? createAccount : credentials).safeParse(req.body)
    if (!parsed.success) throw fail(400, register ? '账号须为 3–64 位英文字母或数字，密码须为 12–128 个字符' : '请检查账号和密码')
    const input = parsed.data, ip = req.socket.remoteAddress || 'local'
    await limiter(register ? 'register' : 'login-ip', ip, register ? 10 : 160, register ? 3600000 : 60000)
    if (!register) await limiter('login-account', input.account.toLowerCase(), 30, 60000)
    let expectedHash, freshHash
    if (register) freshHash = await passwordHash(input.password)
    else {
      const candidate = await db.coreConsumer.findUnique({ where: { scope_userId: { scope, userId: input.account } }, select: { passwordHash: true } })
      expectedHash = candidate?.passwordHash
      if (!await passwordMatches(input.password, expectedHash || dummy) || !expectedHash) throw fail(401, '账号或密码不正确，或用户不可用')
    }
    const token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + lifetime)
    await transaction(async tx => {
      const settings = await readConsumerSettings(tx, scope)
      if (!settings.registration.passwordLoginEnabled) throw fail(403, '当前实例已关闭账号密码登录')
      if (register && !settings.registration.autoRegister) throw fail(403, '当前实例暂不开放新用户注册')
      const policies = await latestPolicies(tx, scope)
      if (policies.some(p => input.consent?.[p.kind] !== p.version)) throw fail(409, '请阅读并同意最新的协议')
      const where = { scope_userId: { scope, userId: input.account } }
      let row = await tx.coreConsumer.findUnique({ where })
      if (register) {
        if (row) throw fail(409, '该账号不可注册，请更换账号')
        await createConsumerInTransaction(tx, scope, { userId: input.account, nickname: input.account, passwordHash: freshHash }, settings.users)
        row = await tx.coreConsumer.findUniqueOrThrow({ where })
      } else if (!row?.enabled || row.deletedAt || row.passwordHash !== expectedHash) throw fail(401, '账号或密码不正确，或用户不可用')
      if (policies.length) await tx.coreConsumerPolicyAcceptance.createMany({
        data: policies.map(p => ({ scope, userId: row.userId, kind: p.kind, version: p.version })), skipDuplicates: true,
      })
      const old = tokenDigest(req)
      await tx.coreConsumerLoginSession.deleteMany({ where: { scope, OR: [{ expiresAt: { lte: new Date() } }, ...(old ? [{ digest: old }] : [])] } })
      await tx.coreConsumerLoginSession.create({ data: { scope, userId: row.userId, digest: digest(token), authVersion: row.authVersion, expiresAt } })
      await tx.coreConsumer.update({ where, data: { lastActivityAt: new Date() } })
    })
    res.cookie(cookieName, token, { ...cookie, maxAge: lifetime }).status(register ? 201 : 200).json({ signedIn: true, expiresAt })
  }
  api.post(authPath + '/register', (req, res) => authenticate(req, res, true))
  api.post(authPath + '/login', (req, res) => authenticate(req, res, false))
  api.post(authPath + '/logout', async (req, res) => {
    const token = tokenDigest(req)
    if (token) await db.coreConsumerLoginSession.deleteMany({ where: { digest: token, scope } })
    res.clearCookie(cookieName, cookie).status(204).end()
  })
  api.get('/consumer/me', async (req, res) => {
    const row = await current(db, req), settings = await readConsumerSettings(db, scope)
    res.json(publicProfile(row, settings.users.defaultAvatar))
  })
  api.patch('/consumer/me', async (req, res) => {
    await current(db, req)
    const input = profileUpdate.parse(req.body)
    if (input.avatar) { try { await validateSelectedImage(input.avatar) } catch { throw fail(400, '头像格式无效') } }
    const { version, ...data } = input
    res.json(await transaction(async tx => {
      const row = await current(tx, req)
      const saved = await tx.coreConsumer.updateMany({ where: { scope, userId: row.userId, version, enabled: true, deletedAt: null }, data: { ...data, version: { increment: 1 } } })
      if (!saved.count) throw fail(409, '个人资料已更新，请刷新后重试')
      const updated = await tx.coreConsumer.findUniqueOrThrow({ where: { scope_userId: { scope, userId: row.userId } } })
      return publicProfile(updated, (await readConsumerSettings(tx, scope)).users.defaultAvatar)
    }))
  })
  api.put('/consumer/me/password', async (req, res) => {
    const row = await current(db, req), input = passwordChange.parse(req.body)
    await limiter('password', row.userId, 10, 3600000)
    if (!row.passwordHash || !await passwordMatches(input.oldPassword, row.passwordHash)) throw fail(400, '原密码不正确')
    if (input.oldPassword === input.password) throw fail(400, '新密码不能与原密码相同')
    const next = await passwordHash(input.password)
    await transaction(async tx => {
      const active = await current(tx, req)
      if (active.passwordHash !== row.passwordHash) throw fail(409, '账号状态已变更，请重新登录')
      await tx.coreConsumer.update({ where: { scope_userId: { scope, userId: row.userId } }, data: { passwordHash: next, authVersion: { increment: 1 }, version: { increment: 1 } } })
      await tx.coreConsumerLoginSession.deleteMany({ where: { scope, userId: row.userId } })
    })
    res.clearCookie(cookieName, cookie).status(204).end()
  })
  api.get('/consumer/member', async (req, res) => {
    res.json(await transaction(async tx => {
      const row = await current(tx, req)
      return { member: await memberSummary(tx, scope, row.userId), wallet: await walletSummary(tx, scope, row.userId) }
    }))
  })
}
