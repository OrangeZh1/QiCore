import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {PlatformAdmins} from '../../api/dist/core/platform-admins.mjs';
import {TenantPermissions} from '../../api/dist/core/tenant-permissions.mjs';
import {TenantConsumers} from '../../api/dist/core/tenant-consumers.mjs';
import {SiteSettings,defaultSiteSettings} from '../../api/dist/core/site-settings.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2];
assert.ok(output&&evidence,'Provide an isolated console build and evidence directory');await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(root+'/package.json')('playwright');
const branding={version:1,...structuredClone(defaultSiteSettings)},permissions=['accounts.read','accounts.write','settings.read','settings.write','tenant:settings.read','tenant:settings.write','tenant:accounts.read','tenant:accounts.write','consumers.read','consumers.write'];
const site={id:'fixture',name:'字段验收站点',enabled:true,expiresAt:null,consoleRoutes:[],canViewOverview:false};
const session=portal=>({id:'qa-'+portal,userId:'qa-'+portal,username:'fixture',nickname:'字段验收',role:portal==='tenant'?'tenant':'root',roleName:'管理员',permissions,tenantIds:[site.id],tenantId:site.id,csrfToken:'fixture-only',expiresAt:'2099-01-01T00:00:00.000Z'});
const platform=new PlatformAdmins({},()=>Buffer.alloc(32));platform.transaction=async()=>({created:true});
const tenant=new TenantPermissions({},()=>Buffer.alloc(32));tenant.context=async()=>({});tenant.transaction=async()=>({created:true});
const consumers=new TenantConsumers({});consumers.writeContext=async()=>({});consumers.applications.transaction=async()=>({created:true});
const website=new SiteSettings({});
const calls=[],unknown=[],errors=[],checks=[];
const api=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/api/v1',''),portal=req.headers['x-console-portal']==='tenant'?'tenant':'admin';
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
 calls.push({path,method:req.method});await new Promise(r=>setTimeout(r,350));
 try{
  let data;
  if(path==='/public/site')data=branding;
  else if(path==='/public/maintenance')data={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true};
  else if(path==='/admin/auth/me')data=session(portal);
  else if(path==='/admin/tenant-entry')data={tenant:site,tenants:[site],applications:[],application:null,access:'no-applications',canViewOverview:false,permissions};
  else if(path==='/admin/tenants/fixture/branding')data={...branding,tenantId:site.id};
  else if(path==='/admin/platform-admins/roles'||path==='/admin/tenants/fixture/administrators/roles')data={items:[{id:'qa-role',name:'验收角色',assignable:true}],total:1};
  else if(path==='/admin/platform-admins'&&req.method==='POST')data=await platform.create({...session(portal),_admin:true},body);
  else if(path==='/admin/tenants/fixture/administrators'&&req.method==='POST')data=await tenant.createMember(session(portal),site.id,body);
  else if(path==='/admin/tenants/fixture/consumers'&&req.method==='POST')data=await consumers.create(session(portal),site.id,body);
  else if(path==='/admin/platform-admins'||path==='/admin/tenants/fixture/administrators')data={items:[],total:0,canWrite:true};
  else if(path==='/admin/tenants/fixture/consumers')data={items:[],total:0,page:1,pageSize:20,canWrite:true,canManageAssets:false,applicationKey:'system',applications:[{key:'system',name:'系统公共用户'}]};
  else if(path==='/admin/site'&&req.method==='PUT')data=await website.save({...session(portal),_admin:true},body);
  else if(path==='/admin/site')data=branding;
  else{unknown.push(path);res.statusCode=404;throw Error('Unknown fixture route')}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
 }catch(e){if(res.statusCode===200)res.statusCode=e.status||400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{code:e.code,message:e.message}}));}
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_COMPONENTS:'{}',QICORE_DEV_WORKSPACE:'',NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='',browser,page;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 for(let i=0;i<150;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 const check=async(name,run)=>{try{await run();checks.push(name);console.log('PASS '+name)}catch(e){await page.screenshot({animations:'disabled',path:join(evidence,'failed.png')});await writeFile(join(evidence,'failed.json'),JSON.stringify({name,error:e.message,text:await page.locator('body').innerText(),calls,unknown,errors},null,2));throw e}};
 for(const portal of ['admin','tenant'])await check(portal+' administrator field errors, six-character password and independent loading',async()=>{
  const response=await page.goto(origin+'/'+portal+'/administrators');await page.waitForLoadState('networkidle');assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
  await page.getByRole('button',{name:'新增管理员',exact:true}).click();const form=page.locator(portal==='admin'?'#administrator-form':'#tenant-administrator-form');
  await form.locator('input[required]').nth(0).fill('中文账号');await form.locator('input[required]').nth(1).fill('中文名称');
  await form.locator('input[autocomplete="new-password"]').nth(0).fill('test12');await form.locator('input[autocomplete="new-password"]').nth(1).fill('test12');
  await form.getByText('搜索并选择角色',{exact:true}).click();await page.getByRole('option',{name:'验收角色',exact:true}).click();
  assert.equal(await form.getByText('6–128 个字符',{exact:true}).count(),0);assert.equal(await form.getByRole('button',{name:'显示密码',exact:true}).count(),1);
  const submit=page.getByRole('button',{name:'创建管理员',exact:true});await submit.click();assert.equal(await page.getByRole('button',{name:'查询',exact:true}).locator('.animate-spin').count(),0);
  await form.getByText(/登录账号.*3–32/).waitFor();await form.getByText(/登录账号.*3–32/).scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:join(evidence,portal+'-account-error.png')});
  await form.locator('input[required]').nth(0).fill('qa-valid');await form.locator('input[type=tel]').fill('invalid');await submit.click();await form.getByText(/手机号.*只能包含/).waitFor();
  await form.locator('input[type=tel]').fill('');await submit.click();await form.waitFor({state:'hidden'});
 });
 await check('consumer nickname/account/email errors stay separate and six-character optional passwords are accepted',async()=>{
  await page.goto(origin+'/tenant/users');await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'新建用户',exact:true}).click();const form=page.locator('#customer-form'),submit=page.getByRole('button',{name:'保存',exact:true});
  await form.locator('#customer-account').fill('中文账号');await submit.click();await form.getByText('请输入昵称',{exact:true}).waitFor();
  await form.locator('#customer-nickname').fill('中文昵称');await submit.click();await form.getByText('账号须为 3–64 位英文字母或数字',{exact:true}).waitFor();
  await form.locator('#customer-account').fill('fixture123');await form.locator('#customer-email').fill('invalid');await submit.click();await form.getByText(/邮箱.*有效的邮箱地址/).waitFor();
  await page.screenshot({animations:'disabled',path:join(evidence,'consumer-email-error.png')});assert.equal(await form.getByText(/6–128 位。/).count(),0);
  await form.locator('#customer-email').fill('');await form.locator('#customer-password').fill('test12');await form.locator('#customer-confirm-password').fill('test12');await submit.click();await form.waitFor({state:'hidden'});
 });
 await check('site settings show the exact nested link rule while preserving the draft',async()=>{
  await page.goto(origin+'/admin/site');await page.waitForLoadState('networkidle');
  const links=page.locator('input[id*=icp]');assert.ok(await links.count());
  await page.locator('#icp-link').fill('javascript:alert(1)');await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.getByText(/ICP备案链接.*HTTP/).waitFor();assert.equal(await page.locator('#icp-link').inputValue(),'javascript:alert(1)');
  await page.getByText(/ICP备案链接.*HTTP/).scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:join(evidence,'site-link-error.png')});
 });
 assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);await writeFile(join(evidence,'browser.json'),JSON.stringify({checks,delayPerApiMs:350,errors,unknown,validators:'actual API validators; persistence stubbed before writes',realUsersCreated:false,productionWrites:false},null,2));
}finally{await browser?.close();if(child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}await new Promise(r=>api.close(r));await writeFile(join(evidence,'server.log'),logs)}
