import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function verifyCustomerContent(page, origin) {
  if (new URL(process.env.DATABASE_URL).pathname !== '/qc_fixture_web') throw Error('内容浏览器回归需要独立验收实例')
  const originalViewport = page.viewportSize()
  const unique = randomUUID().slice(0, 8)
  const categoryName = '知识分类-' + unique
  const articleName = '使用指引-' + unique
  const publicGet = async path => {
    const response = await page.context().request.get(origin + '/api/public/' + path)
    assert.equal(response.status(), 200)
    return response.json()
  }
  const button = (name, root = page) => root.getByRole('button', { name, exact: true })
  const save = async (action, urlPart) => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes(urlPart) && r.request().method() === 'PUT'), action.click(),
    ])
    assert.equal(response.status(), 200)
    return response.json()
  }
  const go = async (path, title) => {
    const response = await page.goto(origin + path)
    assert.equal(response.status(), 200)
    assert.ok((await response.text()).includes('<title>' + title + ' · '), '首屏标题 ' + title)
    await page.getByRole('button', { name: /切换(深|浅)色模式/ }).waitFor()
  }

  await go('/admin/help', '帮助中心')
  await page.getByRole('tab', { name: '帮助分类' }).click()
  await button('新建分类').click()
  const dialog = page.getByRole('dialog', { name: '新建帮助分类' })
  await dialog.getByLabel('分类名称').fill(categoryName)
  await save(button('保存', dialog), '/api/admin/help/categories/')
  await page.getByRole('row').filter({ hasText: categoryName }).waitFor()
  await page.getByRole('tab', { name: '帮助文章' }).click()
  await page.getByRole('link', { name: '新建文章' }).click()
  await page.getByLabel('文章标题').fill(articleName)
  await page.getByRole('combobox', { name: '所属分类' }).click()
  await page.getByRole('option', { name: categoryName }).click()
  await page.getByRole('textbox', { name: '帮助正文' }).click()
  await page.keyboard.insertText('从工作台打开帮助中心。')
  const article = await save(button('保存'), '/api/admin/help/articles/')
  await page.waitForURL(url => url.pathname === '/admin/help')
  assert.equal((await publicGet('help/' + article.id)).title, articleName)

  const pending = Promise.withResolvers(), release = Promise.withResolvers()
  const match = '**/api/admin/help?**'
  const holdSearch = async route => {
    pending.resolve()
    await release.promise
    await route.continue()
  }
  await page.route(match, holdSearch)
  try {
    await page.getByRole('textbox', { name: '搜索标题或正文' }).fill(articleName)
    await button('查询').click()
    await pending.promise
    assert.ok(await button('查询').isDisabled())
    assert.ok(await button('重置').isEnabled())
    assert.ok(await button('刷新当前页面').isEnabled())
  } finally {
    release.resolve()
    await page.unroute(match, holdSearch)
  }
  await page.getByRole('row').filter({ hasText: articleName }).waitFor()

  await go('/admin/policies', '协议管理')
  await page.getByRole('row').filter({ hasText: '隐私政策' }).getByRole('link', { name: '设置' }).click()
  await page.getByLabel('协议标题').fill('隐私政策-' + unique)
  await page.getByRole('textbox', { name: '协议正文' }).click()
  await page.keyboard.insertText('我们仅处理提供本项服务所需的信息。')
  const policy = await save(button('保存'), '/api/admin/policies/privacy')
  await page.waitForURL(url => url.pathname === '/admin/policies')
  assert.ok((await publicGet('policies/privacy?version=' + policy.version)).contentHtml.includes('本项服务'))

  await go('/admin/customer-service', '客服设置')
  await page.getByLabel('客服说明').fill('工作日服务-' + unique)
  await save(button('保存设置'), '/api/admin/customer-service')
  assert.equal((await publicGet('customer-service')).description, '工作日服务-' + unique)

  await page.setViewportSize({ width: 390, height: 844 })
  await go('/admin/help?tab=categories', '帮助中心')
  await button('新建分类').click()
  const bounds = await page.getByRole('dialog').boundingBox()
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, '移动端帮助分类抽屉')
  await button('取消', page.getByRole('dialog')).click()
  if (originalViewport) await page.setViewportSize(originalViewport)
  console.log('PASS 企业内容后台帮助分类/文章、富文本协议、客服设置、真实公开读取及移动抽屉')
}
