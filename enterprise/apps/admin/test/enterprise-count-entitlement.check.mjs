import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'

/** The caller owns and discards the isolated API, database and browser context after this check. */
export async function verifyCountEntitlementWrites(page, origin, {disposable}) {
  const url=new URL(origin)
  if(disposable!==true||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('次数权益写入验收需要独立的一次性实例')
  const ctx=page.context()
  const portal={'X-Console-Portal':'tenant'}
  const me=await ctx.request.get(origin+'/api/v1/admin/auth/me',{headers:portal})
  assert.equal(me.status(),200)
  const session=(await me.json()).data
  const root='/api/v1/admin/tenants/'+encodeURIComponent(session.tenantId||session.tenantIds[0])
  const seed=randomUUID().replaceAll('-','').slice(0,12),userId='qa'+seed,packageName='服务次数验收'+seed
  const user=await ctx.request.post(origin+root+'/consumers',{headers:{...portal,origin:url.origin,'X-CSRF-Token':session.csrfToken},data:{applicationKey:'system',userId,nickname:'次数验收'+seed,avatar:null,phone:'',email:'',gender:'unknown',enabled:true}})
  assert.equal(user.status(),200,'创建独立验收用户')
  const btn=(host,name)=>host.getByRole('button',{name,exact:true})
  async function go(path){const response=await page.goto(origin+path,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);await page.getByRole('button',{name:/切换(深|浅)色模式/}).waitFor()}
  async function commit(button,end) {
    const [resp]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===root+end&&r.request().method()==='POST'),button.click()])
    assert.equal(resp.status(),200,'保存 '+end)
    return (await resp.json()).data
  }
  await go('/admin/packages')
  await btn(page,'新建套餐').click()
  const editor=page.getByRole('dialog',{name:'新建套餐',exact:true})
  await editor.getByLabel('套餐名称').fill(packageName)
  await editor.locator('#package-price').fill('1.00')
  await editor.locator('#package-count').fill('3')
  await commit(btn(editor,'保存'),'/packages/system')
  await editor.waitFor({state:'hidden'})

  await go('/admin/entitlements')
  await btn(page,'发放权益').click()
  const grant=page.getByRole('dialog',{name:'发放权益'})
  await grant.getByRole('textbox',{name:'用户账号'}).fill(userId)
  await grant.getByRole('textbox',{name:'搜索可发放套餐'}).fill(packageName)
  const listed=page.waitForResponse(r=>new URL(r.url()).pathname===root+'/packages'&&new URL(r.url()).searchParams.get('q')===packageName)
  await btn(grant,'查询').click();assert.equal((await listed).status(),200)
  await grant.getByRole('combobox',{name:'可发放套餐'}).click()
  await page.getByRole('option',{name:packageName,exact:true}).click()
  await grant.getByRole('textbox',{name:'操作原因'}).fill('一次性验收发放')
  const receipt=await commit(btn(grant,'确认发放'),'/entitlements/system/grant')
  assert.equal(receipt.remaining,3)
  await grant.waitFor({state:'hidden'})

  const holding=page.getByRole('row').filter({hasText:packageName})
  await btn(holding,'核销').click()
  const redeem=page.getByRole('dialog',{name:'核销权益'})
  await redeem.locator('#redeem-count').fill('1')
  await redeem.getByRole('textbox',{name:'操作原因'}).fill('一次性验收核销')
  const used=await commit(btn(redeem,'确认核销'),'/entitlements/system/'+receipt.holdingId+'/redeem')
  assert.equal(used.remaining,2)
  await redeem.waitFor({state:'hidden'})
  await btn(holding,'查看详情').click()
  const info=page.getByRole('dialog',{name:'权益详情'})
  await info.getByText('累计核销',{exact:true}).waitFor()
  await info.getByText('2 次',{exact:true}).first().waitFor()
  await go('/admin/entitlement-ledger')
  const search=page.getByRole('textbox',{name:/搜索账号/})
  await search.fill(userId)
  const searched=page.waitForResponse(r=>new URL(r.url()).pathname===root+'/entitlement-ledger'&&new URL(r.url()).searchParams.get('q')===userId)
  await btn(page,'查询').click();assert.equal((await searched).status(),200)
  const lines=page.getByRole('row').filter({hasText:packageName})
  await lines.first().waitFor();assert.equal(await lines.count(),2,'发放与核销应各有一条流水')
  const api=await ctx.request.get(origin+root+'/entitlement-ledger?applicationKey=system&q='+encodeURIComponent(userId),{headers:portal})
  assert.equal(api.status(),200)
  const entries=(await api.json()).data.items
  assert.deepEqual(new Set(entries.map(row=>row.type)),new Set(['grant','redeem']))
  console.log('PASS 企业原页配置服务次数、发放、核销与权益流水')
}


if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const {QA_ORIGIN,QA_ADMIN_LOGIN,QA_ADMIN_PASSWORD,QA_PLAYWRIGHT_PACKAGE,QA_CHROMIUM,QA_HEADED,QA_BROWSER_CHANNEL}=process.env
  if(!process.argv.includes('--disposable')||!QA_ORIGIN||!QA_ADMIN_LOGIN||!QA_ADMIN_PASSWORD)throw Error('请使用 --disposable 并提供一次性数据库的隔离验收地址与管理员')
  const origin=new URL(QA_ORIGIN)
  if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw Error('仅支持执行端 loopback')
  const {chromium}=createRequire(QA_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
  const browser=await chromium.launch({headless:QA_HEADED!=='1',channel:QA_BROWSER_CHANNEL||'chromium',executablePath:QA_CHROMIUM})
  try{
    const context=await browser.newContext({baseURL:origin.origin,viewport:{width:1440,height:1000}})
    const response=await context.request.post('/api/v1/admin/auth/login',{headers:{origin:origin.origin,'X-Console-Portal':'tenant'},data:{username:QA_ADMIN_LOGIN,password:QA_ADMIN_PASSWORD,portal:'tenant'}})
    assert.equal(response.status(),200,'一次性实例管理员登录')
    await verifyCountEntitlementWrites(await context.newPage(),origin.origin,{disposable:true})
  }finally{await browser.close()}
}
