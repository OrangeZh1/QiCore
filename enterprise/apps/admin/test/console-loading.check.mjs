import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {updatePreview} from '../app/utils/update-preview.ts';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2],baseline=process.env.TEST_NAV_BASELINE==='1';
assert.ok(output&&evidence,'Provide an isolated production console and evidence directory');await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(root+'/package.json')('playwright');
const brand={name:'导航验收',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'导航验收',loginDescription:''};
const branding={version:1,platform:brand,tenant:brand,copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
const permissions=['tenant:settings.read','tenant:settings.write','tenant:materials.read','settings.read','settings.write','consumers.read','orders.read','entitlements.read'];
const site={id:'navigation',name:'导航验收',enabled:true,expiresAt:null,consoleRoutes:[],canViewOverview:false};
const session={id:'qa-user',userId:'qa-user',nickname:'导航验收',role:'tenant',permissions,tenantIds:[site.id],tenantId:site.id,csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00Z'};
const app={key:'system',name:'框架公共能力'},calls=[],unknown=[],errors=[],checks=[];
const platformUpdate=updatePreview('current'),platformSystem={...platformUpdate,license:{...platformUpdate.license,verified:true,permanent:true}};
const platformOverview={system:platformSystem,updatedAt:'2026-10-29T09:00:00Z',counts:{tenants:0,accounts:1,roles:1,newTenants:0,logins:0,activeTenants:0,todayOperations:0,tenantTotalOperations:0},activity:[],services:[],monitor:{apiMs:1,databaseMs:1,redisMs:1,memoryMb:100,uptimeSeconds:60}};
let failTags=false,failEntry=false,entryDelay=200,dataDelay=1200,slowLevels=false;
const api=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/api/v1',''),start=performance.now();calls.push({path,start});
 let data,delay=0;
 if(path==='/public/site')data=branding;
 else if(path==='/admin/auth/me'){data=req.headers['x-console-portal']==='admin'?{...session,role:'root',permissions:['tenants.read','accounts.read','settings.read','overview.read','services.read']}:session;delay=req.headers['x-console-portal']==='admin'?200:0}
 else if(path==='/admin/tenant-entry'){data={tenant:site,tenants:[site],applications:[],application:null,access:'no-applications',permissions,canViewOverview:false};delay=entryDelay;if(failEntry)res.statusCode=503}
 else if(path==='/admin/tenants/navigation/branding')data={...branding,tenantId:site.id};
 else if(path==='/admin/tenants/navigation/consumers'){data={applicationKey:'system',applications:[app],canWrite:true,items:[],total:0,page:1,pageSize:20};delay=dataDelay}
 else if(path==='/admin/tenants/navigation/member-levels'||path==='/admin/tenants/navigation/member-tags'){data={applicationKey:'system',applications:[app],canWrite:true,items:[],total:0,page:1,pageSize:20,rule:{registrationGrowth:0,version:1}};delay=slowLevels&&path.endsWith('member-levels')?2600:dataDelay;if(failTags&&path.endsWith('member-tags'))res.statusCode=500}
 else if(path==='/admin/tenants/navigation/help'){data={applicationKey:'system',applications:[app],canWrite:true,categories:[],items:[],total:0,page:1,pageSize:20};delay=dataDelay}
 else if(path==='/admin/tenants/navigation/site-settings'){data={tenantId:site.id,version:1,config:{name:'导航验收',logo:null,favicon:null,defaultAvatar:null,copyright:'',filing:branding.filing},canWrite:true,inherited:false,updatedAt:null,fallbackImages:{},managed:{name:'导航验收',expiresAt:null,customDomain:null}};delay=dataDelay}
 else if(path==='/admin/tenants'||path==='/admin/tenant-admins'){data={items:[],total:0};delay=dataDelay}
 else if(path==='/admin/overview'){data=platformOverview;delay=dataDelay}
 else if(path==='/admin/license/status')data=platformSystem;
 else if(path==='/admin/updates'){data=platformUpdate;delay=dataDelay}
 else if(path==='/admin/site'){data=branding;delay=dataDelay}
 else{unknown.push(path);res.statusCode=404;data={}}
 await new Promise(resolve=>setTimeout(resolve,delay));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(res.statusCode===500?{error:{message:'验收数据读取失败'}}:{data}));
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_COMPONENTS:'{}',QICORE_DEV_WORKSPACE:''}});
let logs='',browser,page;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 for(let i=0;i<150;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__navigationMarks=[];
  document.addEventListener('click',event=>{
   const link=event.target.closest('a[href]');if(!link||new URL(link.href).origin!==location.origin)return;
   const mark={path:new URL(link.href).pathname,start:performance.now(),feedbackMs:null,readyMs:null};window.__navigationMarks.push(mark);
   const observe=()=>{const node=document.querySelector('.console-navigation-state');if(mark.feedbackMs===null&&node?.checkVisibility())mark.feedbackMs=performance.now()-mark.start;const heading=[...document.querySelectorAll('.console-page-content h1')].find(node=>node.checkVisibility()&&node.textContent.trim()===link.textContent.trim());if(location.pathname===mark.path&&heading){mark.readyMs=performance.now()-mark.start;observer.disconnect()}};
   const observer=new MutationObserver(observe);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});setTimeout(()=>observer.disconnect(),10000);
  },true);
 });
 const hydrated=()=>page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false);
 const settled=async()=>{await page.waitForFunction(()=>!document.querySelector('.console-navigation-state'));await page.waitForTimeout(250)};
 async function platformContent(){
  const frames=[],events=[];
  const titles={'/admin':'工作台','/admin/updates':'框架与应用','/admin/tenants':'租户列表','/admin/saas-users':'SaaS用户'};
  await page.goto(origin+'/admin');await hydrated();await settled();
  await page.getByRole('button',{name:'租户管理',exact:true}).click();
  await page.evaluate(()=>{
   window.__contentFrames=[];window.__contentEvents=[];window.__sampleContent=true;window.__contentFrameCount=0;
   const nuxt=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$nuxt;
   const snapshot=()=>({path:location.pathname,title:document.title,breadcrumb:document.querySelector('.qisvc-console-breadcrumbs li:last-child')?.textContent.trim(),pending:!!document.querySelector('.console-navigation-state'),headings:[...document.querySelectorAll('.console-page-content h1')].filter(n=>n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(n=>n.textContent.trim()),target:nuxt.payload.state['$sconsole-navigation']?.path||null});
   let previous='';const sample=()=>{window.__contentFrameCount++;const data=snapshot(),key=JSON.stringify(data);if(key!==previous){window.__contentFrames.push({at:performance.now(),...data});previous=key}if(window.__sampleContent)requestAnimationFrame(sample)};requestAnimationFrame(sample);
   for(const name of ['page:start','page:finish','page:transition:finish'])nuxt.hook(name,()=>window.__contentEvents.push({event:name,at:performance.now(),...snapshot()}));
  });
  for(const path of ['/admin/updates','/admin','/admin/saas-users','/admin','/admin/tenants','/admin/updates','/admin/saas-users','/admin/tenants']){
   await page.locator('[aria-label="主导航"]').getByRole('link',{name:titles[path],exact:true}).click();
   await page.waitForFunction(path=>location.pathname===path,path);
   if(path!=='/admin'){
    assert.equal(await page.locator('.console-navigation-state').isVisible(),true);
    assert.equal(await page.locator('[aria-label="主导航"]').getByRole('link',{name:titles[path],exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.getByRole('button',{name:'刷新当前页面',exact:true}).locator('.animate-spin').count(),0);
    if(path==='/admin/updates')await page.screenshot({path:join(evidence,'platform-pending.png'),animations:'allow'});
   }
   await settled();await page.locator('.console-page-content').getByRole('heading',{name:titles[path],exact:true}).waitFor();
   assert.equal(await page.title(),titles[path]+' · 总后台 · 导航验收');
   assert.equal(await page.getByRole('button',{name:'租户管理',exact:true}).getAttribute('aria-expanded'),'true');
  }
  await writeFile(join(evidence,'platform-sequential.json'),JSON.stringify(await page.evaluate(()=>({frames:window.__contentFrames,events:window.__contentEvents})),null,2));
  // Commit B's route while its async setup is still pending, then select C.
  await page.locator('[aria-label="主导航"]').getByRole('link',{name:'框架与应用',exact:true}).click();
  await page.waitForURL('**/admin/updates');await page.waitForTimeout(300);
  await page.locator('[aria-label="主导航"]').getByRole('link',{name:'SaaS用户',exact:true}).click();
  await settled();await page.locator('.console-page-content').getByRole('heading',{name:'SaaS用户',exact:true}).waitFor();
  await page.waitForTimeout(dataDelay+300);assert.ok(page.url().endsWith('/admin/saas-users'));
  await page.goBack();await settled();await page.locator('.console-page-content').getByRole('heading',{name:'框架与应用',exact:true}).waitFor();
  await page.goForward();await settled();await page.locator('.console-page-content').getByRole('heading',{name:'SaaS用户',exact:true}).waitFor();
  // Returning to the displayed source while a different page is pending must settle too.
  await page.locator('[aria-label="主导航"]').getByRole('link',{name:'租户列表',exact:true}).click();await page.waitForURL('**/admin/tenants');await page.waitForTimeout(300);
  await page.locator('[aria-label="主导航"]').getByRole('link',{name:'SaaS用户',exact:true}).click();await settled();await page.locator('.console-page-content').getByRole('heading',{name:'SaaS用户',exact:true}).waitFor();
  const sampled=await page.evaluate(()=>{window.__sampleContent=false;return{frames:window.__contentFrames,events:window.__contentEvents,frameCount:window.__contentFrameCount}});frames.push(...sampled.frames);events.push(...sampled.events);
  const mismatches=frames.filter(frame=>frame.headings.some(title=>title!==frame.breadcrumb));
  await writeFile(join(evidence,'platform-frames.json'),JSON.stringify({frameCount:sampled.frameCount,frames,events,mismatches},null,2));
  checks.push({name:'platform-content-frame-consistency',sampledFrames:sampled.frameCount,frameStates:frames.length,mismatches:mismatches.length});
  assert.deepEqual(mismatches,[],'a visible page must match the selected breadcrumb throughout transitions');
  for(const [path,title] of Object.entries(titles)){
   for(const method of ['direct','reload']){const response=method==='direct'?await page.goto(origin+path):await page.reload();await hydrated();assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],title+' · 总后台 · 导航验收');assert.equal(await page.title(),title+' · 总后台 · 导航验收')}
  }
  await page.screenshot({path:join(evidence,'platform-ready.png'),animations:'disabled'});
  checks.push({name:'platform-core-direct-and-refresh-titles',passed:true});
 }
 const initial=await page.goto(origin+'/tenant/users');await hydrated();assert.equal((await initial.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
 if(process.env.TEST_PLATFORM_CONTENT_ONLY==='1'){
  await platformContent();assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({checks,errors,unknown},null,2));console.log(JSON.stringify({checks,errors,unknown},null,2));
 }else if(baseline){
  const offset=calls.length;await page.getByRole('link',{name:'会员等级',exact:true}).click();await page.getByRole('heading',{name:'会员等级',exact:true}).waitFor();await page.waitForTimeout(250);
  const mark=await page.evaluate(()=>window.__navigationMarks.at(-1));assert.equal(mark.feedbackMs,null);assert.ok(mark.readyMs>=dataDelay);
  const result={baseline:true,mark,entryDelayMs:entryDelay,dataDelayMs:dataDelay,requests:calls.slice(offset).map(c=>c.path)};
  await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }else{
 assert.equal(calls.filter(c=>c.path==='/admin/auth/me').length,1);assert.equal(calls.filter(c=>c.path==='/admin/tenant-entry').length,1,'site switcher must not repeat initialization');
 checks.push({name:'direct-entry-title-and-single-initialization',passed:true});
 await page.evaluate(()=>window.__sidebar=document.querySelector('[aria-label="主导航"]'));
 let offset=calls.length;await page.getByRole('link',{name:'会员等级',exact:true}).click();await page.locator('.console-navigation-state').waitFor();assert.equal(await page.title(),'会员等级 · 租户后台 · 导航验收');
 assert.equal(await page.getByRole('link',{name:'会员等级',exact:true}).getAttribute('aria-current'),'page');
 assert.equal(await page.getByRole('button',{name:'刷新当前页面',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'刷新当前页面',exact:true}).locator('.animate-spin').count(),0);
 await page.screenshot({path:join(evidence,'pending.png'),animations:'disabled'});await settled();await page.getByRole('heading',{name:'会员等级',exact:true}).waitFor();
 const mark=await page.evaluate(()=>window.__navigationMarks.at(-1));assert.ok(mark.feedbackMs>=0&&mark.feedbackMs<500,JSON.stringify(mark));
 assert.equal(await page.evaluate(()=>window.__sidebar===document.querySelector('[aria-label="主导航"]')),true);
 assert.deepEqual(calls.slice(offset).map(c=>c.path),['/admin/tenant-entry','/admin/tenants/navigation/member-levels']);
 checks.push({name:'delayed-navigation',feedbackMs:Math.round(mark.feedbackMs),readyMs:Math.round(mark.readyMs),entryDelayMs:entryDelay,dataDelayMs:dataDelay,requests:2,sidebarRetained:true});
 // An API error belongs to the destination page and can be retried independently.
 failTags=true;await page.getByRole('link',{name:'会员标签',exact:true}).click();await settled();await page.getByText('验收数据读取失败',{exact:true}).first().waitFor();
 failTags=false;const retry=page.getByRole('button',{name:'重试',exact:true});await retry.click();await retry.locator('.animate-spin').waitFor();
 assert.equal(await page.getByRole('button',{name:'刷新当前页面',exact:true}).locator('.animate-spin').count(),0);assert.equal(await page.locator('.console-navigation-state').count(),0);
 await page.getByText('验收数据读取失败',{exact:true}).first().waitFor({state:'hidden'});checks.push({name:'destination-error-and-independent-retry',passed:true});
 slowLevels=true;await page.getByRole('link',{name:'会员等级',exact:true}).click();await page.locator('.console-navigation-state').waitFor();
 await page.getByRole('link',{name:'用户列表',exact:true}).click();await settled();await page.getByRole('heading',{name:'用户列表',exact:true}).waitFor();await page.waitForTimeout(2800);
 assert.ok(page.url().endsWith('/tenant/users'));assert.equal(await page.locator('.console-navigation-state').count(),0);slowLevels=false;checks.push({name:'overlapping-navigation-late-response',passed:true});
 await page.goBack();await settled();await page.goForward();await settled();assert.ok(page.url().endsWith('/tenant/users'));checks.push({name:'browser-back-forward',passed:true});
 failEntry=true;await page.getByRole('link',{name:'会员等级',exact:true}).click();await page.getByRole('button',{name:'重新打开',exact:true}).or(page.getByRole('link',{name:'重新打开',exact:true})).waitFor();
 assert.equal(await page.locator('.console-navigation-state').getAttribute('aria-busy'),'false');failEntry=false;await page.getByRole('link',{name:'重新打开',exact:true}).click();await hydrated();await settled();await page.getByRole('heading',{name:'会员等级',exact:true}).waitFor();
 await page.getByRole('link',{name:'用户列表',exact:true}).click();await settled();checks.push({name:'navigation-initialization-error-and-recovery',passed:true});
 // The production middleware is shared by the host and SDK. Emulate the SDK's
 // declared route ownership without reading or building any business app source.
 await page.evaluate(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$nuxt.$config.public.nativeApplication={key:'qa-app',routes:['/tenant/users','/tenant/member-levels']});
 const documentStart=await page.evaluate(()=>performance.timeOrigin);await page.getByRole('link',{name:'会员等级',exact:true}).click();await settled();assert.equal(await page.evaluate(()=>performance.timeOrigin),documentStart);
 offset=calls.length;await page.getByRole('button',{name:'内容管理',exact:true}).click();
 const responseReady=page.waitForResponse(r=>r.request().isNavigationRequest()&&new URL(r.url()).pathname==='/tenant/help');
 await page.getByRole('link',{name:'帮助中心',exact:true}).click();const documentResponse=await responseReady;await hydrated();await settled();
 assert.notEqual(await page.evaluate(()=>performance.timeOrigin),documentStart);assert.equal(calls.slice(offset).filter(c=>c.path==='/admin/tenant-entry').length,1,'only destination SSR initializes context');
 assert.equal((await documentResponse.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());assert.equal(await page.getByRole('button',{name:'用户管理',exact:true}).getAttribute('aria-expanded'),'true');
 checks.push({name:'sdk-route-ownership-and-early-document-handoff',passed:true});
 const refresh=await page.reload();await hydrated();assert.equal((await refresh.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
 await page.getByRole('button',{name:'系统设置',exact:true}).click();await page.getByRole('link',{name:'站点设置',exact:true}).click();await settled();
 await page.locator('#tenant-site-name').fill('未保存的导航验收');await page.getByRole('button',{name:'用户管理',exact:true}).click();await page.getByRole('link',{name:'用户列表',exact:true}).click();
 await page.getByRole('dialog',{name:'放弃未保存的修改？'}).waitFor();assert.equal(await page.locator('.console-navigation-state').count(),0);await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.ok(page.url().endsWith('/tenant/site'));
 assert.equal(await page.locator('#tenant-site-name').inputValue(),'未保存的导航验收');checks.push({name:'cancelled-draft-keeps-original-page',passed:true});
 // Leave via the existing explicit discard flow, then check platform navigation.
 await page.getByRole('link',{name:'用户列表',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await settled();
 await page.goto(origin+'/admin/tenants');await hydrated();await page.getByRole('button',{name:'系统设置',exact:true}).click();await page.getByRole('link',{name:'网站设置',exact:true}).click();await page.locator('.console-navigation-state').waitFor();await settled();
 assert.match(await page.title(),/^网站设置/);checks.push({name:'platform-navigation',passed:true});
 await page.screenshot({path:join(evidence,'ready.png'),animations:'disabled'});
 await platformContent();
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/tenant/users');await hydrated();await page.getByRole('link',{name:'会员等级',exact:true}).click();await page.locator('.console-navigation-state').waitFor();
 assert.equal(await page.locator('.console-navigation-skeleton').evaluate(node=>getComputedStyle(node).animationName),'none');await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(evidence,'mobile-pending.png'),animations:'disabled'});await settled();checks.push({name:'reduced-motion-and-narrow-layout',passed:true});
 assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({checks,errors,unknown},null,2));console.log(JSON.stringify({checks,errors,unknown},null,2));
 }
}catch(error){if(page){await writeFile(join(evidence,'failed-frames.json'),JSON.stringify(await page.evaluate(()=>({frames:window.__contentFrames,events:window.__contentEvents})).catch(()=>({})),null,2));await page.screenshot({path:join(evidence,'failed.png'),animations:'disabled'}).catch(()=>{})}await writeFile(join(evidence,'failed.json'),JSON.stringify({error:String(error),checks,errors,unknown,calls,logs},null,2));throw error}
finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited}await new Promise(r=>api.close(r))}
