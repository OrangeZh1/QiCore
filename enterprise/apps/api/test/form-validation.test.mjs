import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {formValidationMessage} from '../dist/core/form-validation.mjs';
import {PlatformAdmins} from '../dist/core/platform-admins.mjs';
import {TenantPermissions} from '../dist/core/tenant-permissions.mjs';
import {TenantConsumers} from '../dist/core/tenant-consumers.mjs';
import {ConsumerAuth} from '../dist/core/consumer-auth.mjs';
import {ConsumerSmsAuth} from '../dist/core/consumer-sms-auth.mjs';
import {RoleManagement} from '../dist/core/role-management.mjs';
import {ScheduledTasks} from '../dist/core/scheduled-tasks.mjs';
import {SiteSettings,defaultSiteSettings} from '../dist/core/site-settings.mjs';
import {TenantSiteSettings} from '../dist/core/tenant-site-settings.mjs';
import {TenantMiniPrograms,miniProgramDefaults} from '../dist/core/tenant-mini-programs.mjs';
import {TenantH5} from '../dist/core/tenant-h5.mjs';
import {TenantOfficialAccounts,officialAccountDefaults} from '../dist/core/tenant-official-accounts.mjs';
import {TenantConsumerSettings,customerServiceSchema} from '../dist/core/tenant-consumer-settings.mjs';
import {TenantPageSharing} from '../dist/core/tenant-page-sharing.mjs';
import {TenantPolicies} from '../dist/core/tenant-policies.mjs';
import {paymentConfig,paymentDefaults,validatePaymentKeys} from '../dist/payments/config.mjs';
import {smsConfig,smsDefaults,validateSmsCredentials} from '../dist/channels/sms.mjs';
import {officialAccountConfig} from '../dist/channels/official-account-config.mjs';
import {subscriptionConfig} from '../dist/channels/subscriptions.mjs';

const session={_admin:true,id:'fixture',role:'root',permissions:['accounts.write','roles.write','tasks.read','tasks.write','settings.write']};
const stop=()=>{throw Error('VALIDATION_PASSED_BEFORE_IO')};
const message=(schema,input)=>{const result=schema.safeParse(input);assert.equal(result.success,false);return formValidationMessage(result.error)};
const rejected=(promise,pattern)=>assert.rejects(promise,e=>{assert.match(e.message,pattern);assert.doesNotMatch(e.message,/private-fixture-secret/);return true});

test('standard field errors retain array positions, bounds, unions and enum choices without reflecting input values',()=>{
 assert.match(message(z.object({password:z.string().min(6)}),{password:'12345'}),/密码.*6.*字符/);
 assert.match(message(z.object({phoneDailyLimit:z.number().int().max(100)}),{phoneDailyLimit:101}),/每日发送上限.*100/);
 assert.match(message(z.object({email:z.union([z.literal(''),z.email()])}),{email:'invalid'}),/邮箱.*邮箱地址/);
 const notification=z.union([z.object({provider:z.string(),content:z.string()}).strict(),z.object({templates:z.object({aliyun:z.string().max(3)})}).strict()]);
 assert.match(message(notification,{templates:{aliyun:'too long'}}),/消息模板.*阿里云模板.*3/);
 assert.match(message(z.object({fields:z.array(z.object({key:z.string().max(5)}))}),{fields:[{key:'toolong'}]}),/字段映射.*第1项.*字段名称.*5/);
 assert.match(message(z.object({gender:z.enum(['unknown','male','female'])}),{gender:'invalid'}),/性别.*未知、男、女/);
 assert.doesNotMatch(message(z.object({}).strict(),{'private-fixture-secret':'private-fixture-secret'}),/private-fixture-secret/);
 assert.doesNotMatch(message(z.object({password:z.string().max(3)}),{password:'private-fixture-secret'}),/private-fixture-secret/);
 assert.equal(message(z.object({confirm:z.literal('删除用户')}),{confirm:'wrong'}),'确认内容须为：删除用户');
 assert.match(message(z.record(z.string(),z.string().max(3)),{constructor:'private-fixture-secret'}),/^字段最多允许 3 个字符$/);
});

test('platform, tenant and consumer account forms distinguish username, password, phone and nickname failures',async()=>{
 const base={requestId:randomUUID(),username:'fixture-user',nickname:'中文名称',password:'test12',phone:'',roleId:'fixture-role',enabled:true,allowMultipleSessions:true};
 const platform=new PlatformAdmins({},()=>Buffer.alloc(32));platform.transaction=stop;
 const tenant=new TenantPermissions({},()=>Buffer.alloc(32));tenant.context=stop;
 const consumers=new TenantConsumers({});consumers.writeContext=stop;
 for(const [run,valid,accountField] of [[body=>platform.create(session,body),base,'username'],[body=>tenant.createMember(session,'fixture',body),base,'username'],[body=>consumers.create(session,'fixture',body),{applicationKey:'fixture',userId:'fixture123',nickname:'中文名称',password:'test12',phone:''},'userId']]){
  await rejected(run({...valid,[accountField]:'中文账号'}),/账号.*3[–-](?:32|64)/);
  await rejected(run({...valid,password:'12345'}),/密码.*6.*字符/);
  await rejected(run({...valid,password:'x'.repeat(129)}),/密码.*128.*字符/);
  await rejected(run({...valid,phone:'invalid'}),/手机号/);
  await rejected(run({...valid,nickname:''}),/(名称|昵称).*1.*字符/);
  for(const password of ['test12','x'.repeat(128)])await assert.rejects(run({...valid,password}),/VALIDATION_PASSED_BEFORE_IO/);
 }
});

