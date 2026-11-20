import { z } from 'zod'
import { can } from './identity.mjs'
import { validateSelectedImage } from './material-images.mjs'

export const consumerSettingPermissions = ['core.consumer-settings.read', 'core.consumer-settings.write']
const users = z.object({
  prefix: z.string().trim().regex(/^[A-Za-z]{0,12}$/), digits: z.number().int().min(4).max(12),
  start: z.number().int().min(1).max(999999999), defaultAvatar: z.string().max(106700).nullable(),
}).strict()
const registration = z.object({ passwordLoginEnabled: z.boolean(), autoRegister: z.boolean() }).strict()
const defaults = { users: { prefix: 'HY', digits: 8, start: 1, defaultAvatar: null }, registration: { passwordLoginEnabled: true, autoRegister: true } }
export async function readConsumerSettings(db, scope) {
  const row = await db.coreConsumerSettings.findUnique({ where: { scope } })
  return {
    users: { ...defaults.users, ...row?.config.users },
    registration: { ...defaults.registration, ...row?.config.registration },
    version: row?.version ?? 0,
  }
}
export function registerConsumerSettings(api, { db, identity, fail, scope }) {
  const authorize = async (req, write = false) => {
    const actor = await identity(req)
    if (!can(actor, consumerSettingPermissions[0]) || (write && !can(actor, consumerSettingPermissions[1]))) throw fail(403, '没有用户设置权限')
    return actor
  }
  async function view(actor) {
    const config = await readConsumerSettings(db, scope)
    const counter = await db.coreConsumerCounter.findUnique({ where: { scope }, select: { nextNumber: true } })
    return { ...config, nextNumber: Math.max(Number(counter?.nextNumber || 1), config.users.start), canWrite: can(actor, consumerSettingPermissions[1]) }
  }
  api.get('/admin/consumer-settings', async (req, res) => res.json(await view(await authorize(req))))
  for (const [section, schema] of Object.entries({ users, registration })) {
    api.put('/admin/consumer-settings/' + section, async (req, res) => {
      const actor = await authorize(req, true)
      const { version, config } = z.object({ version: z.number().int().nonnegative(), config: schema }).strict().parse(req.body)
      if (config.defaultAvatar) {
        try { await validateSelectedImage(config.defaultAvatar) } catch { throw fail(400, '默认头像无效，请重新选择') }
      }
      const conflict = () => fail(409, '用户设置已更新，请刷新后重试')
      try {
        await db.$transaction(async tx => {
          const old = await readConsumerSettings(tx, scope)
          if (version !== old.version) throw conflict()
          const combined = { users: old.users, registration: old.registration, [section]: config }
          if (!version) await tx.coreConsumerSettings.create({ data: { scope, config: combined } })
          else if (!(await tx.coreConsumerSettings.updateMany({ where: { scope, version }, data: { config: combined, version: { increment: 1 } } })).count) throw conflict()
        })
      } catch (error) { if (error.code === 'P2002') throw conflict(); throw error }
      res.json(await view(actor))
    })
  }
}
