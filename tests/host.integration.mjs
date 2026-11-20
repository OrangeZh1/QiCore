import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { startHost } from '../src/host.mjs'
import { db } from '../src/db.mjs'
import { passwordHash } from '../src/identity.mjs'
import { registerConsumerAuth } from '../src/consumer-auth.mjs'
import { walletSummary } from '../src/consumers/wallet.mjs'
import example from '../examples/hello/application.mjs'

if (!/^\/qc_fixture_[\w]+$/.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw Error('此用例需要隔离的 qc_fixture_ 测试库')
}
const ownerId = randomUUID()
const app = await startHost(example, { port: 0, ownerId })
const origin = 'http://127.0.0.1:' + new URL(await app.getUrl()).port
async function request(method, path, cookie, data, status = 200) {
  const response = await fetch(origin + '/api' + path, {
    method,
    headers: { cookie: cookie || '', ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  assert.equal(response.status, status, method + ' ' + path)
  return response
}
const get = async (path, cookie) => (await request('GET', path, cookie)).json()
async function signIn(login, password) {
  const response = await request('POST', '/auth/login', null, { login, password })
  return response.headers.getSetCookie()[0].split(';')[0]
}

try {
  const salt = randomBytes(5).toString('hex')
  assert.equal(typeof registerConsumerAuth,'function')
  const walletScope='qa-'+salt
  await db.coreConsumerWallet.createMany({data:[
    {scope:walletScope,userId:salt,asset:'points',amount:12n,version:2},
    {scope:walletScope+'-other',userId:salt,asset:'balance',amount:67n,version:1},
  ]})
  assert.deepEqual(await walletSummary(db,walletScope,salt),{points:{amount:12,version:2},balance:{amount:0,version:0}})
  const secret = randomBytes(16).toString('hex')
  const root = await db.account.create({
    data: { id: ownerId, login: 'qa-admin-' + salt, displayName: '验收管理员', passwordHash: await passwordHash(secret), roleId: 'admin' },
  })
  const admin = await signIn(root.login, secret)
  const loginViaProxy=(client,login,password)=>fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-qicore-client-ip':client},body:JSON.stringify({login,password})})
  for(let i=0;i<41;i++)assert.equal((await loginViaProxy('192.0.2.10',root.login,secret)).status,200)
  for(let i=0;i<40;i++)assert.equal((await loginViaProxy('192.0.2.11',root.login,'wrong')).status,401)
  assert.equal((await loginViaProxy('192.0.2.11',root.login,secret)).status,429)
  assert.equal((await loginViaProxy('192.0.2.12',root.login,secret)).status,200)

  const baseline = await get('/core/overview', admin)
  assert.equal(baseline.application.key, example.key)
  assert.equal(baseline.application.title, example.title)
  await request('GET', '/core/overview', null, null, 401)
  await request('GET', '/apps/hello/hello', null, null, 401)

  const role = { id: 'qa-' + salt, title: '应用成员', permissions: ['hello.read'] }
  const rolePath = '/admin/roles/' + role.id
  await request('POST', '/admin/roles', admin, role, 201)
  await request('POST', '/admin/roles', admin, { ...role, title: '重复名称' }, 409)
  assert.equal((await get('/admin/roles', admin)).roles.find(row => row.id === role.id).title, role.title)
  await request('PUT', '/admin/roles/admin', admin, { title: '覆盖内置角色', permissions: [] }, 400)
  await request('PATCH', '/admin/accounts/' + root.id, admin, { roleId: 'member' }, 400)
  await request('PATCH', '/admin/accounts/' + root.id, admin, { enabled: false }, 400)

  const member = { login: 'qa-member-' + salt, displayName: '集成人员', password: secret, roleId: role.id }
  const created = await (await request('POST', '/admin/accounts', admin, member, 201)).json()
  const accountPath = '/admin/accounts/' + created.id
  let cookie = await signIn(member.login, secret)
  assert.equal((await get('/apps/hello/hello', cookie)).message, '你好，集成人员')
  const summary = await get('/core/overview', cookie)
  assert.equal(summary.accounts, null)
  assert.equal(summary.roles, null)
  await request('GET', '/admin/accounts?page=1', cookie, null, 403)
  await request('GET', '/admin/roles', cookie, null, 403)

  // Existing sessions must observe an edited role without having to sign in again.
  await request('PUT', rolePath, admin, { title: '目录查看员', permissions: ['core.accounts.read', 'core.roles.read'] })
  await request('GET', '/apps/hello/hello', cookie, null, 403)
  const directory = await get('/admin/accounts?page=1&pageSize=10&q=' + member.login + '&status=enabled', cookie)
  assert.equal(directory.total, 1)
  assert.equal(directory.items[0].role.title, '目录查看员')
  assert.equal('passwordHash' in directory.items[0], false)
  assert.ok(Array.isArray(await get('/admin/accounts', admin)), '既有应用使用的无分页返回格式')
  assert.equal((await get('/admin/roles', cookie)).roles.find(row => row.id === role.id)._count.accounts, 1)
  const stats = await get('/core/overview', cookie)
  assert.deepEqual(stats.accounts, { total: baseline.accounts.total + 1, enabled: baseline.accounts.enabled + 1 })
  assert.equal(stats.roles, baseline.roles + 1)
  await request('PATCH', accountPath, cookie, { enabled: false }, 403)
  await request('PUT', rolePath, cookie, { title: '无权修改', permissions: [] }, 403)
  await request('PUT', rolePath, admin, { title: '无效权限', permissions: ['unknown.new'] }, 400)
  // Migrated roles may still contain permissions from a previously installed application.
  await db.role.update({ where: { id: role.id }, data: { permissions: ['retired.read'] } })
  await request('PUT', rolePath, admin, { title: '旧版角色', permissions: ['retired.read'] })
  await request('GET', '/admin/accounts', cookie, null, 403)

  await request('PATCH', accountPath, admin, { roleId: 'member', displayName: '新成员' })
  await request('GET', '/me', cookie, null, 401)
  cookie = await signIn(member.login, secret)
  assert.equal((await get('/me', cookie)).account.displayName, '新成员')
  await request('PATCH', '/me', cookie, { displayName: '成员昵称' })
  await request('PATCH', '/me', cookie, { avatar: 'https://invalid.example/avatar.webp' }, 400)
  const cleared = await (await request('PATCH', '/me', cookie, { avatar: null })).json()
  assert.equal(cleared.avatar, null)
  assert.equal((await get('/me', cookie)).account.displayName, '成员昵称')
  const updatedPassword = randomBytes(18).toString('hex')
  await request('PUT', '/me/password', cookie, { currentPassword: 'incorrect', password: updatedPassword }, 400)
  const otherSession = await signIn(member.login, secret)
  await request('PUT', '/me/password', cookie, { currentPassword: secret, password: updatedPassword }, 204)
  for (const previous of [cookie, otherSession]) await request('GET', '/me', previous, null, 401)
  await request('POST', '/auth/login', null, { login: member.login, password: secret }, 401)
  cookie = await signIn(member.login, updatedPassword)

  await request('PUT', accountPath + '/password', admin, { password: secret }, 204)
  await request('GET', '/me', cookie, null, 401)
  await request('POST', '/auth/login', null, { login: member.login, password: updatedPassword }, 401)
  cookie = await signIn(member.login, secret)
  await request('PATCH', accountPath, admin, { enabled: false })
  await request('GET', '/me', cookie, null, 401)
  await request('POST', '/auth/login', null, { login: member.login, password: secret }, 401)
  const afterDisable = await get('/core/overview', admin)
  assert.equal(afterDisable.accounts.enabled, baseline.accounts.enabled)
  assert.equal(afterDisable.accounts.total, baseline.accounts.total + 1)
  await request('PATCH', accountPath, admin, { enabled: true })
  await signIn(member.login, secret)
  const adminPath = '/admin/administrators'
  const rolesPath = '/admin/roles'
  const writeGrants = ['core.accounts.read', 'core.accounts.write', 'core.roles.read', 'core.roles.write']
  const roleInput = { name: '目录管理-' + salt, enabled: true, permissions: writeGrants, requestId: randomUUID() }
  const newRole = async (body, actor = admin) => (await request('POST', rolesPath, actor, body, 201)).json()
  const newAccount = async (body, actor = admin) => (await request('POST', adminPath, actor, body, 201)).json()
  const [managerRole, sameRole] = await Promise.all([newRole(roleInput), newRole(roleInput)])
  assert.equal(managerRole.id, sameRole.id, '同时重放请求只创建一个角色')
  await request('POST', rolesPath, admin, { ...roleInput, name: '另一角色' }, 409)
  const restricted = await newRole({ ...roleInput, name: '高权限-' + salt, permissions: ['hello.read'], requestId: randomUUID() })
  const memberInput = {
    username: 'manager-' + salt, nickname: '目录管理员', phone: '+86 123', roleId: managerRole.id,
    enabled: true, allowMultipleSessions: false, password: secret, requestId: randomUUID(),
  }
  const manager = await newAccount(memberInput)
  assert.equal((await newAccount(memberInput)).id, manager.id)
  await request('POST', adminPath, admin, { ...memberInput, password: updatedPassword }, 409)
  const previousLogin = await signIn(memberInput.username, secret)
  const managerCookie = await signIn(memberInput.username, secret)
  await request('GET', '/me', previousLogin, null, 401)
  const directoryView = await get(adminPath + '?q=' + encodeURIComponent(memberInput.phone), managerCookie)
  assert.equal(directoryView.total, 1)
  assert.equal(directoryView.items[0].phone, memberInput.phone)
  assert.ok(directoryView.items[0].createdAt)
  assert.equal(directoryView.items[0].editable, false, '本人不能从目录修改自身权限')
  const ownerView = (await get(adminPath + '?q=' + root.login, managerCookie)).items[0]
  assert.equal(ownerView.owner, true)
  assert.equal(ownerView.editable, false)
  const grants = await get(rolesPath + '?page=1&pageSize=100', managerCookie)
  assert.equal(grants.canWrite, true)
  assert.equal(grants.catalog.find(entry => entry.key === 'hello.read').grantable, false)
  assert.equal(grants.items.find(entry => entry.id === managerRole.id).editable, false)
  const targetRoles = (await get(adminPath + '/roles?pageSize=100', managerCookie)).items
  assert.equal(targetRoles.find(entry => entry.id === restricted.id).assignable, false)
  const roleChange = { name: '被保护', permissions: [], enabled: false, version: 1 }
  await request('PUT', rolesPath + '/' + restricted.id, managerCookie, roleChange, 403)
  await request('PUT', rolesPath + '/' + managerRole.id, managerCookie, roleChange, 403)
  await request('DELETE', rolesPath + '/member', admin, { version: 1 }, 403)
  await request('POST', rolesPath, managerCookie, { ...roleInput, name: '越权角色', requestId: randomUUID(), permissions: ['hello.read'] }, 403)
  await request('POST', rolesPath, managerCookie, { ...roleInput, name: '缺少查看', requestId: randomUUID(), permissions: ['core.accounts.write'] }, 400)
  const privileged = await newAccount({ ...memberInput, username: 'high-' + salt, roleId: restricted.id, requestId: randomUUID() })
  const reset = { password: updatedPassword, version: 1, accountVersion: 1 }
  await request('PUT', adminPath + '/' + privileged.id + '/password', managerCookie, reset, 403)
  await request('DELETE', adminPath + '/' + root.id, managerCookie, { version: 1 }, 403)
  await request('POST', adminPath, managerCookie, { ...memberInput, username: 'forbidden-' + salt, roleId: 'admin', requestId: randomUUID() }, 403)

  const workerRole = await newRole({ ...roleInput, name: '目录只读-' + salt, permissions: ['core.accounts.read'], requestId: randomUUID() }, managerCookie)
  const worker = await newAccount({ ...memberInput, username: 'worker-' + salt, roleId: workerRole.id, requestId: randomUUID() }, managerCookie)
  const workerPath = adminPath + '/' + worker.id
  const beforeChange = await signIn(worker.username, secret)
  const edit = { nickname: '更新后的员工', phone: '', roleId: workerRole.id, enabled: true, allowMultipleSessions: true, version: 1, accountVersion: 1 }
  await request('PUT', workerPath, managerCookie, edit)
  await request('PUT', workerPath, managerCookie, edit, 409)
  await request('GET', '/me', beforeChange, null, 401)
  const beforePause = await signIn(worker.username, secret)
  await request('DELETE', rolesPath + '/' + workerRole.id, managerCookie, { version: 1 }, 409)
  await request('PUT', rolesPath + '/' + workerRole.id, managerCookie, { ...roleChange, name: workerRole.name })
  await request('GET', '/me', beforePause, null, 401)
  await request('POST', '/auth/login', null, { login: worker.username, password: secret }, 401)
  await request('DELETE', workerPath, managerCookie, { version: 2 })
  assert.ok(await db.account.findUnique({ where: { id: worker.id }, select: { deletedAt: true } }).then(row => row.deletedAt))
  assert.equal((await get(adminPath + '?q=' + worker.username, managerCookie)).total, 0)
  await request('DELETE', rolesPath + '/' + workerRole.id, managerCookie, { version: 2 })
  console.log('PASS 企业目录创建幂等、委派授权边界、管理员与角色版本、单会话、所有者保护及软移除')
  console.log('PASS 真实登录、权限变更、目录统计与只读边界、保留角色、账号启停、密码与会话撤销')
} finally {
  await app.close()
  await db.$disconnect()
}
