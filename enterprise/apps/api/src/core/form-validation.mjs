// Presentation only: schemas retain their constraints, transforms and error codes.
// Never include input values, credentials, unknown object keys or raw Zod errors.
export const formFieldLabels={
 username:'登录账号',account:'账号',userId:'用户账号',nickname:'名称',password:'密码',oldPassword:'原密码',phone:'手机号',email:'邮箱',gender:'性别',avatar:'头像',name:'名称',roleId:'所属角色',permissions:'权限',enabled:'启用状态',allowMultipleSessions:'多处登录',
 q:'搜索内容',status:'状态',page:'页码',pageSize:'每页条数',version:'记录版本',accountVersion:'账号版本',settingsVersion:'配置版本',requestId:'请求编号',operationId:'操作编号',tenantId:'站点标识',applicationKey:'应用标识',levelId:'会员等级',tagId:'会员标签',users:'用户列表',confirm:'确认内容',
 command:'任务命令',params:'命令参数',rule:'执行规则',remark:'备注',config:'配置',platform:'平台',tenant:'租户',logo:'Logo',favicon:'网站图标',loginImage:'登录页图片',defaultAvatar:'默认头像',loginTitle:'登录标题',loginDescription:'登录说明',copyright:'版权信息',filing:'备案信息',icpNumber:'ICP备案号',icpLink:'ICP备案链接',policeNumber:'公安备案号',policeLink:'公安备案链接',
 displayName:'显示名称',originalId:'原始ID',appId:'AppID',appSecret:'AppSecret',versionDescription:'版本说明',qrMaterialId:'二维码图片',uploadPrivateKey:'上传私钥',clearSecret:'清除密钥',clearSecrets:'清除密钥',clearUploadPrivateKey:'清除上传私钥',customDomain:'独立域名',entryUrl:'访问地址',
 secrets:'密钥配置',apiVersion:'API版本',mchId:'商户号',serialNo:'证书序列号',publicKeyId:'平台公钥ID',sellerId:'支付宝商户UID',offerId:'OfferID',env:'运行环境',subjectType:'主体类型',appKey:'正式环境AppKey',sandboxAppKey:'沙箱环境AppKey',callbackToken:'消息Token',encodingAESKey:'EncodingAESKey',apiV2Key:'API V2密钥',apiV3Key:'API V3密钥',privateKey:'私钥',publicKey:'平台公钥',merchantCertificate:'商户证书',
 accessKeyId:'访问密钥ID',secret:'访问密钥',signature:'短信签名',region:'地域',loginTemplate:'登录短信模板',registerTemplate:'注册短信模板',resetTemplate:'找回密码短信模板',intervalSeconds:'发送间隔',phoneDailyLimit:'单手机号每日发送上限',ipHourlyLimit:'单IP每小时发送上限',makeDefault:'设为默认',purpose:'验证码用途',code:'验证码',consent:'协议同意记录',terms:'用户协议版本',privacy:'隐私政策版本',loginType:'登录方式',
 accountType:'公众号类型',messageEnabled:'消息推送',messageMode:'消息加密模式',token:'Token',clearToken:'清除Token',clearEncodingAESKey:'清除EncodingAESKey',menu:'菜单',children:'子菜单',type:'类型',url:'链接',pagePath:'页面路径',templates:'消息模板',templateId:'模板编号',replies:'自动回复',welcome:'关注回复',fallback:'默认回复',keywords:'关键词回复',keyword:'关键词',match:'匹配方式',text:'文本',materialId:'素材',coverMaterialId:'封面图片',title:'标题',description:'说明',id:'记录编号',
 projectId:'项目编号',artifactSha256:'安装包校验值',action:'操作类型',workerPublicKey:'上传服务公钥',prefix:'会员编号前缀',digits:'会员编号位数',start:'会员编号起始值',qrCode:'二维码',miniMode:'客服入口',wechat:'微信号',image:'图片',brand:'品牌名称',registerTitle:'注册标题',registerDescription:'注册说明',appearance:'页面展示',passwordLoginEnabled:'密码登录',smsLoginEnabled:'验证码登录',showPolicies:'协议展示',autoRegister:'自动注册',fields:'字段映射',key:'字段名称',source:'业务内容',channel:'渠道',imageId:'分享图片',kind:'协议类型',markdown:'协议正文',content:'正文',host:'访问域名',ids:'记录选择',provider:'服务商',aliyun:'阿里云模板',tencent:'腾讯云模板',attempt:'获取尝试次数',choices:'模板选择'
};
const options={all:'全部',enabled:'启用',disabled:'停用',unknown:'未知',male:'男',female:'女',service:'服务号',subscription:'订阅号',plain:'明文模式',compatible:'兼容模式',safe:'安全模式',business:'企业主体',personal:'个人主体',view:'网页',miniprogram:'小程序',group:'分组',text:'文本',image:'图片',video:'视频',news:'图文',exact:'精确匹配',contains:'包含匹配',login:'登录',register:'注册',reset:'找回密码',bind:'绑定手机号',account:'账号',phone:'手机号',auto:'自动识别',home:'首页',profile:'个人中心',mini:'小程序',official:'公众号',terms:'用户协议',privacy:'隐私政策',preview:'预览',upload_trial:'上传体验版'};
function firstIssue(issue){
 if(issue.code!=='invalid_union')return issue;
 // Empty-string/null branches must not hide an email/URL or nested-field failure.
 const issues=issue.errors.flat();
 if(issues.every(row=>row.code==='invalid_value'))return {...issue,code:'invalid_value',values:[...new Set(issues.flatMap(row=>row.values))]};
 // Missing fields, wrong discriminants and unknown keys usually belong to a
 // different union shape. Prefer the branch whose supplied fields matched.
 const score=rows=>rows.reduce((total,row)=>total+(row.code==='unrecognized_keys'?10:['invalid_value','invalid_type'].includes(row.code)?4:1),0);
 const branch=issue.errors.reduce((best,rows)=>score(rows)<score(best)?rows:best);
 return firstIssue(branch.find(row=>row.code!=='unrecognized_keys')||branch[0]);
}
export function formValidationMessage(error,overrides={}){
 const original=error.issues[0];if(!original)return '提交内容无效，请重新填写';
 const issue=firstIssue(original),path=issue.path||original.path||[];
 const names={__proto__:null,...formFieldLabels,...overrides};
 const parts=path.flatMap(part=>typeof part==='number'?[`第${part+1}项`]:part==='config'?[]:[names[part]||'字段']);
 const label=names[path.join('.')]||parts.join(' / ')||'提交内容';
 if(issue.code==='unrecognized_keys')return `${label}包含不支持的字段，请刷新表单后重试`;
 if(/^[\u4e00-\u9fff]/.test(issue.message||''))return `${label}：${issue.message}`;
 if(issue.code==='invalid_type'){
  const type={string:'文本',number:'数字',int:'整数',safeint:'安全范围内的整数',boolean:'是或否',object:'有效对象',array:'列表'}[issue.expected]||'有效内容';
  return `${label}须为${type}`;
 }
 if(['too_small','too_big'].includes(issue.code)){
  const small=issue.code==='too_small',limit=small?issue.minimum:issue.maximum;
  if(issue.origin==='string')return `${label}${small?'至少需要':'最多允许'} ${limit} 个字符`;
  if(issue.origin==='array')return `${label}${small?'至少需要':'最多允许'} ${limit} 项`;
  return `${label}须${small?(issue.inclusive?'大于或等于':'大于'):(issue.inclusive?'小于或等于':'小于')} ${limit}`;
 }
 if(issue.code==='invalid_value'){
  const values=(issue.values||[]).map(value=>Object.hasOwn(options,value)?options[value]:(value===true?'是':value===false?'否':String(value)));
  return values.length===1?`${label}须为：${values[0]}`:values.length&&values.length<=8?`${label}须选择：${values.join('、')}`:`${label}须选择列表中的有效选项`;
 }
 if(issue.code==='invalid_format'){
  const rule={email:'有效的邮箱地址',url:'有效的链接地址',uuid:'有效的编号，请重新选择或刷新表单',datetime:'有效的日期时间',date:'有效的日期',time:'有效的时间'}[issue.format];
  if(rule)return `${label}须为${rule}`;
 }
 if(issue.code==='not_multiple_of')return `${label}须为 ${issue.divisor} 的整数倍`;
 return `${label}格式无效，请按该字段的填写规则修改`;
}
