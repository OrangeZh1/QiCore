import express from 'express'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { PlatformStorage } from './media/settings.mjs'
import { MaterialLibrary } from './media/library.mjs'
import { isContentImagePublished, isContentImageReferenced } from './customer-content.mjs'

export const mediaPermissions = ['core.materials.read', 'core.materials.write', 'core.storage.read', 'core.storage.write']

export function registerMedia(api, db, identity, fail, application) {
  const root = process.env.FILES_ROOT || '.local/private'
  const storage = new PlatformStorage(db, { root: join(root, 'media'), keyRoot: join(process.env.INSTANCE_ROOT || '.local/instance', 'media-keys') })
  const library = new MaterialLibrary(db, storage, application, isContentImageReferenced)
  const base = '/admin/materials/:scope'
  api.get('/admin/storage', async (req, res) => res.json(await storage.view(await identity(req))))
  api.put('/admin/storage/:provider', async (req, res) => res.json(await storage.save(await identity(req), req.params.provider, req.body)))
  api.post('/admin/storage/:provider/test', async (req, res) => res.json(await storage.test(await identity(req), req.params.provider)))
  api.post('/admin/storage/:provider/default', async (req, res) => res.json(await storage.activate(await identity(req), req.params.provider, req.body)))
  api.get(base, async (req, res) => res.json(await library.list(await identity(req), req.params.scope, req.query)))
  api.post(base+'/upload', async (req, res, next) => {
    const actor = await identity(req)
    await library.authorize(actor, req.params.scope, true)
    if (!req.is('application/octet-stream')) throw fail(415, '请选择要上传的文件')
    const policy = await storage.publicPolicy()
    express.raw({ type: 'application/octet-stream', limit: policy.maxFileMb * 1024 * 1024 })(req, res, next)
  }, async (req, res) => res.status(201).json(await library.upload(await identity(req), req.params.scope, req.query, req.body)))
  api.post(base+'/move', async (req, res) => res.json(await library.move(await identity(req), req.params.scope, req.body)))
  api.post(base+'/delete', async (req, res) => res.json(await library.remove(await identity(req), req.params.scope, req.body)))
  api.post(base+'/groups', async (req, res) => res.status(201).json(await library.group(await identity(req), req.params.scope, null, req.body)))
  api.put(base+'/groups/:id', async (req, res) => res.json(await library.group(await identity(req), req.params.scope, req.params.id, req.body)))
  api.delete(base+'/groups/:id', async (req, res) => res.json(await library.group(await identity(req), req.params.scope, req.params.id, req.body, true)))
  api.post(base+'/:id/select', async (req, res) => res.json(await library.select(await identity(req), req.params.scope, req.params.id, req.body)))
  api.put(base+'/:id', async (req, res) => res.json(await library.rename(await identity(req), req.params.scope, req.params.id, req.body)))
  api.get(base+'/:id/content', async (req, res) => {
    const file = await library.streamContent(await identity(req), req.params.scope, req.params.id, req.query, req.headers.range)
    res.set('X-Content-Type-Options', 'nosniff').type(file.mime)
    res.set('Content-Disposition', (file.inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(file.name))
    if (file.data) return res.send(file.data)
    res.set('Accept-Ranges', 'bytes')
    if (file.range) res.status(206).set('Content-Range', 'bytes '+file.range.start+'-'+file.range.end+'/'+file.range.total)
    res.set('Content-Length', String(file.length))
    await pipeline(file.stream, res)
  })
  api.get('/public/materials/:id', async (req, res) => {
    const scopeKeys = application ? ['shared', application.key] : ['shared']
    const image = await db.coreMaterial.findFirst({ where: { id: req.params.id, scopeKey: { in:scopeKeys }, status:'ready', kind:'image', deletedAt:null } })
    if (!image || !await isContentImagePublished(db, image.id, application)) throw fail(404,'图片不存在')
    const revision = await storage.revision(image.revisionId)
    const bytes = await storage.providers.get(revision.provider,revision.config,storage.credentials(revision),image.objectKey,100*1024*1024)
    res.set('X-Content-Type-Options','nosniff').type('image/webp').send(bytes)
  })
}
