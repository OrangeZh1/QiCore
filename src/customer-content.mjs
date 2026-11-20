import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { renderPolicyMarkdown } from './content-policy-markdown.mjs'
import { can } from './identity.mjs'
import { richTextHasText, sanitizeRichTextHtml } from './content-rich-text.mjs'
import { assertMaterialImages, validateSelectedImage } from './material-images.mjs'

export const contentPermissions = ['core.content.read', 'core.content.write']
const identifier = z.uuid()
const version = z.number().int().min(0)
const sort = z.number().int().min(0).max(999999)
const visibleFields = { version, sort, enabled: z.boolean() }
const categoryInput = z.object({ ...visibleFields, name: z.string().trim().min(1).max(80) }).strict()
const articleInput = z.object({
  ...visibleFields, title: z.string().trim().min(1).max(120), categoryId: identifier,
  content: z.string().trim().min(1).max(1000000),
}).strict()
const publicListing = z.object({
  q: z.string().trim().max(100).default(''), categoryId: identifier.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict()
const adminListing = publicListing.extend({ status: z.enum(['all', 'enabled', 'disabled']).default('all') })
const policyKind = z.enum(['terms', 'privacy'])
const policyLabels = { terms: '用户协议', privacy: '隐私政策' }
const policyInput = z.object({
  version, title: z.string().trim().min(1).max(80), content: z.string().trim().min(1).max(1000000),
}).strict()
const image = z.string().max(400000).nullable()
const contactInput = z.object({
  miniMode: z.enum(['page', 'official']), phone: z.string().trim().max(30).refine(value => !value || /^\+?\d{5,20}$/.test(value.replace(/[ -]/g, ''))),
  wechat: z.string().trim().max(64), description: z.string().trim().max(1000).regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/),
  avatar: image, qrCode: image,
}).strict()
const contactDefaults = { miniMode: 'page', phone: '', wechat: '', description: '', avatar: null, qrCode: null }
const orderBy = [{ sort: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }]
const categoryFields = { id: true, name: true, sort: true, enabled: true, version: true, updatedAt: true }
const articleFields = { id: true, title: true, categoryId: true, sort: true, enabled: true, version: true, updatedAt: true, category: { select: { id: true, name: true, enabled: true } } }
const publicFields = { id: true, title: true, updatedAt: true, category: { select: { id: true, name: true } } }
const materialPath = /^\/api\/public\/materials\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

function contentScope(app) {
  return (typeof app === 'string' ? app : app?.key) || '@framework'
}

function cleanBody(raw, isPolicy, fail) {
  const imageAllowed = src => materialPath.test(src)
  const html = isPolicy ? renderPolicyMarkdown(raw, imageAllowed) : sanitizeRichTextHtml(raw, imageAllowed, false)
  if (!richTextHasText(html)) throw fail(400, '请输入有效的正文')
  const ids = new Set()
  const text = sanitizeHtml(html, {
    allowedTags: [], allowedAttributes: {},
    transformTags: { img(tagName, attribs) {
      const match = materialPath.exec(attribs.src || '')
      if (match) ids.add(match[1].toLowerCase())
      return { tagName, attribs }
    } },
  }).slice(0, 30000)
  if (ids.size > 100) throw fail(400, '正文最多使用 100 张素材图片')
  return { html, text, images: [...ids] }
}

export async function isContentImagePublished(db, materialId, application) {
  const scope = contentScope(application)
  const [article, revision] = await Promise.all([
    db.coreHelpImage.findFirst({ where: { scope, materialId, article: { deletedAt: null, enabled: true, category: { deletedAt: null, enabled: true } } }, select: { materialId: true } }),
    db.corePolicyImage.findFirst({ where: { scope, materialId }, select: { materialId: true } }),
  ])
  return Boolean(article || revision)
}

export async function isContentImageReferenced(db, materialId) {
  const [article, revision] = await Promise.all([
    db.coreHelpImage.findFirst({ where: { materialId, article: { deletedAt: null } }, select: { materialId: true } }),
    db.corePolicyImage.findFirst({ where: { materialId }, select: { materialId: true } }),
  ])
  return Boolean(article || revision)
}

export function registerCustomerContent(api, db, identity, fail, application) {
  const scope = contentScope(application)
  const materialScope = application?.key || 'shared'
  const common = { scope, deletedAt: null }
  const published = { ...common, enabled: true, category: { enabled: true, deletedAt: null } }
  const conflict = () => fail(409, '内容已变更，请刷新后重试')
  const transaction = fn => db.$transaction(fn, { isolationLevel: 'Serializable' })

  async function authorize(req, write = false) {
    const account = await identity(req)
    if (!can(account, write ? 'core.content.write' : 'core.content.read')) throw fail(403, '没有内容管理权限')
    return { actor: account.id, canWrite: can(account, 'core.content.write') }
  }

  function audit(tx, actor, action, details) {
    return tx.coreAuditEvent.create({ data: { id: randomUUID(), actor, action, details: { scope, ...details } } })
  }

  async function getListing(input, publicOnly) {
    const query = (publicOnly ? publicListing : adminListing).parse(input)
    const where = {
      ...(publicOnly ? published : common),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(!publicOnly && query.status !== 'all' ? { enabled: query.status === 'enabled' } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q } }, { searchText: { contains: query.q } }] } : {}),
    }
    return db.$transaction(async tx => {
      const total = await tx.coreHelpArticle.count({ where })
      const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)))
      const categories = await tx.coreHelpCategory.findMany({
        where: publicOnly ? { ...common, enabled: true } : common, orderBy,
        select: publicOnly ? { id: true, name: true } : categoryFields,
      })
      const items = await tx.coreHelpArticle.findMany({
        where, orderBy, skip: (page - 1) * query.pageSize, take: query.pageSize,
        select: publicOnly ? publicFields : articleFields,
      })
      return { categories, items, total, page, pageSize: query.pageSize }
    }, { isolationLevel: 'RepeatableRead' })
  }

  api.get('/admin/help', async (req, res) => {
    const { canWrite } = await authorize(req)
    res.json({ ...await getListing(req.query, false), canWrite })
  })
  api.get('/public/help', async (req, res) => res.json(await getListing(req.query, true)))

  for (const audience of ['admin', 'public']) {
    const manage = audience === 'admin'
    api.get(manage ? '/admin/help/articles/:id' : '/public/help/:id', async (req, res) => {
      if (manage) await authorize(req)
      const id = identifier.parse(req.params.id)
      const row = await db.coreHelpArticle.findFirst({ where: { ...(manage ? common : published), id },
        select: { ...(manage ? articleFields : publicFields), content: true } })
      if (!row) throw fail(404, '帮助文章不存在或已隐藏')
      res.json(row)
    })
  }

  for (const type of ['categories', 'articles']) {
    const category = type === 'categories'
    const endpoint = '/admin/help/' + type + '/:id'
    api.put(endpoint, async (req, res) => {
      const { actor } = await authorize(req, true)
      const id = identifier.parse(req.params.id)
      const { version: expected, ...data } = (category ? categoryInput : articleInput).parse(req.body)
      const content = category ? null : cleanBody(data.content, false, fail)
      if (content) Object.assign(data, { content: content.html, searchText: content.text })
      res.json(await transaction(async tx => {
        const model = category ? tx.coreHelpCategory : tx.coreHelpArticle
        if (!category && !await tx.coreHelpCategory.findFirst({ where: { ...common, id: data.categoryId }, select: { id: true } })) {
          throw fail(400, '请选择有效的帮助分类')
        }
        if (category && !expected && await model.count({ where: common }) >= 100) throw fail(409, '最多可创建 100 个分类')
        if (content?.images.length) await assertMaterialImages(tx, content.images, materialScope)
        if (!expected) await model.create({ data: { ...data, scope, id } })
        else {
          const result = await model.updateMany({ where: { ...common, id, version: expected }, data: { ...data, version: { increment: 1 } } })
          if (!result.count) throw conflict()
        }
        if (content) {
          await tx.coreHelpImage.deleteMany({ where: { scope, articleId: id } })
          if (content.images.length) await tx.coreHelpImage.createMany({ data: content.images.map(materialId => ({ scope, articleId: id, materialId })) })
        }
        await audit(tx, actor, 'help.' + type + '.save', { id, version: expected + 1 })
        return { id, version: expected + 1 }
      }))
    })
    api.delete(endpoint, async (req, res) => {
      const { actor } = await authorize(req, true)
      const id = identifier.parse(req.params.id)
      const { version: expected } = z.object({ version }).strict().parse(req.body)
      await transaction(async tx => {
        const model = category ? tx.coreHelpCategory : tx.coreHelpArticle
        const old = await model.findUnique({ where: { scope_id: { scope, id } } })
        if (!old) throw fail(404, '内容不存在')
        if (old.deletedAt) return
        if (old.version !== expected) throw conflict()
        if (category && await tx.coreHelpArticle.count({ where: { ...common, categoryId: id } })) throw fail(409, '请先移动或删除分类中的文章')
        const result = await model.updateMany({ where: { ...common, id, version: expected },
          data: { enabled: false, deletedAt: new Date(), version: { increment: 1 } } })
        if (!result.count) throw conflict()
        await audit(tx, actor, 'help.' + type + '.delete', { id, version: expected + 1 })
      })
      res.json({ deleted: true })
    })
  }

  async function latestPolicy(kind) {
    return db.corePolicyRevision.findFirst({ where: { scope, kind }, orderBy: { version: 'desc' } })
  }
  function policyView(kind, row) {
    return { kind, title: row?.title || policyLabels[kind], version: row?.version || 0, content: row?.content || '',
      contentHtml: row?.content || '', contentFormat: 'richtext', updatedAt: row?.publishedAt || null }
  }
  api.get('/admin/policies', async (req, res) => {
    const { canWrite } = await authorize(req)
    const { kind } = z.object({ kind: policyKind.optional() }).strict().parse(req.query)
    if (kind) return res.json({ ...policyView(kind, await latestPolicy(kind)), canWrite })
    const items = await Promise.all(Object.entries(policyLabels).map(async ([key, label]) => {
      const row = await latestPolicy(key)
      return { kind: key, label, title: row?.title || label, updatedAt: row?.publishedAt || null }
    }))
    res.json({ items, canWrite })
  })
  api.put('/admin/policies/:kind', async (req, res) => {
    const { actor } = await authorize(req, true)
    const kind = policyKind.parse(req.params.kind)
    const { version: expected, ...input } = policyInput.parse(req.body)
    const content = cleanBody(input.content, true, fail)
    const revision = await transaction(async tx => {
      const latest = await tx.corePolicyRevision.findFirst({ where: { scope, kind }, orderBy: { version: 'desc' }, select: { version: true } })
      if ((latest?.version || 0) !== expected) throw conflict()
      if (content.images.length) await assertMaterialImages(tx, content.images, materialScope)
      const saved = await tx.corePolicyRevision.create({ data: { scope, kind, version: expected + 1, title: input.title, content: content.html,
        ...(content.images.length ? { images: { create: content.images.map(materialId => ({ materialId })) } } : {}) } })
      await audit(tx, actor, 'policy.save', { kind, version: saved.version })
      return saved
    })
    res.json({ ...policyView(kind, revision), canWrite: true })
  })
  api.get('/public/policies/:kind', async (req, res) => {
    const kind = policyKind.parse(req.params.kind)
    const { version: requested } = z.object({ version: z.coerce.number().int().positive().optional() }).strict().parse(req.query)
    const row = requested ? await db.corePolicyRevision.findUnique({ where: { scope_kind_version: { scope, kind, version: requested } } }) : await latestPolicy(kind)
    if (!row) throw fail(404, '协议尚未提供')
    res.json(policyView(kind, row))
  })

  api.get('/admin/customer-service', async (req, res) => {
    const { canWrite } = await authorize(req)
    const row = await db.coreContactSettings.findUnique({ where: { scope } })
    res.json({ canWrite, version: row?.version || 0, config: row?.config || contactDefaults })
  })
  api.put('/admin/customer-service', async (req, res) => {
    const { actor } = await authorize(req, true)
    const { version: expected, config } = z.object({ version, config: contactInput }).strict().parse(req.body)
    for (const field of ['avatar', 'qrCode']) if (config[field]) await validateSelectedImage(config[field])
    await transaction(async tx => {
      if (!expected) await tx.coreContactSettings.create({ data: { scope, config } })
      else {
        const updated = await tx.coreContactSettings.updateMany({ where: { scope, version: expected }, data: { config, version: { increment: 1 } } })
        if (!updated.count) throw conflict()
      }
      await audit(tx, actor, 'customer-service.save', { version: expected + 1 })
    })
    res.json({ canWrite: true, version: expected + 1, config })
  })
  const publicContact = async (_req, res) => {
    const row = await db.coreContactSettings.findUnique({ where: { scope }, select: { config: true } })
    res.json(row?.config || contactDefaults)
  }
  api.get('/public/customer-service', publicContact)
}
