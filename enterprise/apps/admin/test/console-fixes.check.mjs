import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {updatePreview} from '../app/utils/update-preview.ts';
import {TenantManagement} from '../../api/dist/core/tenant-management.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2];
assert.ok(output&&evidence,'Provide TEST_ADMIN_OUTPUT_DIR and a task evidence directory');
await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(root+'/package.json')('playwright');
const brand={name:'QiCore',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'控制台验收',loginDescription:''};
const branding={version:1,platform:brand,tenant:brand,copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
const session={id:'qa-admin',username:'qa-admin',nickname:'验收',role:'root',roleName:'管理员',permissions:['overview.read','services.read','services.update','accounts.read','accounts.write'],tenantIds:[],csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00.000Z'};
const state=updatePreview('current');state.packageKey='framework-qa';state.productName='QiCore';
const notes='修复：应用任务进度\n小程序更新：需要客户自行上传';
const installed={...state.applications.installed[0],packageKey:'application-qa',name:'验收应用',key:'qa-app',source:'native',version:'0.1.0',update:{state:'current',label:'已是最新版本',description:'',currentVersion:'0.1.0',latestVersion:null,canCheck:true},history:{available:true,items:[{version:'0.1.0',installedAt:'2026-10-25T01:02:03Z',releaseNotes:notes}]},management:{available:true,canRepair:true,canUninstall:true,canInstall:true,reason:''}};
state.applications.installed=[installed];state.applications.purchased=[{...installed,packageKey:'application-new',name:'待安装应用',source:'catalog',version:null,history:{available:true,items:[]}}];
state.history={available:true,description:'',total:1,items:[{version:'0.1.0',releaseNotes:notes,installedAt:'2026-10-25T01:02:03Z'}]};
state.tasks=[{id:'old-app-task',packageKey:installed.packageKey,operation:'repair',status:'succeeded',step:'COMPLETE',version:'0.1.0',fromVersion:'0.1.0',updatedAt:'2026-10-25T01:02:03Z'}];
const service=new TenantManagement({adminAccount:{findUniqueOrThrow:async()=>({id:'qa-user'})}},()=>Buffer.alloc(32));
service.provision=async()=> 'qa-user';
let signedIn=false,failCheck=false,failExecute=false,expireNextLogin=false,delay=350;
const calls=[],errors=[],checks=[],unknown=[],metrics={},frameworkAttempts=[];
const system={allowed:true,canCheck:true,license:state.license,update:state.update};
const api=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname.replace('/api/v1','');
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
 calls.push({path,method:req.method}); // Never retain passwords or cookies.
 let data;
 await new Promise(r=>setTimeout(r,delay));
 try{
  if(path==='/public/site')data=branding;
  else if(path==='/admin/auth/me'){if(!signedIn){res.statusCode=401;throw Error('请登录')}data=session;}
  else if(path==='/admin/auth/login'){signedIn=!expireNextLogin;data=session;}
  else if(path==='/admin/auth/logout'){signedIn=false;data={};}
  else if(path==='/admin/overview'){
   if(!signedIn){res.statusCode=401;throw Error('会话已失效')}
   data={system,updatedAt:'2026-10-25T01:02:03Z',counts:{tenants:0,accounts:1,roles:1,newTenants:0,logins:1,activeTenants:0,todayOperations:0,tenantTotalOperations:0},activity:[],services:[],monitor:{apiMs:5,databaseMs:1,redisMs:1,memoryMb:100,uptimeSeconds:300}};
  }
  else if(path==='/admin/license/status')data=system;
  else if(path==='/admin/updates')data=state;
  else if(path==='/admin/updates/applications/check'){if(failCheck)throw Error('验收检查失败');data={targetVersion:'0.1.0',manifestSha256:'a'.repeat(64),tenants:0,pending:0,integrity:[],releaseNotes:notes};}
  else if(['/admin/updates/applications/execute','/admin/updates/execute'].includes(path)){
   if(body.packageKey===state.packageKey)frameworkAttempts.push(body.requestId);
   if(failExecute)throw Error('验收提交结果未确认');
   if(!state.tasks.some(t=>t.id===body.requestId))state.tasks.push({id:body.requestId,packageKey:body.packageKey,operation:body.operation,status:'running',step:'AUTHORIZE',version:'0.1.0',fromVersion:'0.1.0',updatedAt:'2026-10-25T01:03:04Z'});data={accepted:true};
  }
  else if(['/admin/updates/check','/admin/license/check'].includes(path))data={};
  else if(path==='/admin/tenant-admins'&&req.method==='POST')data=await service.createAccount({...session,_admin:true},body);
  else if(path==='/admin/tenant-admins')data={items:[],total:0};
  else{unknown.push(path);res.statusCode=404;throw Error('Unknown fixture route')}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
 }catch(e){if(res.statusCode===200)res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{code:e.code,message:e.message}}));}
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_DEV_WORKSPACE:'',QICORE_COMPONENTS:'{}',NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='',browser;
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 for(let i=0;i<150;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 const check=async(name,fn)=>{try{await fn();checks.push(name);console.log('PASS '+name)}catch(e){await page.screenshot({animations:'disabled',path:join(evidence,'failed.png')});await writeFile(join(evidence,'failed.json'),JSON.stringify({name,url:page.url(),text:await page.locator('body').innerText(),calls,errors},null,2));throw e}};
 const visibleDialog=()=>page.locator('[role=dialog]:visible').last();
 const close=async()=>{await visibleDialog().getByRole('button',{name:'关闭',exact:true}).last().click();await page.waitForTimeout(250)};
 const appCard=()=>page.getByRole('list',{name:'已经安装的应用',exact:true}).locator(':scope > li').first();
 await check('login SSR result is reused during hydration, with stable title and one password control',async()=>{
  const before=calls.length,response=await page.goto(origin+'/admin/login');
  await page.getByRole('button',{name:'登录总后台',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  assert.equal(calls.slice(before).filter(c=>c.path==='/admin/auth/me').length,1);
  assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
  assert.equal(await page.getByRole('button',{name:'显示密码',exact:true}).count(),1);
 });
 await check('login to workbench avoids duplicate session round trips and retains protected overview read',async()=>{
  await page.getByPlaceholder('请输入后台账号').fill('qa-admin');await page.getByPlaceholder('请输入密码').fill('fixture-only');
  const start=performance.now(),before=calls.length;
  await page.getByRole('button',{name:'登录总后台',exact:true}).click();await page.locator('.workbench-content').waitFor();
  metrics.loginToWorkbenchMs=Math.round(performance.now()-start);metrics.loginRequests=calls.slice(before);
  assert.equal(calls.slice(before).filter(c=>c.path==='/admin/auth/me').length,0);
  assert.ok(calls.slice(before).some(c=>c.path==='/admin/overview'));
  assert.equal(await page.title(),'工作台 · 总后台 · QiCore');
  await page.getByRole('link',{name:'框架与应用',exact:true}).click();await appCard().waitFor();
 });
 // Update/history rendering now belongs to update-center-flows.check.mjs and update-history-details.check.mjs.
 await check('preflight cancellation, failure and delayed refresh keep action loading isolated',async()=>{
  await appCard().getByRole('button',{name:'修复验收应用',exact:true}).click();await visibleDialog().getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(650);
  assert.equal(await page.locator('[role=dialog]:visible').count(),0);
  failCheck=true;await appCard().getByRole('button',{name:'修复验收应用',exact:true}).click();await page.getByText('验收检查失败',{exact:true}).waitFor();failCheck=false;
  await visibleDialog().getByRole('button',{name:'重新检查',exact:true}).click();
  assert.equal(await visibleDialog().getByRole('button',{name:'重新检查',exact:true}).locator('.animate-spin').count(),1);
  assert.equal(await appCard().locator('.animate-spin').count(),0);
  await visibleDialog().getByRole('button',{name:'开始修复',exact:true}).waitFor();await page.waitForTimeout(500);await closePreflight();
 });
 async function closePreflight(){await visibleDialog().getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(250)}
 await check('SaaS form reports account rules, accepts six-character passwords and isolates save loading',async()=>{
  const response=await page.goto(origin+'/admin/saas-users');await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'新增用户',exact:true}).click();
  assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
  const form=page.locator('#saas-user-form'),inputs=form.locator('input');
  await inputs.nth(0).fill('中文账号');
  await form.locator('input[required]').nth(1).fill('中文名称');
  await form.locator('input[type=password]').nth(0).fill('test12');await form.locator('input[type=password]').nth(1).fill('test12');
  assert.equal(await form.getByText('6–128 个字符',{exact:true}).count(),0);assert.equal(await form.getByRole('button',{name:'显示密码',exact:true}).count(),1);
  await visibleDialog().getByRole('button',{name:'创建用户',exact:true}).click();await page.getByText(/^登录账号须为 3–32/).waitFor();
  await page.getByText(/^登录账号须为 3–32/).scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:join(evidence,'saas-account-error.png')});await inputs.nth(0).fill('qa-valid');
  await visibleDialog().getByRole('button',{name:'创建用户',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'查询',exact:true}).locator('.animate-spin').count(),0);
  await page.getByText('SaaS用户已创建',{exact:true}).waitFor();assert.equal(await page.locator('[role=dialog]:visible').count(),0);
 });
 await check('direct workbench access with an invalid session still redirects to login',async()=>{
  signedIn=false;await page.goto(origin+'/admin');await page.waitForURL('**/admin/login');await page.getByRole('button',{name:'登录总后台',exact:true}).waitFor();
 });
 await check('a session revoked immediately after login is rejected by the protected overview API',async()=>{
  expireNextLogin=true;await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  await page.getByPlaceholder('请输入后台账号').fill('qa-admin');await page.getByPlaceholder('请输入密码').fill('fixture-only');
  const before=calls.length;await page.getByRole('button',{name:'登录总后台',exact:true}).click();
  await page.waitForTimeout(1800);await page.waitForURL('**/admin/login');
  assert.ok(calls.slice(before).some(c=>c.path==='/admin/overview'));
  assert.equal(await page.locator('.workbench-content').count(),0);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
 await writeFile(join(evidence,'browser.json'),JSON.stringify({checks,coverageDelegated:['update-center-flows.check.mjs','update-history-details.check.mjs','update-maintenance.check.mjs'],metrics,delayedApiMs:350,submissionDelayMs:800,errors,unknown,productionWrites:false},null,2));
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await new Promise(r=>api.close(r));await writeFile(join(evidence,'server.log'),logs)}
