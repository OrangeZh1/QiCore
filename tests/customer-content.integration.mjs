import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '../src/db.mjs'
import { passwordHash } from '../src/identity.mjs'
import { startHost } from '../src/host.mjs'
import { isContentImagePublished, isContentImageReferenced } from '../src/customer-content.mjs'

if (!/^\/qc_fixture_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL).pathname)) throw Error('内容验收需要独立测试数据库')
const salt = randomUUID().slice(0, 8)
const scope = 'content-' + salt
const host = await startHost({ key: scope, title: '帮助中心用例', menus: [], permissions: [], register() {} }, { port: 0 })
const origin = 'http://127.0.0.1:' + new URL(await host.getUrl()).port
async function call(method, path, cookie, input, expected = 200) {
  const r = await fetch(origin + '/api' + path, {
    method, headers: { cookie: cookie || '', ...(input ? { 'content-type': 'application/json' } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  })
  assert.equal(r.status, expected, method + ' ' + path + ' ' + (r.status === expected ? '' : await r.text()))
  return r
}
async function login(roleId) {
  const password = randomBytes(16).toString('hex')
  const account = await db.account.create({ data: { login: roleId + '-' + salt, roleId, displayName: '验收', passwordHash: await passwordHash(password) } })
  const r = await call('POST', '/auth/login', '', { login: account.login, password })
  return r.headers.getSetCookie()[0].split(';')[0]
}
try {
  const readerRole = 'content-read-' + salt
  await db.role.create({ data: { id: readerRole, title: '内容只读', permissions: ['core.content.read'] } })
  const admin = await login('admin'), reader = await login(readerRole)
  await call('GET', '/admin/help', '', null, 401)
  const list = await (await call('GET', '/admin/help', reader)).json()
  assert.equal(list.canWrite, false)
  const catId = randomUUID(), articleId = randomUUID(), assetId = randomUUID()
  const category = { version: 0, name: '产品使用', sort: 1, enabled: false }
  const cat = '/admin/help/categories/' + catId, post = '/admin/help/articles/' + articleId
  await call('PUT', cat, reader, category, 403)
  await call('PUT', cat, admin, category)
  await db.coreMaterial.create({ data: { id: assetId, scopeKey: scope, kind: 'image', name: '验收图片', mime: 'image/webp',
    bytes: 1, hash: '0'.repeat(64), provider: 'local', revisionId: randomUUID(), objectKey: randomUUID(), ownerId: 'test', status: 'ready' } })
  const article = { version: 0, title: '接入说明', categoryId: catId, sort: 2, enabled: true,
    content: '<p>如何接入</p><img src="/api/public/materials/' + assetId + '">' }
  await call('PUT', post, admin, { ...article, content: '<p>正文</p><img src="/api/public/materials/' + randomUUID() + '">' }, 400)
  await call('PUT', post, admin, article)
  assert.equal(await isContentImageReferenced(db, assetId), true)
  assert.equal(await isContentImagePublished(db, assetId, scope), false)
  await call('GET', '/public/help/' + articleId, '', null, 404)
  await call('PUT', cat, admin, { ...category, version: 1, enabled: true })
  await call('PUT', cat, admin, { ...category, version: 1, name: '过期请求' }, 409)
  assert.equal(await isContentImagePublished(db, assetId, scope), true)
  assert.equal(await isContentImagePublished(db, assetId, 'other'), false)
  assert.equal((await (await call('GET', '/public/help?q=' + encodeURIComponent('接入'))).json()).total, 1)
  const visible = await (await call('GET', '/public/help/' + articleId)).json()
  assert.ok(visible.content.includes('/api/public/materials/' + assetId))
  await call('DELETE', cat, admin, { version: 2 }, 409)
  await call('DELETE', post, admin, { version: 1 })
  await call('DELETE', cat, admin, { version: 2 })
  assert.equal(await isContentImageReferenced(db, assetId), false)
  assert.equal((await (await call('GET', '/public/help')).json()).total, 0)
  await call('GET', '/public/policies/privacy', '', null, 404)
  const policy = { version: 0, title: '隐私政策', content: '# 第一版\n\n<img src="/api/public/materials/' + assetId + '">' }
  await call('PUT', '/admin/policies/privacy', reader, policy, 403)
  await call('PUT', '/admin/policies/privacy', admin, policy)
  await call('PUT', '/admin/policies/privacy', admin, { ...policy, version: 1, content: '<p>第二版</p>' })
  await call('PUT', '/admin/policies/privacy', admin, { ...policy, version: 1 }, 409)
  assert.equal((await (await call('GET', '/public/policies/privacy')).json()).version, 2)
  assert.match((await (await call('GET', '/public/policies/privacy?version=1')).json()).contentHtml, /第一版/)
  assert.equal(await isContentImagePublished(db, assetId, scope), true, '旧版协议中使用的图片仍可读取')
  const defaults = await (await call('GET', '/public/customer-service')).json()
  assert.equal(defaults.miniMode, 'page')
  const config = { ...defaults, miniMode: 'official', phone: '+86 13800000000', description: '工作日服务' }
  await call('PUT', '/admin/customer-service', reader, { version: 0, config }, 403)
  await call('PUT', '/admin/customer-service', admin, { version: 0, config })
  await call('PUT', '/admin/customer-service', admin, { version: 0, config }, 409)
  assert.deepEqual(await (await call('GET', '/public/customer-service')).json(), config)
  assert.ok(await db.coreAuditEvent.findFirst({ where: { action: 'customer-service.save', details: { path: '$.scope', equals: scope } } }))
  console.log('PASS 帮助发布、分类过滤与删除约束、图片归属及公开范围、协议旧版、客服设置与内容权限')
} finally {
  await host.close()
  await db.$disconnect()
}
