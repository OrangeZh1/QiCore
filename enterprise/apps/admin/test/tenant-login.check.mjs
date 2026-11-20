import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2],optimized=process.env.EXPECT_OPTIMIZED!=='false',stableLogin=process.env.EXPECT_STABLE_LOGIN!=='false',performanceOnly=process.env.TEST_LOGIN_PERFORMANCE_ONLY==='1';
assert.ok(output&&evidence,'Provide an isolated TEST_ADMIN_OUTPUT_DIR and an evidence directory');
await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(root+'/package.json')('playwright');
const brand=name=>({name,logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'租户登录验收',loginDescription:''});
const branding={version:1,platform:brand('QiCore'),tenant:brand('QiCore'),copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
const first={id:'site-a',name:'站点A',enabled:true,expiresAt:null,consoleRoutes:[],canViewOverview:false};
const second={...first,id:'site-b',name:'站点B'};
const permissions=['tenant:settings.read','tenant:settings.write'];
let mode={sites:[first]},signedIn=false,scenario='startup';
const calls=[],errors=[],unknown=[],checks=[],metrics=[];
const session=()=>({id:'qa-user',userId:'qa-user',username:'qa-user',nickname:'验收账号',role:mode.platform?'root':'tenant',roleName:'管理员',permissions:mode.platform?['overview.read','tenants.read','tenants.write','accounts.read','accounts.write']:permissions,tenantIds:mode.sites.map(s=>s.id),tenantId:mode.delegated?'site-b':mode.sites.length===1?mode.sites[0].id:null,csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00.000Z',...(mode.delegated?{delegated:true,delegatedBy:'验收平台'}:{})});
const system={allowed:true,canCheck:false,license:{state:'active',label:'授权正常',verified:true,permanent:true,expiresAt:null},update:{currentVersion:'0.1.0',label:'当前版本'}};
const entry=id=>{
 const sites=mode.sites.map(s=>({...s,canEnter:s.enabled&&(mode.delegated||!s.expiresAt||Date.parse(s.expiresAt)>Date.now())})),selected=id|| (sites.length===1?sites[0].id:null),tenant=sites.find(s=>s.id===selected)||null;
 const application=mode.application&&tenant?{key:'fixture-app',name:'验收应用',state:'available',consoleRoutes:[{path:'/tenant/workbench',group:'workbench',label:'应用工作台',icon:'i-lucide-layout-dashboard',applicationKey:'fixture-app'}]}:null;
 if(tenant){tenant.consoleRoutes=application?.consoleRoutes||[];tenant.application=application;}
 return {tenant,tenants:sites,applications:application?[application]:[],application:null,access:!tenant?(selected?'forbidden':'choose-tenant'):!tenant.enabled?'tenant-disabled':!tenant.canEnter?'tenant-expired':application?'choose-application':'no-applications',canViewOverview:false,permissions};
};
const api=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/api/v1',''),row={scenario,path,query:url.search,method:req.method,start:performance.now()};calls.push(row);
 for await(const _chunk of req){} // Credentials are fixture-only and are never retained.
 await new Promise(r=>setTimeout(r,250));
 try{
  let data;
  if(path==='/public/site')data=branding;
  else if(path==='/public/maintenance')data={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true};
  else if(path==='/admin/auth/login'){if(mode.failLogin){res.statusCode=mode.loginStatus||401;throw Error(mode.loginMessage||'账号或密码错误，或账号已停用')}signedIn=!mode.revoke;data=session();}
  else{
   if(!signedIn){res.statusCode=401;throw Error('请登录后台')}
   if(path==='/admin/auth/me')data=session();
   else if(path==='/admin/license/status')data=system;
   else if(path==='/admin/overview')data={system,updatedAt:'2026-10-25T01:02:03Z',counts:{tenants:1,accounts:1,roles:1,newTenants:0,logins:1,activeTenants:0,todayOperations:0,tenantTotalOperations:0},activity:[],services:[],monitor:{apiMs:5,databaseMs:1,redisMs:1,memoryMb:100,uptimeSeconds:300}};
   else if(path==='/admin/tenant-entry')data=entry(url.searchParams.get('tenantId'));
   else if(path==='/admin/tenants')data={items:mode.sites.map(s=>({...s,version:1,createdAt:'2026-10-01T00:00:00Z',logo:null,contactName:'',contactPhone:'',storageMode:'platform',remark:'',customDomain:null,ownerAdminId:'qa-user',_count:{adminScopes:1}})),total:mode.sites.length};
   else if(path==='/admin/tenant-admins')data={items:[{id:'qa-user',username:'qa-user',nickname:'验收账号',enabled:true}],total:1};
   else if(path==='/admin/tenants/application-options')data={items:[]};
   else if(/^\/admin\/tenants\/site-[ab]\/branding$/.test(path)){
    const id=path.split('/')[3],site=mode.sites.find(s=>s.id===id);if(!site||!site.enabled||!mode.delegated&&site.expiresAt&&Date.parse(site.expiresAt)<=Date.now()){res.statusCode=403;throw Error('站点不可访问')}
    data={...branding,tenantId:id,tenant:brand(site.name)};
   }else {unknown.push(path);res.statusCode=404;throw Error('Unknown fixture route')}
  }
  row.end=performance.now();row.status=res.statusCode;res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
 }catch(e){row.end=performance.now();row.status=res.statusCode;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:e.message}}));}
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_COMPONENTS:'{}',QICORE_DEV_WORKSPACE:'',NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='',browser,page,context;
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 for(let i=0;i<150;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 async function prepare(name,options={},remembered){
  await context?.close();scenario=name;mode={sites:[first],...options};signedIn=false;
  context=await browser.newContext({viewport:{width:1360,height:900}});
  if(remembered)await context.addCookies([{name:'qicore_last_tenant_site',value:encodeURIComponent(JSON.stringify(remembered)),url:origin}]);
  page=await context.newPage();page.on('pageerror',e=>errors.push({scenario,message:e.message}));
  const documents=[];page.on('request',req=>{if(req.isNavigationRequest()&&req.resourceType()==='document')documents.push(new URL(req.url()).pathname)});
  if(mode.application)await page.route(origin+'/tenant/workbench',async route=>{
   if(route.request().resourceType()!=='document')return route.continue();
   const selected=mode.delegated?'site-b':remembered?.tenantId||mode.sites[0].id;
   const site=mode.sites.find(s=>s.id===selected);
   assert.ok(signedIn&&site?.enabled,'application fixture receives only an authorized target');
   await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="UTF-8"><title>应用工作台 · ${site.name}</title><link rel="icon" href="/brand/qicore.png"><style>@view-transition{navigation:auto}::view-transition-group(*){animation-duration:0s}::view-transition-old(root){display:none}::view-transition-new(root){animation:none}</style></head><body><h1>应用工作台 · ${site.name}</h1></body></html>`});
  });
  const before=calls.length,response=await page.goto(origin+(mode.platform?'/admin/login':'/tenant/login'));
  await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
  assert.equal(await page.getByRole('button',{name:'显示密码',exact:true}).count(),1);
  const reads=calls.slice(before).filter(c=>c.path==='/admin/auth/me').length;
  if(optimized)assert.equal(reads,1,'SSR login state must be reused during hydration');
  return {documents,loginPageSessionReads:reads};
 }
 async function login(){await page.getByPlaceholder('请输入后台账号').fill('qa-user');await page.getByPlaceholder('请输入密码').fill('fixture-only');const start=performance.now(),offset=calls.length;await page.getByRole('button',{name:mode.platform?'登录总后台':'登录租户后台',exact:true}).click();return {start,offset}}
 async function check(name,fn){if(performanceOnly&&name!=='single-site login keeps framework navigation in the document without repeating authentication')return;try{await fn();checks.push(name);console.log('PASS '+name)}catch(e){await page?.screenshot({animations:'disabled',path:join(evidence,'failed.png')});await writeFile(join(evidence,'failed.json'),JSON.stringify({scenario,name,message:e.message,metrics,calls,errors,text:page?await page.locator('body').innerText():''},null,2));throw e}}
 await check('single-site login keeps framework navigation in the document without repeating authentication',async()=>{
  const initial=await prepare('single'),run=await login();await page.getByRole('heading',{name:'站点A',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false&&!document.querySelector('.console-navigation-state,.page-enter-active,.page-leave-active'));
  const requests=calls.slice(run.offset).map(c=>({path:c.path,query:c.query,status:c.status}));
  metrics.push({scenario,elapsedMs:Math.round(performance.now()-run.start),...initial,documents:[...initial.documents],requests});
  if(optimized){assert.equal(requests.filter(c=>c.path==='/admin/auth/me').length,stableLogin?0:1);assert.deepEqual(initial.documents,stableLogin?['/tenant/login']:['/tenant/login','/tenant/workbench']);}
  assert.equal(await page.title(),'工作台 · 租户后台 · 站点A');
  await page.screenshot({animations:'disabled',path:join(evidence,'framework-workbench.png')});
 });
 await check('direct entry and refresh preserve the server-rendered tenant title, favicon and authorization',async()=>{
  for(let i=0;i<2;i++){
   const response=await page.reload();await page.getByRole('heading',{name:'站点A',exact:true}).waitFor();await page.waitForLoadState('networkidle');
   const html=await response.text();assert.equal(html.match(/<title>(.*?)<\/title>/)[1],await page.title());assert.ok(html.includes('/brand/qicore.png'));
  }
 });
 await check('multiple sites resume the remembered accessible site and explicit switching keeps the selector',async()=>{
  await prepare('remembered',{sites:[first,second]},{accountId:'qa-user',tenantId:'site-b'});await login();await page.getByRole('heading',{name:'站点B',exact:true}).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.title(),'工作台 · 租户后台 · 站点B');
  await page.getByRole('button',{name:'切换租户站点：站点B',exact:true}).click();await page.getByRole('heading',{name:'选择租户站点',exact:true}).waitFor();assert.ok(page.url().includes('switch=1'));
  await page.getByRole('button',{name:'进入站点 站点A',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'进入站点 站点B',exact:true}).locator('.animate-spin').count(),0);
  await page.getByRole('heading',{name:'站点A',exact:true}).waitFor();
 });
 await check('another account or revoked remembered site cannot choose a tenant',async()=>{
  for(const remembered of [{accountId:'different-user',tenantId:'site-b'},{accountId:'qa-user',tenantId:'revoked-site'}]){
   await prepare('untrusted-preference',{sites:[first,second]},remembered);await login();await page.getByRole('heading',{name:'选择租户站点',exact:true}).waitFor();
   assert.equal(new URL(page.url()).pathname,'/tenant');assert.equal(await page.getByRole('heading',{name:'工作台',exact:true}).count(),0);
  }
 });
 await check('disabled remembered tenants remain blocked instead of becoming the current site',async()=>{
  await prepare('disabled',{sites:[first,{...second,enabled:false}]},{accountId:'qa-user',tenantId:'site-b'});await login();await page.getByRole('heading',{name:'选择租户站点',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'进入站点 站点B',exact:true}).isDisabled(),true);
 });
 await check('an expired tenant account can log in and refresh its selector but cannot enter the expired backend',async()=>{
  await prepare('expired-account',{sites:[{...second,expiresAt:'2000-01-01T00:00:00Z'}]},{accountId:'qa-user',tenantId:'site-b'});await login();await page.getByRole('heading',{name:'选择租户站点',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/tenant');assert.equal(await page.getByRole('button',{name:'进入站点 站点B',exact:true}).isDisabled(),true);
  const response=await page.reload();await page.getByRole('heading',{name:'选择租户站点',exact:true}).waitFor();assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
  await page.goto(origin+'/tenant/workbench');await page.getByText('请联系平台管理员处理租户续期。',{exact:true}).waitFor();assert.ok(page.url().includes('/tenant/applications'));assert.equal(await page.getByRole('heading',{name:'站点B',exact:true}).count(),0);
 });
 await check('application-owned workbench uses a document handoff even when its path equals the framework route',async()=>{
  const initial=await prepare('application',{sites:[second],application:true}),run=await login();await page.getByRole('heading',{name:'应用工作台 · 站点B',exact:true}).waitFor();
  assert.deepEqual(initial.documents,['/tenant/login','/tenant/workbench']);
  metrics.push({scenario,elapsedMs:Math.round(performance.now()-run.start),...initial,documents:[...initial.documents],requests:calls.slice(run.offset).map(c=>({path:c.path,query:c.query,status:c.status}))});
 });
 await check('delegated login chooses its designated site instead of the remembered tenant',async()=>{
  await prepare('delegated',{sites:[second],delegated:true,application:true},{accountId:'qa-user',tenantId:'site-a'});await login();await page.getByRole('heading',{name:'应用工作台 · 站点B',exact:true}).waitFor();
 });
 await check('verified platform delegation opens an expired tenant framework backend and keeps its SSR title on refresh',async()=>{
  await prepare('expired-delegation',{sites:[{...second,expiresAt:'2000-01-01T00:00:00Z'}],delegated:true},{accountId:'qa-user',tenantId:'site-a'});await login();await page.getByRole('heading',{name:'站点B',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/tenant/workbench');assert.equal(await page.title(),'工作台 · 租户后台 · 站点B');
  const response=await page.reload();await page.getByRole('heading',{name:'站点B',exact:true}).waitFor();assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
 });
 await check('failed login keeps both portals stable across credential, permission and service errors',async()=>{
  for(const platform of [false,true]){
   const {documents}=await prepare('failed-login-'+(platform?'admin':'tenant'),{failLogin:true,platform});
   for(const width of [1360,390]){
    await page.setViewportSize({width,height:900});
   for(const [status,message] of [[401,'账号或密码错误，或账号已停用'],[401,'账号或密码错误，或账号已停用'],[403,'该账号没有当前后台入口权限'],[503,'服务暂不可用，请重试']]){
    mode.loginStatus=status;mode.loginMessage=message;
    await page.evaluate(()=>{window.__loginForm=document.querySelector('form');window.__loginFrames=[];window.__sampleLogin=true;const sample=()=>{const input=document.querySelector('input[autocomplete=username]');window.__loginFrames.push({top:input.getBoundingClientRect().top,disabled:input.disabled,readonly:input.readOnly});if(window.__sampleLogin)requestAnimationFrame(sample)};sample()});
    await login();await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);await page.getByText(message,{exact:true}).waitFor();
    const frames=await page.evaluate(()=>{window.__sampleLogin=false;return{frames:window.__loginFrames,sameForm:window.__loginForm===document.querySelector('form')}}),tops=frames.frames.map(frame=>frame.top),shift=Math.max(...tops)-Math.min(...tops);
    metrics.push({scenario,width,status,formShiftPx:shift,disabledDuringRequest:frames.frames.some(frame=>frame.disabled),sameForm:frames.sameForm,documents:[...documents]});
    assert.equal(new URL(page.url()).pathname,platform?'/admin/login':'/tenant/login');assert.equal(frames.sameForm,true);assert.equal(documents.length,1);
    if(stableLogin){assert.ok(shift<=1,'login form moved '+shift+'px after '+status);assert.equal(frames.frames.some(frame=>frame.disabled),false,'pending login must keep the input appearance stable')}
   }
   await page.screenshot({animations:'disabled',path:join(evidence,'failed-login-'+(platform?'admin':'tenant')+'-'+width+'.png')});
   }
  }
 });
 await check('a session revoked after login is rejected by tenant-entry before rendering a workbench',async()=>{
  await prepare('revoked-session',{revoke:true});await login();await page.waitForTimeout(1600);await page.waitForURL('**/tenant/login');assert.equal(await page.getByRole('heading',{name:'工作台',exact:true}).count(),0);
 });
 await check('the shared login component preserves platform login behavior without redundant session requests',async()=>{
  await prepare('platform-regression',{platform:true});const run=await login();await page.locator('.workbench-content').waitFor();
  assert.equal(await page.title(),'工作台 · 总后台 · QiCore');assert.equal(calls.slice(run.offset).filter(c=>c.path==='/admin/auth/me').length,0);
 });
 await check('platform expiry maintenance entry is enabled and the clear-date control stays one line at desktop and mobile widths',async()=>{
  mode.sites=[{...second,expiresAt:'2000-01-01T00:00:00Z'}];const offset=calls.length,start=performance.now();await page.goto(origin+'/admin/tenants');await page.waitForLoadState('networkidle');
  const reads=calls.slice(offset).filter(call=>call.path==='/admin/auth/me').length;metrics.push({scenario:'platform-tenants-direct',elapsedMs:Math.round(performance.now()-start),sessionReads:reads,requests:calls.slice(offset).map(call=>call.path)});if(stableLogin)assert.equal(reads,1,'one SSR document must authenticate only once');
  assert.equal(await page.getByRole('button',{name:'登录',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('menuitem',{name:'编辑',exact:true}).click();
  const clear=page.getByRole('button',{name:'清空',exact:true}),date=page.locator('input[type="datetime-local"]');await clear.waitFor();
  for(const width of [1360,390]){
   await page.setViewportSize({width,height:900});await clear.scrollIntoViewIfNeeded();
   const button=await clear.boundingBox(),input=await date.boundingBox(),style=await clear.evaluate(el=>({whiteSpace:getComputedStyle(el).whiteSpace,shrink:getComputedStyle(el).flexShrink}));
   assert.ok(button&&input&&Math.abs(button.height-input.height)<2);assert.equal(style.whiteSpace,'nowrap');assert.equal(style.shrink,'0');assert.ok(button.x+button.width<=width);
   await page.screenshot({animations:'disabled',path:join(evidence,'tenant-expiry-clear-'+width+'.png')});
  }
  await clear.click();assert.equal(await date.inputValue(),'');assert.equal(await clear.count(),0);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
 await writeFile(join(evidence,'browser.json'),JSON.stringify({optimized,stableLogin,delayPerApiMs:250,checks,metrics,errors,unknown,productionWrites:false},null,2));
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await new Promise(r=>api.close(r));await writeFile(join(evidence,'server.log'),logs)}