test('registration and SMS password recovery report only the invalid field, while valid six-character passwords pass unchanged',async()=>{
 const auth=new ConsumerAuth({}, {eval:async()=>1});auth.applications.available=stop;
 const registration={tenantId:'fixture',applicationKey:'fixture',account:'fixture123',password:'test12'};
 await rejected(auth.register({...registration,account:'中文账号'},'fixture'),/账号.*3–64/);
 await rejected(auth.register({...registration,password:'12345'},'fixture'),/密码.*6/);
 await assert.rejects(auth.register(registration,'fixture'),/VALIDATION_PASSED_BEFORE_IO/);
 const sms=new ConsumerSmsAuth({}, {}, {});sms.available=stop;
 const reset={tenantId:'fixture',applicationKey:'fixture',phone:'13800138000',code:'123456',password:'test12'};
 for(const [field,value,pattern] of [['phone','invalid',/手机号.*11/],['code','abc',/验证码.*6/],['password','12345',/密码.*6/]])await rejected(sms.reset({...reset,[field]:value}),pattern);
 await assert.rejects(sms.reset(reset),/VALIDATION_PASSED_BEFORE_IO/);
});

test('role and scheduled-task schemas identify the actual name, command and schedule constraints',async()=>{
 await rejected(new RoleManagement({}).create(session,{name:'',permissions:[],enabled:true,requestId:randomUUID()}),/角色名称.*1/);
 const tasks=new ScheduledTasks({},{}),input={name:'测试任务',command:'invalid command',params:'',rule:'0 1 * * *',enabled:true,remark:'',requestId:randomUUID()};
 await rejected(tasks.save(session,null,input),/任务命令.*命令名/);
 await rejected(tasks.save(session,null,{...input,command:'cache:clear',rule:'bad'}),/五段 Cron/);
});

test('platform and tenant site settings locate nested brand, image and filing-link errors',async()=>{
 const value={version:1,...structuredClone(defaultSiteSettings)};value.platform.name='';
 await rejected(new SiteSettings({}).save(session,value),/平台名称.*1/);
 value.platform.name='有效名称';value.filing.icpLink='javascript:alert(1)';
 await rejected(new SiteSettings({}).save(session,value),/备案信息.*ICP备案链接.*HTTP/);
 const config={name:'站点',logo:null,favicon:null,defaultAvatar:null,copyright:'',filing:structuredClone(defaultSiteSettings.filing)};
 await rejected(new TenantSiteSettings({}).save(session,'fixture',{version:0,config:{...config,logo:'invalid-image'}}),/Logo.*PNG.*JPEG.*WebP/);
});

test('mini-program, H5 and customer-service configuration errors expose the exact field rule',async()=>{
 const mini=new TenantMiniPrograms({},{});
 await rejected(mini.save(session,'fixture','fixture',{version:0,config:{...miniProgramDefaults,appId:'invalid'}}),/AppID.*wx.*16/);
 await rejected(mini.save(session,'fixture','fixture',{version:0,config:miniProgramDefaults,appSecret:'private-fixture-secret'}),/AppSecret.*32.*十六进制/);
 const h5=new TenantH5({},{});
 await rejected(h5.save(session,'fixture','fixture',{version:0,config:{displayName:'H5',entryUrl:'http://example.test'}}),/访问地址.*HTTPS/);
 await rejected(h5.save(session,'fixture','fixture',{version:0,config:{displayName:'',customDomain:''}}),/H5渠道名称.*1/);
 const config=customerServiceSchema.parse({miniMode:'page',phone:'',wechat:'',description:''});
 await rejected(new TenantConsumerSettings({}).save(session,'fixture','fixture','customerService',{version:0,config:{...config,phone:'invalid'}}),/客服电话.*5–20/);
 await rejected(new TenantConsumerSettings({}).save(session,'fixture','fixture','users',{version:0,config:{prefix:'中文',digits:8,start:1,defaultAvatar:null}}),/会员编号前缀.*英文字母/);
});

