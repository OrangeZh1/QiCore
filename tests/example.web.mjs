import assert from 'node:assert/strict'
import {verifyCustomerContent} from './customer-content.browser.mjs'
import {verifyConsole} from './console.browser.mjs'
import {verifyPublicH5} from './h5-public.browser.mjs'
import {randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {readFile,mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

if(new URL(process.env.DATABASE_URL).pathname!=='/qc_fixture_web'||!process.env.INSTALLER_TEST_ROOT)throw Error('独立 MySQL 验收库必需')
const requireQa=createRequire(process.env.QA_PLAYWRIGHT_PACKAGE||import.meta.url)
const {chromium}=requireQa('playwright')
const scratch=join(process.env.INSTALLER_TEST_ROOT,'example-ssr')
await mkdir(scratch,{recursive:true,mode:0o700})
async function freePort(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const n=socket.address().port;await new Promise(r=>socket.close(r));return n}
const apiPort=await freePort();let webPort=await freePort();while(apiPort===webPort)webPort=await freePort()
const origin='http://127.0.0.1:'+webPort
const env={...process.env,PUBLIC_ORIGIN:origin,API_PORT:String(apiPort),NITRO_PORT:String(webPort),NITRO_HOST:'127.0.0.1',
  NUXT_API_ORIGIN:'http://127.0.0.1:'+apiPort,INSTANCE_ROOT:scratch,QICORE_SESSION_COOKIE:'qc_qa_example',APPLICATION_ENTRY:resolve('examples/hello/application.mjs')}
const children=[]
let diagnostic='',browser
function start(entry){
  const child=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']})
  children.push(child)
  const capture=bytes=>{diagnostic=(diagnostic+bytes).slice(-1500)}
  child.stdout.on('data',capture);child.stderr.on('data',capture)
}
try{
  start('src/main.mjs');start('web/.output/server/index.mjs')
  const until=Date.now()+40000
  while(true){
    try{const r=await fetch(origin+'/api/install/status');if(r.ok && (await r.json()).installed===false)break}catch{}
    if(children.some(c=>c.exitCode!==null)||Date.now()>until)throw Error('隔离端口未就绪 '+diagnostic)
    await delay(200)
  }
  const first=await fetch(origin+'/',{redirect:'manual'})
  assert.equal(new URL(first.headers.get('location'),origin).pathname,'/install')
  assert.match(await (await fetch(origin+'/install')).text(),/<title>安装向导 · 问候示例<\/title>/)
  const login='demo-qa',password=randomBytes(24).toString('hex')
  browser=await chromium.launch({headless:process.env.QA_HEADED!=='1',channel:'chromium',...(process.env.QA_CHROMIUM?{executablePath:process.env.QA_CHROMIUM}:{})})
  const context=await browser.newContext()
  const page=await context.newPage()
  const token=JSON.parse(await readFile(join(scratch,'install-token.json'),'utf8'))
  await page.goto(origin+'/install#token='+encodeURIComponent(token))
  await page.waitForFunction(()=>location.hash==='')
  assert.equal(await page.getByLabel('安装凭据').inputValue(),token)
  await page.getByLabel('MySQL 连接地址').fill(env.DATABASE_URL)
  await page.getByLabel('管理员账号').fill(login)
  await page.getByLabel('管理员密码').fill(password)
  const [installed]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/install/complete'&&response.request().method()==='POST'),
    page.getByRole('button',{name:'完成安装'}).click(),
  ])
  assert.equal(installed.status(),200)
  await page.waitForURL(origin+'/login')
  const auth=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login,password})})
  assert.equal(auth.status,200)
  const session=auth.headers.getSetCookie()[0].split(';')[0],headers={cookie:session}
  assert.ok(session.startsWith(env.QICORE_SESSION_COOKIE+'='))
  const otherCookie='qc_session='+session.slice(session.indexOf('=')+1)
  assert.equal((await fetch(origin+'/api/me',{headers:{cookie:otherCookie}})).status,401)
  const html=await (await fetch(origin+'/apps/hello',{headers})).text()
  assert.match(html,/<title>问候示例 · 问候示例<\/title>/)
  assert.ok(html.includes('你好，'+login))
  const denied=await fetch(origin+'/api/apps/hello/hello')
  assert.equal(denied.status,401)
  const loginHtml=await (await fetch(origin+'/login')).text()
  assert.match(loginHtml,/<title>管理员登录 · QiCore<\/title>/)
  await page.goto(origin+'/login')
  await page.getByRole('textbox',{name:/账号/}).fill(login)
  await page.getByLabel(/^密码(?:\s*[*＊])?$/).fill(password)
  const toggle=page.getByRole('button',{name:'显示密码'})
  await toggle.click()
  await page.getByRole('button',{name:'隐藏密码'}).click()
  let release,started
  const pending=new Promise(ok=>{started=ok}),gate=new Promise(ok=>{release=ok})
  await page.route('**/api/auth/login',async req=>{started();await gate;await req.continue()})
  const submit=page.getByRole('button',{name:'登录后台'})
  await submit.click()
  await Promise.race([pending,delay(10000,null,{ref:false}).then(()=>{throw Error('登录表单未发出请求')})])
  try{
    assert.equal(await submit.getAttribute('aria-busy'),'true')
    assert.ok(await toggle.isDisabled())
    assert.equal(await page.locator('[aria-busy=true]').count(),1)
  }finally{release()}
  await page.waitForFunction(()=>document.title==='工作台 · 问候示例')
  assert.ok((await context.cookies()).some(cookie=>cookie.name===env.QICORE_SESSION_COOKIE))
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'问候示例'}).click()
  await page.waitForFunction(()=>document.title==='问候示例 · 问候示例')
  assert.ok(await page.getByText('你好，'+login).isVisible())
  await page.reload()
  assert.equal(await page.title(),'问候示例 · 问候示例')
  await verifyConsole(page,origin,login)
  await verifyCustomerContent(page,origin)
  await verifyPublicH5(page,origin)
  console.log('PASS 框架与应用、账号、角色和个人资料联动，后台 SSR 标题、独立加载与移动端只读权限')
  console.log('PASS 示例独立页面、SSR 首屏与用户身份、真实登录、独立 loading、会话名称隔离、刷新及应用内导航')
}finally{
  await browser?.close()
  await Promise.all(children.map(async child=>{
    if(child.exitCode!==null||child.signalCode)return
    const done=once(child,'exit');child.kill('SIGTERM')
    const timer=setTimeout(()=>child.kill('SIGKILL'),8000);timer.unref()
    try{await done}finally{clearTimeout(timer)}
  }))
}
