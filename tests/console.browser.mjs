import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

async function heldRequest(page, path, method, trigger, check, responseOverride) {
  const matches = request => request.method() === method && new URL(request.url()).pathname === path
  const gate = Promise.withResolvers()
  const isEndpoint = url => url.pathname === path
  const handler = async route => {
    if (!matches(route.request())) return route.continue()
    await gate.promise
    if (responseOverride) return route.fulfill(responseOverride)
    await route.continue()
  }
  await page.route(isEndpoint, handler)
  try {
    const [request] = await Promise.all([page.waitForRequest(matches), trigger()])
    await check(request)
    return request
  } finally {
    gate.resolve()
    await page.unroute(isEndpoint, handler)
  }
}

async function verifyAccountFilters(page, memberLogin, adminLogin) {
  const search = page.getByRole('textbox', { name: '搜索账号、名称或手机号' })
  const button = name => page.getByRole('button', { name, exact: true })
  const lookup = button('查询'), reset = button('重置'), topRefresh = button('刷新当前页面')
  const memberRow = page.getByRole('row').filter({ hasText: memberLogin })
  const adminRow = page.getByRole('row').filter({ hasText: adminLogin })
  const directory = '/api/admin/administrators'

  const paged = url => url.pathname === directory
  const sample = await page.request.get(new URL(directory + '?page=1&pageSize=20', page.url()).href)
  assert.equal(sample.status(), 200)
  const firstPage = await sample.json()
  assert.ok(firstPage.items.some(row => row.username === memberLogin))
  // Populate an additional page without creating unrelated accounts in the fixture.
  const pageFixture = route => route.fulfill({ json: { ...firstPage, total: 41 } })
  await page.route(paged, pageFixture)
  try {
    await Promise.all([page.waitForResponse(r => paged(new URL(r.url()))), lookup.click()])
    await Promise.all([
      page.waitForResponse(r => paged(new URL(r.url())) && new URL(r.url()).searchParams.get('page') === '2'),
      button('下一页').click(),
    ])
  } finally { await page.unroute(paged, pageFixture) }

  let resetReads = 0
  const countResetReads = r => { if (r.method() === 'GET' && paged(new URL(r.url()))) resetReads++ }
  page.on('request', countResetReads)
  try {
    await heldRequest(page, directory, 'GET', () => reset.click(), async req => {
      assert.equal(new URL(req.url()).searchParams.get('page'), '1')
      assert.equal(await reset.getAttribute('aria-busy'), 'true')
      assert.equal(await lookup.getAttribute('aria-busy'), 'false')
      assert.ok(await topRefresh.isEnabled())
    })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => el.textContent.trim() === '重置' && el.getAttribute('aria-busy') === 'false'))
    assert.equal(resetReads, 1, '后续页重置只发一次目录读取')
  } finally { page.off('request', countResetReads) }

  await search.fill(memberLogin)
  await heldRequest(page, directory, 'GET', () => lookup.click(), async () => {
    assert.equal(await lookup.getAttribute('aria-busy'), 'true')
    assert.equal(await reset.getAttribute('aria-busy'), 'false')
    assert.ok(await topRefresh.isEnabled())
  })
  await adminRow.waitFor({ state: 'hidden' })
  await memberRow.waitFor()

  // Leave a filtered search outstanding until the real unfiltered reset has completed.
  let stale
  await heldRequest(page, directory, 'GET', () => lookup.click(), async request => {
    stale = request
    assert.equal(new URL(request.url()).searchParams.get('q'), memberLogin)
    await heldRequest(page, directory, 'GET', () => reset.click(), async replacement => {
      const params = new URL(replacement.url()).searchParams
      assert.equal(params.get('q') || '', '')
      assert.equal(params.get('page'), '1')
      assert.equal(await lookup.getAttribute('aria-busy'), 'false')
      assert.equal(await reset.getAttribute('aria-busy'), 'true')
      assert.ok(await topRefresh.isEnabled())
    })
    await adminRow.waitFor()
  })
  assert.equal(await stale.response(), null, '被重置取消的查询不能重新写入成员列表')
  assert.equal(await search.inputValue(), '')
  assert.equal(await reset.getAttribute('aria-busy'), 'false')
  assert.ok(await memberRow.isVisible())
  assert.ok(await adminRow.isVisible())

  await search.fill(memberLogin)
  const message = '目录读取暂时失败'
  await heldRequest(page, directory, 'GET', () => lookup.click(), async () => {
    assert.equal(await lookup.getAttribute('aria-busy'), 'true')
    assert.equal(await reset.getAttribute('aria-busy'), 'false')
  }, { status: 422, json: { message } })
  await page.getByText(message, { exact: true }).waitFor()
  assert.equal(await lookup.getAttribute('aria-busy'), 'false')
  const retry = button('重新加载')
  await heldRequest(page, directory, 'GET', () => retry.click(), async request => {
    assert.equal(new URL(request.url()).searchParams.get('q'), memberLogin)
    assert.ok(await retry.isDisabled())
    assert.equal(await lookup.getAttribute('aria-busy'), 'false')
    assert.equal(await reset.getAttribute('aria-busy'), 'false')
    assert.ok(await topRefresh.isEnabled())
  })
  await memberRow.waitFor()
  assert.equal(await adminRow.count(), 0)
  assert.equal(await page.getByText(message, { exact: true }).count(), 0)
}

