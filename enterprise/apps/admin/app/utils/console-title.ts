export function consoleTitle(path:string,platformName:string,tenantName:string){
  const route=(path.split('?')[0]||'/').replace(/\/+$/,'')||'/'
  if(route==='/admin/login')return '后台登录 · '+tenantName
  if(route.startsWith('/admin/scheduled-tasks/'))return (route.endsWith('/new')?'新增定时任务':'编辑定时任务')+' · '+tenantName
  const payment=/^\/admin\/payments\/(wechat|alipay|wechat-virtual)$/.exec(route)
  if(payment)return (payment[1]==='alipay'?'支付宝':'微信支付')+' · '+tenantName
  const tenantPages:Record<string,string>={updates:'整包更新','system-logs':'系统日志',environment:'系统环境','scheduled-tasks':'定时任务','system-cache':'系统缓存','data-security':'数据安全',profile:'个人资料',workbench:'工作台',recharge:'充值配置','recharge-orders':'充值订单',administrators:'管理员',roles:'角色',channels:'渠道管理',h5:'H5端','member-levels':'会员等级','member-tags':'会员标签','help':'帮助中心','help-editor':'帮助文章编辑','decoration-login':'登录页设置','decoration-theme':'主题风格','decoration-navigation':'底部导航','page-routes':'页面路径','decoration-templates':'模板库','policy-editor':'协议编辑','decoration-editor':'装修编辑器',decoration:'页面装修','customer-service':'客服设置','user-settings':'用户设置','user-registration':'用户注册','points-ledger':'积分流水','after-sales':'订单管理',subscriptions:'订阅消息',notifications:'通知设置','message-records':'发送记录',sms:'短信配置',site:'站点设置',storage:'存储设置','mini-program':'微信小程序','official-account':'微信公众号',policies:'协议管理',payments:'支付方式',entitlements:'权益管理','entitlement-ledger':'权益流水',transactions:'交易流水',users:'用户列表',packages:'套餐管理',materials:'素材管理',applications:'工作台'}
  const slug=route.replace(/^\/admin\/?/,'')
  return route==='/admin'||route.startsWith('/admin/') ? (tenantPages[slug]||'工作台')+' · '+tenantName : platformName
}
