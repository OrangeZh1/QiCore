import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function verifyPublicH5(adminPage, origin) {
  if (new URL(process.env.DATABASE_URL).pathname !== '/qc_fixture_web') throw Error('H5 验收需要隔离数据库')
  const admin = adminPage.context().request
  const put = async (route, data) => {
    const response = await admin.put(origin + '/api/admin/' + route, { data })
    assert.equal(response.status(), 200, route)
    return response.json()
  }
  const salt = randomUUID().slice(0, 8)
  const category = randomUUID(), article = randomUUID(), hidden = randomUUID()
  const metadata = { enabled: true, version: 0, sort: 999999 }
  const title = '服务指引-' + salt, categoryName = '公开帮助-' + salt
  await put('help/categories/' + category, { ...metadata, name: categoryName })
  await put('help/articles/' + article, { ...metadata, title, categoryId: category, content: '<p>请查看服务详情。</p>' })
  await put('help/articles/' + hidden, { ...metadata, enabled: false, title: '隐藏-' + salt, categoryId: category, content: '未发布' })
  const initial = await (await admin.get(origin + '/api/admin/policies?kind=terms')).json()
  const first = await put('policies/terms', { version: initial.version, title: '旧协议-' + salt, content: '第一版正文' })
  await put('policies/terms', { version: first.version, title: '新协议-' + salt, content: '第二版正文' })
  const contact = await (await admin.get(origin + '/api/admin/customer-service')).json()
  await put('customer-service', { version: contact.version, config: { ...contact.config, phone: '4001234567', description: '工作日接待' } })

  const guest = await adminPage.context().browser().newContext({ baseURL: origin, viewport: { width: 390, height: 844 } })
  try {
    const page = await guest.newPage()
    const brand = (await (await guest.request.get('/api/public/site-brand')).json()).name
    async function enter(path, pageTitle) {
      const doc = await page.goto(path)
      assert.equal(doc.status(), 200, path)
      assert.ok((await doc.text()).includes('<title>' + pageTitle + ' · ' + brand + '</title>'), path)
      assert.equal(await page.title(), pageTitle + ' · ' + brand)
    }
    assert.equal((await guest.request.get('/api/me')).status(), 401)
    await enter('/h5', '服务中心')
    await page.getByRole('link', { name: '帮助中心' }).click()
    await page.getByRole('button', { name: categoryName, exact: true }).click()
    const question = page.getByRole('button', { name: title })
    await question.click()
    await page.getByText('请查看服务详情。', { exact: true }).waitFor()
    await page.getByRole('link', { name: '查看详情' }).click()
    await page.waitForFunction(text => document.title === text, title + ' · ' + brand)
    assert.ok((await (await page.reload()).text()).includes('<title>' + title + ' · ' + brand + '</title>'))
    assert.equal((await guest.request.get('/h5/help/detail?id=' + hidden)).status(), 404)
    await enter('/h5/policy?kind=terms&termsVersion=' + first.version, '用户协议')
    await page.getByText('第一版正文', { exact: true }).waitFor()
    await enter('/h5/policy?kind=terms', '用户协议')
    await page.getByText('第二版正文', { exact: true }).waitFor()
    await enter('/h5/contact', '联系客服')
    assert.equal(await page.getByRole('link', { name: '拨打客服电话' }).getAttribute('href'), 'tel:4001234567')
    await page.getByText('工作日接待', { exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    console.log('PASS 匿名 H5 公共服务入口、已发布帮助/隐藏隔离、协议版本、真实联系方式及移动标题')
  } finally {
    await guest.close()
  }
}
