import assert from 'node:assert/strict'

// All navigation is read-only. Controls which would publish, send or pay are inspected without submitting.
const field = (role, name) => ({ role, name })
const text = name => ({ text: name })
const modules = [
  ['users', '用户列表', [field('combobox','筛选会员等级'), field('combobox','筛选会员标签'), field('button','新建用户')]],
  ['member-levels', '会员等级', [field('button',/新增等级|新建等级/),field('button','成长规则')]],
  ['member-tags', '会员标签', [field('button',/新增标签|新建标签/),field('button','查询')]],
  ['payments', '支付方式', [text('允许使用'),field('button','保存设置')]],
  ['payments/wechat?tab=ordinary','微信支付',[field('tab','普通支付'),field('tab','虚拟支付'),text(/接口版本|普通微信支付/)]],
  ['payments/alipay','支付宝',[text(/应用私钥|应用 ID|AppID|支付宝公钥/),field('button','配置自检')]],
  ['payments/wechat?tab=virtual','微信支付',[field('tab','虚拟支付'),text(/支付环境|消息推送/)]],
  ['payments/wechat?tab=goods','微信支付',[field('tab','商品管理'),text(/微信虚拟商品|暂无虚拟商品/)]],
  ['payments/wechat?tab=orders','微信支付',[field('tab','虚拟支付订单'),field('combobox','支付状态')]],
  ['after-sales','订单管理',[field('combobox','售后状态'),field('button','查询')]],
  ['recharge-orders','充值订单',[field('combobox','订单状态'),field('button','查询')]],
  ['transactions','交易流水',[field('combobox','记录类型'),field('combobox','支付方式')]],
  ['points-ledger','积分流水',[field('combobox','记录类型'),field('button','查询')]],
  ['packages','套餐管理',[field('combobox','套餐类型'),field('combobox','套餐状态'),field('button',/新增套餐|新建套餐/)]],
  ['entitlements','权益管理',[field('combobox','记录状态'),field('button','发放权益')]],
  ['entitlement-ledger','权益流水',[field('combobox','记录类型'),field('button','查询')]],
  ['recharge','充值配置',[text('积分套餐'),text('余额充值')]],
  ['sms','短信配置',[field('button','设置'),text(/阿里云|腾讯云/)]],
  ['subscriptions','订阅消息',[text(/请先配置微信小程序|通知场景|通知设置|订阅消息设置|模板/)]],
  ['notifications','通知设置',[text(/通知名称|通知场景|通知模板|消息通知/),field('button',/设置|编辑/)]],
  ['message-records','发送记录',[field('button',/刷新记录|查询/),text(/暂无发送记录|接收对象/)]],
  ['mini-program','微信小程序',[text(/小程序基础信息|小程序配置/),text(/主体类型|开发者配置/)]],
  ['official-account','微信公众号',[text(/公众号认证|公众号基础信息|配置公众号/),field('button',/配置公众号|配置微信公众号|前往配置/)]],
  ['h5','H5端',[field('textbox','渠道名称'),field('textbox','绑定域名')]],
  ['decoration','页面装修',[text('当前装修'),text('当前页面'),text('客户端预览')]],
  ['decoration-login','登录页设置',[text(/登录标题|登录页标题|登录页背景|登录文案|页面预览|登录品牌|预览效果/)]],
  ['decoration-theme','主题风格',[text(/主题色|主题颜色|预设主题/),field('button','保存')]],
  ['decoration-navigation','底部导航',[text(/首页|个人中心/),field('button','保存')]],
  ['page-routes','页面路径',[field('textbox','搜索页面路径'),field('combobox','页面分类')]],
  ['decoration-templates','模板库',[field('textbox','搜索模板'),field('tablist','模板来源'),field('tab','系统模板'),field('tab','我的模板')]],
  ['system-logs','系统日志',[field('combobox','操作类型'),field('button','查询')]],
  ['environment','系统环境',[text('运行信息'),text('依赖检测')]],
  ['scheduled-tasks','定时任务',[field('link','新增'),text(/时长单位为秒/)]],
  ['scheduled-tasks/new','新增定时任务',[field('textbox',/名称/),field('button','保存')]],
  ['system-cache','系统缓存',[text('管理内容'),text('内容说明')]],
  ['data-security','数据安全',[text('备份加密保存'),field('button','新建备份')]],
]

