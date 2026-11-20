import { z } from 'zod'
import { can } from './identity.mjs'
import { validateSelectedImage } from './material-images.mjs'

export const siteSettingPermissions = ['core.site.read', 'core.site.write']

const siteId = 'instance'
const text = max => z.string().trim().max(max).refine(value => !/[<>\u0000-\u001f\u007f]/.test(value))
const image = z.string().max(120000).regex(/^data:image\/webp;base64,[a-z0-9+/]+={0,2}$/i).nullable()
const link = z.string().trim().max(2048).refine(value => {
  if (!value) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
})
const settings = z.object({
  name: text(30).min(1), logo: image, favicon: image, defaultAvatar: image, copyright: text(160),
  filing: z.object({ icpNumber: text(80), icpLink: link, policeNumber: text(80), policeLink: link }).strict(),
}).strict()
const update = z.object({ version: z.number().int().nonnegative(), config: settings }).strict()

function defaults(defaultName) {
  return {
    name: defaultName || 'QiCore', logo: null, favicon: null, defaultAvatar: null, copyright: '',
    filing: { icpNumber: '', icpLink: '', policeNumber: '', policeLink: '' },
  }
}
function view(row, defaultName, account) {
  return {
    config: row?.config ?? defaults(defaultName), version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null,
    inherited: !row, canWrite: can(account, 'core.site.write'),
  }
}

export async function getCoreSiteBrand(db, defaultName = 'QiCore') {
  const row = await db.siteSetting.findUnique({ where: { id: siteId } })
  return { ...(row?.config ?? defaults(defaultName)), version: row?.version ?? 0 }
}

export function registerSiteSettings(api, { db, identity, fail, defaultName = 'QiCore' }) {
  async function authorize(req, write = false) {
    const account = await identity(req)
    if (!can(account, 'core.site.read') || (write && !can(account, 'core.site.write'))) throw fail(403, '没有站点设置权限')
    return account
  }

  api.get('/public/site-brand', async (_req, res) => res.json(await getCoreSiteBrand(db, defaultName)))
  api.get('/admin/site-settings', async (req, res) => {
    const actor = await authorize(req)
    res.json(view(await db.siteSetting.findUnique({ where: { id: siteId } }), defaultName, actor))
  })
  api.put('/admin/site-settings', async (req, res) => {
    const actor = await authorize(req, true)
    const result = update.safeParse(req.body)
    if (!result.success) throw fail(400, '请检查显示名称、品牌图片及备案链接格式')
    const { config, version } = result.data
    for (const field of ['logo', 'favicon', 'defaultAvatar']) {
      if (config[field]) {
        try { await validateSelectedImage(config[field]) }
        catch { throw fail(400, '品牌图片无效，请从素材库重新选择') }
      }
    }
    const conflict = () => fail(409, '站点设置已更新，请重新读取后编辑')
    try {
      const row = await db.$transaction(async tx => {
        if (version === 0) return tx.siteSetting.create({ data: { id: siteId, config } })
        const saved = await tx.siteSetting.updateMany({ where: { id: siteId, version }, data: { config, version: { increment: 1 } } })
        if (!saved.count) throw conflict()
        return tx.siteSetting.findUniqueOrThrow({ where: { id: siteId } })
      })
      res.json(view(row, defaultName, actor))
    } catch (error) {
      if (error.code === 'P2002') throw conflict()
      throw error
    }
  })
}