test('payment configuration and secret errors distinguish providers and secret fields without echoing secret contents',()=>{
 assert.throws(()=>paymentConfig('wechat',{...paymentDefaults.wechat,mchId:'12'}),/商户号.*6–20/);
 assert.throws(()=>paymentConfig('alipay',{...paymentDefaults.alipay,appId:'wx123'}),/支付宝应用ID.*16.*数字/);
 assert.throws(()=>paymentConfig('wechat-virtual',{...paymentDefaults['wechat-virtual'],subjectType:'personal',env:1}),/运行环境.*个人主体.*正式环境/);
 assert.throws(()=>validatePaymentKeys('wechat',{apiVersion:'V3'},{apiV3Key:'private-fixture-secret'}),e=>/API V3密钥.*32/.test(e.message)&&!e.message.includes('private-fixture-secret'));
 assert.throws(()=>validatePaymentKeys('wechat-virtual',paymentDefaults['wechat-virtual'],{callbackToken:'x'}),/消息Token.*3–32/);
 assert.throws(()=>validatePaymentKeys('wechat-virtual',paymentDefaults['wechat-virtual'],{encodingAESKey:'bad'}),/EncodingAESKey.*43/);
 assert.throws(()=>validatePaymentKeys('alipay',paymentDefaults.alipay,{},true),/请填写AppID/);
 for(const provider of ['wechat','alipay','wechat-virtual'])assert.deepEqual(paymentConfig(provider,paymentDefaults[provider]),paymentDefaults[provider]);
});

test('SMS provider fields and send limits identify the failing template or credential',()=>{
 assert.throws(()=>smsConfig('tencent',{...smsDefaults,intervalSeconds:29}),/发送间隔.*30/);
 assert.throws(()=>smsConfig('aliyun',{...smsDefaults,resetTemplate:'wrong'}),/找回密码短信模板.*SMS_/);
 assert.throws(()=>validateSmsCredentials('aliyun',smsDefaults,{accessKeyId:'bad'}),/访问密钥ID.*8–200/);
 assert.throws(()=>validateSmsCredentials('aliyun',smsDefaults,{secret:'private fixture secret'}),/访问密钥.*不能包含空格/);
 assert.deepEqual(smsConfig('aliyun',smsDefaults),smsDefaults);
});

test('official-account nested errors identify the menu/reply row and preserve optional incomplete drafts',async()=>{
 const config=officialAccountConfig.parse(structuredClone(officialAccountDefaults));
 const menu={name:'菜单',type:'miniprogram',url:'https://example.test',appId:'',pagePath:'pages/home/index',children:[]};
 const service=new TenantOfficialAccounts({},{});
 await rejected(service.save(session,'fixture','fixture',{version:0,config:{...config,menu:[menu]}}),/菜单.*第1项.*AppID/);
 await rejected(service.save(session,'fixture','fixture',{version:0,config:{...config,menu:[{...menu,type:'view',url:'javascript:alert(1)'}]}}),/菜单.*第1项.*链接.*HTTP/);
 const reply={...config.replies.welcome,type:'news',title:'图文',url:'https://example.test'};
 const result=officialAccountConfig.safeParse({...config,replies:{...config.replies,welcome:reply}});assert.equal(result.success,false);assert.match(formValidationMessage(result.error),/关注回复.*封面图片/);
 assert.equal(officialAccountConfig.safeParse(config).success,true);
 assert.equal(officialAccountConfig.safeParse({...config,replies:{...config.replies,welcome:{type:'image'}}}).success,true,'empty image drafts remain allowed');
 const materialId=randomUUID();assert.equal(officialAccountConfig.safeParse({...config,replies:{...config.replies,welcome:{type:'video',materialId}}}).success,true,'video titles remain optional under the existing contract');
});

test('subscription mappings, sharing and policies report their own invalid field',async()=>{
 assert.throws(()=>subscriptionConfig({enabled:false,templateId:'',fields:[{key:'invalid',source:'title'}]},{fields:[]}),/字段映射.*第1项.*字段名称.*thing/);
 const mapping={enabled:false,templateId:'',fields:[{key:'thing1',source:'title'},{key:'thing1',source:'title'}]},events={fields:[{value:'title',type:'thing'}]};
 assert.throws(()=>subscriptionConfig(mapping,events),/第2项.*字段名称不能重复/);
 assert.throws(()=>subscriptionConfig({...mapping,fields:[{key:'time1',source:'title'}]},events),/第1项.*业务内容.*类型匹配/);
 await rejected(new TenantPageSharing({},{}).save(session,'fixture','fixture','home','mini',{version:0,config:{title:'x'.repeat(31),imageId:null}}),/分享标题.*30/);
 await rejected(new TenantPageSharing({},{}).view(session,'fixture','fixture','invalid'),/分享页面.*首页、个人中心/);
 const policies=new TenantPolicies({});policies.context=async()=>({});
 await rejected(policies.save(session,'fixture','fixture','terms',{version:0,title:'',content:'正文'}),/标题.*1/);
});