export async function verifyEnterpriseModuleScreens(page, origin, onResult = () => {}) {
  const results=[]
  for (const [path,title,checks] of modules) {
    const expected=new URL('/admin/'+path,origin)
    let status
    try {
      const response=await page.goto(expected.href,{waitUntil:'domcontentloaded'})
      status=response.status()
      assert.equal(status,200)
      const pathNow=new URL(page.url())
      assert.equal(pathNow.pathname,expected.pathname,'页面错误重定向')
      for (const [key,value] of expected.searchParams) assert.equal(pathNow.searchParams.get(key),value)
      const stage=page.locator('.qisvc-console-stage')
      await stage.getByRole('heading',{name:title,exact:true}).first().waitFor({timeout:7000})
      assert.match(await response.text(),new RegExp('<title[^>]*>'+title+' · '),'初次 HTML 标题')
      const nav=page.locator('.qisvc-console-sidebar-nav')
      const active=nav.locator('a[data-active="true"]')
      assert.equal(await active.count(),1,'原企业侧栏须有唯一匹配入口 '+path)
      const matched=new URL(await active.getAttribute('href'),origin)
      assert.equal(matched.pathname,path==='scheduled-tasks/new'?'/admin/scheduled-tasks':expected.pathname,'页面所属菜单与当前地址')
      if(expected.pathname==='/admin/payments/wechat'){
        assert.equal(matched.searchParams.get('tab'),expected.searchParams.get('tab')==='ordinary'?'ordinary':'virtual','支付页签对应的选中菜单')
      }
      for (const check of checks) {
        const locator=check.text?stage.getByText(check.text,{exact:typeof check.text==='string'}):stage.getByRole(check.role,{name:check.name,exact:typeof check.name==='string'})
        await locator.filter({visible:true}).first().waitFor({timeout:4500})
      }
      if(path==='entitlements'){
        await page.getByRole('button',{name:/切换(深|浅)色模式/}).waitFor({timeout:12000})
        await stage.getByRole('button',{name:'发放权益',exact:true}).click()
        const dialog=page.getByRole('dialog',{name:'发放权益'})
        for(const name of ['用户账号','操作原因']) await dialog.getByRole('textbox',{name}).waitFor()
        await dialog.getByRole('combobox',{name:'可发放套餐'}).waitFor()
        await dialog.getByRole('button',{name:'关闭',exact:true}).last().click()
        await dialog.waitFor({state:'hidden'})
      }
      const fatal=await stage.getByText(/接口不存在|没有访问权限|无法读取当前企业|服务暂不可用，请重试|列表加载失败|任务信息读取失败|任务列表读取失败/).filter({visible:true}).count()
      assert.equal(fatal,0,'出现接口错误或越权提示')
      if(expected.searchParams.has('tab')){
        const selected=await stage.locator('[role=tab][aria-selected=true]').allTextContents()
        const tab={ordinary:'普通支付',virtual:'虚拟支付',goods:'商品管理',orders:'虚拟支付订单'}[expected.searchParams.get('tab')]
        assert.ok(selected.some(x=>x.trim()===tab),'选中的配置页签 '+tab)
      }
      const icons=page.locator('.iconify')
      const missing=await icons.evaluateAll(nodes=>[...new Set(nodes.filter(node=>{
        const bounds=node.getBoundingClientRect(),style=getComputedStyle(node)
        return bounds.width>0 && bounds.height>0 && !node.closest('[inert]') && style.visibility!=='hidden' && style.maskImage==='none' && style.backgroundImage==='none' && !node.matches('svg') && !node.querySelector('svg')
      }).map(node=>node.getAttribute('class')?.split(' ').find(name=>name.startsWith('i-'))))])
      assert.deepEqual(missing,[],'页面图标缺失 '+path)
      results.push({path,title,status,controls:checks.length,passed:true})
    } catch(cause) {
      results.push({path,title,status,passed:false,error:String(cause.message).split('\n').slice(0,4).join(' ')})
    }
    await onResult(results.at(-1))
  }
  return results
}
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {writeFile} from 'node:fs/promises'

async function run() {
  const {QA_ORIGIN,QA_ADMIN_LOGIN,QA_ADMIN_PASSWORD,QA_PLAYWRIGHT_PACKAGE,QA_CHROMIUM,QA_HEADED,QA_BROWSER_CHANNEL,QA_RESULT_PATH}=process.env
  if(!QA_ORIGIN||!QA_ADMIN_LOGIN||!QA_ADMIN_PASSWORD)throw Error('需设置隔离验收地址与管理员')
  const origin=new URL(QA_ORIGIN)
  if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw Error('企业页面验收只连接本机回环地址')
  const {chromium}=createRequire(QA_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
  const browser=await chromium.launch({headless:QA_HEADED!=='1',channel:QA_BROWSER_CHANNEL||'chromium',executablePath:QA_CHROMIUM})
  try{
    const context=await browser.newContext({baseURL:origin.origin,viewport:{width:1440,height:1000}})
    const auth=await context.request.post('/api/v1/admin/auth/login',{headers:{origin:origin.origin,'X-Console-Portal':'tenant'},data:{username:QA_ADMIN_LOGIN,password:QA_ADMIN_PASSWORD,portal:'tenant'}})
    assert.equal(auth.status(),200,'隔离企业管理员登录')
    const page=await context.newPage(),errors=[]
    page.on('pageerror',e=>errors.push({path:new URL(page.url()).pathname,message:e.message.slice(0,180)}))
    const rows=await verifyEnterpriseModuleScreens(page,origin.origin,row=>console.log(row.passed?'PASS':'FAIL',row.path,row.error||''))
    if(QA_RESULT_PATH)await writeFile(QA_RESULT_PATH,JSON.stringify({rows,errors},null,2))
    assert.deepEqual(rows.filter(row=>!row.passed),[],'企业后台页面检查')
    assert.deepEqual(errors,[],'企业后台浏览器错误')
  }finally{await browser.close()}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await run()