export async function verifyConsole(page, origin, adminLogin) {
  const paths = {
    '/': '工作台',
    '/admin/accounts': '管理员',
    '/admin/roles': '角色',
    '/admin/profile': '个人资料',
  }
  const nav = page.getByRole('navigation', { name: '主导航' })
  const button = name => page.getByRole('button', { name, exact: true })
  const heading = name => page.getByRole('heading', { level: 1, name, exact: true })
  for (const [path, title] of Object.entries(paths)) {
    for (const enter of [() => page.goto(origin + path), () => page.reload()]) {
      const document = await enter()
      assert.equal(document.status(), 200, path)
      assert.equal(/<title[^>]*>([^<]+)<\/title>/.exec(await document.text())?.[1], title + ' · 问候示例', path)
      await heading(title).waitFor()
    }
  }
  async function follow(title, group) {
    await page.getByRole('button', { name: /^切换(浅色|深色)模式$/ }).waitFor()
    if (group) {
      const toggle = nav.getByRole('button', { name: group, exact: true })
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    }
    await nav.getByRole('link', { name: title, exact: true }).click()
    await page.waitForFunction(expected => document.title === expected, title + ' · 问候示例')
    await heading(title).waitFor()
  }

  assert.equal(await nav.getByRole('link', {name:'框架与应用',exact:true}).count(), 0)
  await follow('工作台')
  await page.getByRole('main').getByRole('link', { name: '问候示例', exact: true }).waitFor()
  const memberLogin = 'web-reader-' + randomBytes(3).toString('hex')
  const password = randomBytes(20).toString('hex')
  const roleTitle = '目录查看员-' + randomBytes(3).toString('hex')
  await follow('角色', '权限管理')
  await button('新增角色').click()
  const roleEditor = page.getByRole('dialog', { name: '新增角色' })
  await roleEditor.getByLabel('角色名称').fill(roleTitle)
  await roleEditor.getByRole('checkbox', { name: '查看管理员', exact: true }).click()
  const saveRole = roleEditor.getByRole('button', { name: '创建角色' })
  // Modal dialogs hide the underlying controls from the accessibility tree. Only inspect their state.
  const behindDrawer = name => page.getByRole('button', { name, exact: true, includeHidden: true })
  const createdRequest = await heldRequest(page, '/api/admin/roles', 'POST', () => saveRole.click(), async request => {
    assert.equal(request.postDataJSON().id, undefined, '由服务端分配角色标识')
    assert.equal(await saveRole.getAttribute('aria-busy'), 'true')
    assert.equal(await page.locator('button[aria-busy="true"]').count(), 1)
    assert.ok(await behindDrawer('刷新当前页面').isEnabled())
  })
  const created = await createdRequest.response()
  assert.ok(created.ok(), '创建目录只读角色')
  const assignedRoleId = (await created.json()).id
  assert.ok(typeof assignedRoleId === 'string' && assignedRoleId.length > 0)
  await page.getByRole('row').filter({ hasText: roleTitle }).waitFor()

  await button('新增角色').click()
  await roleEditor.getByLabel('角色名称').fill(roleTitle)
  await roleEditor.getByRole('checkbox', { name: '查看管理员', exact: true }).click()
  const [duplicate] = await Promise.all([
    page.waitForResponse(res => new URL(res.url()).pathname === '/api/admin/roles' && res.request().method() === 'POST'),
    saveRole.click(),
  ])
  assert.equal(duplicate.status(), 409)
  await roleEditor.getByText('角色名称已存在', { exact: true }).waitFor()
  assert.equal(await saveRole.getAttribute('aria-busy'), 'false')
  assert.equal(await roleEditor.getByLabel('角色名称').inputValue(), roleTitle)
  await roleEditor.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('dialog', { name: '放弃未保存的修改？' }).getByRole('button', { name: '放弃修改' }).click()
  await roleEditor.waitFor({ state: 'hidden' })

  await follow('管理员', '权限管理')
  await button('新增管理员').click()
  const editor = page.getByRole('dialog', { name: '新增管理员' })
  await editor.getByLabel('登录账号', { exact: true }).fill(memberLogin)
  await editor.getByLabel('名称', { exact: true }).fill('浏览器新增成员')
  await editor.getByLabel('手机号', { exact: true }).fill('13800000001')
  await editor.getByLabel('所属角色', { exact: true }).click()
  await page.getByRole('option', { name: roleTitle, exact: true }).click()
  await editor.getByLabel('密码', { exact: true }).fill(password)
  await editor.getByLabel('确认密码', { exact: true }).fill(password)
  const createAccount = editor.getByRole('button', { name: '创建管理员' })
  await heldRequest(page, '/api/admin/administrators', 'POST', () => createAccount.click(), async req => {
    assert.equal(req.postDataJSON().roleId, assignedRoleId)
    assert.equal(await createAccount.getAttribute('aria-busy'), 'true')
    assert.equal(await behindDrawer('查询').getAttribute('aria-busy'), 'false')
    assert.equal(await behindDrawer('重置').getAttribute('aria-busy'), 'false')
  })
  const memberRow = page.getByRole('row').filter({ hasText: memberLogin })
  await memberRow.getByText(roleTitle, { exact: true }).waitFor()

  await verifyAccountFilters(page, memberLogin, adminLogin)
  await memberRow.getByRole('button', { name: '编辑' }).click()
  const edit = page.getByRole('dialog', { name: '编辑管理员' })
  await edit.getByLabel('名称', { exact: true }).fill('编辑后的成员')
  await edit.getByRole('button', { name: '保存修改' }).click()
  await memberRow.getByText('编辑后的成员', { exact: true }).waitFor()

  await button('重置').click()
  const ownRow = page.getByRole('row').filter({ hasText: adminLogin })
  await ownRow.getByText('本人', { exact: true }).waitFor()
  const selfEdit = ownRow.getByRole('button', { name: '编辑', exact: true })
  await selfEdit.click()
  assert.ok(await edit.getByLabel('登录账号', { exact: true }).isDisabled())
  assert.ok(await edit.getByLabel('所属角色', { exact: true }).isDisabled())
  assert.ok(await edit.getByRole('switch', { name: '启用管理员' }).isDisabled())
  await edit.getByLabel('名称', { exact: true }).fill('本人行改名')
  const saveOwn = edit.getByRole('button', { name: '保存修改' })
  await heldRequest(page, '/api/me', 'PATCH', () => saveOwn.click(), async req => {
    assert.deepEqual(req.postDataJSON(), { displayName: '本人行改名' })
    assert.equal(await saveOwn.getAttribute('aria-busy'), 'true')
    assert.equal(await behindDrawer('查询').getAttribute('aria-busy'), 'false')
    assert.ok(await behindDrawer('刷新当前页面').isEnabled())
  })
  await ownRow.getByText('本人行改名', { exact: true }).waitFor()
  await page.getByRole('button', { name: '本人行改名用户菜单' }).waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(el => el.textContent.trim() === '新增管理员')?.disabled)
  await ownRow.getByRole('link', { name: '修改密码', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/admin/profile' && url.hash === '#password')
  await page.waitForFunction(() => document.activeElement?.id === 'core-current-password')
  await heading('个人资料').waitFor()
  await page.getByLabel('昵称').fill('后台验收管理员')
  const save = button('保存资料'), changePassword = button('修改密码'), topRefresh = button('刷新当前页面')
  await page.getByLabel('当前密码').fill('incorrect-current-password')
  await page.getByLabel(/^新密码/).fill(password)
  await page.getByLabel('确认新密码').fill(password)
  await heldRequest(page, '/api/me/password', 'PUT', () => changePassword.click(), async () => {
    assert.equal(await changePassword.getAttribute('aria-busy'), 'true')
    assert.equal(await save.getAttribute('aria-busy'), 'false')
    assert.ok(await topRefresh.isEnabled())
  })
  await page.getByText('当前密码不正确', { exact: true }).waitFor()
  assert.equal(await changePassword.getAttribute('aria-busy'), 'false')
  assert.ok(await save.isEnabled(), '改密失败后可以继续保存昵称')
  await heldRequest(page, '/api/me', 'PATCH', () => save.click(), async () => {
    assert.equal(await save.getAttribute('aria-busy'), 'true')
    assert.ok(await topRefresh.isEnabled())
    assert.notEqual(await button('修改密码').getAttribute('aria-busy'), 'true')
  })
  await page.getByRole('button', { name: '后台验收管理员用户菜单' }).waitFor()
  await page.reload()
  assert.equal(await page.getByLabel('昵称').inputValue(), '后台验收管理员')

  const member = await page.context().browser().newContext({ baseURL: origin, viewport: { width: 390, height: 844 } })
  try {
    const signIn = await member.request.post('/api/auth/login', { data: { login: memberLogin, password } })
    assert.equal(signIn.status(), 200)
    const readPage = await member.newPage()
    const response = await readPage.goto('/admin/accounts')
    assert.equal(response.status(), 200)
    const own = readPage.getByRole('row').filter({ hasText: memberLogin })
    const other = readPage.getByRole('row').filter({ hasText: adminLogin })
    await own.waitFor()
    await other.waitFor()
    assert.equal(await readPage.getByRole('button', { name: '新增管理员' }).count(), 0)
    await own.getByRole('button', { name: '编辑', exact: true }).waitFor()
    assert.equal(await own.getByRole('link', { name: '修改密码', exact: true }).getAttribute('href'), '/admin/profile#password')
    for (const action of ['编辑', '重置密码', '移除']) {
      assert.equal(await other.getByRole('button', { name: action, exact: true }).count(), 0)
    }
    const forbidden = await member.request.post('/api/admin/administrators', { data: {
      username: 'denied-' + randomBytes(3).toString('hex'), nickname: '只读权限验证', phone: '', password,
      roleId: assignedRoleId, enabled: true, allowMultipleSessions: true, requestId: randomUUID(),
    } })
    assert.equal(forbidden.status(), 403)
    assert.ok(await readPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal((await member.request.get('/admin/roles')).status(), 403)
  } finally {
    await member.close()
  }
}
