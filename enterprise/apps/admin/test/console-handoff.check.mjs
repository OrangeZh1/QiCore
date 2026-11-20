import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.env.TEST_ADMIN_OUTPUT_DIR,appRoot=process.env.TEST_HANDOFF_APP_DIR,evidence=process.argv[2],mode=process.env.TEST_HANDOFF_MODE||'installed';
assert.ok(output&&appRoot&&evidence);await mkdir(evidence,{recursive:true});
const descriptor=JSON.parse(await readFile(join(appRoot,'application.json'),'utf8')),routes=descriptor.web.admin.routes.map(route=>({...route,applicationKey:descriptor.key}));
const {chromium}=createRequire(root+'/package.json')('playwright');
const brand={name:'框架品牌',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'验收登录',loginDescription:''};
const branding={version:1,platform:brand,tenant:brand,copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
const permissions=['tenant:settings.read','tenant:materials.read','settings.read','consumers.read','orders.read','handoff-app:overview.read','handoff-app:records.read'];
const session={id:'qa-account',userId:'qa-account',nickname:'验收用户',role:'tenant',roleName:'管理员',permissions,tenantIds:['alpha','beta'],tenantId:null,csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00Z'};
let revoked=false;const calls=[],unknown=[],browserErrors=[],samples=[];
const api=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/api/v1',''),call={path,start:performance.now()};calls.push(call);
 let data,delay=80;
 if(path==='/public/site')data=branding;
 else if(path==='/admin/auth/me')data=session;
 else if(path==='/admin/tenant-entry'){
  const tenants=['alpha','beta'].map(id=>({id,name:id==='alpha'?'北城':'南城',enabled:true,expiresAt:null,consoleRoutes:routes,canViewOverview:false})),tenant=tenants.find(item=>item.id===url.searchParams.get('tenantId'))||null;
  data={tenant,tenants,applications:[{key:descriptor.key,name:descriptor.name,state:revoked?'expired':'available',consoleRoutes:routes}],application:null,access:'choose-application',permissions,canViewOverview:false};
 }else if(/^\/admin\/tenants\/(alpha|beta)\/branding$/.test(path)){const tenantId=path.split('/')[3];data={...branding,tenantId,tenant:{...brand,name:tenantId==='alpha'?'北城':'南城'}}}
 else if(/^\/admin\/tenants\/(alpha|beta)\/consumers$/.test(path)){data={applicationKey:'handoff-app',applications:[{key:'handoff-app',name:'验收应用'}],canWrite:false,items:[],total:0,page:1,pageSize:20};delay=200}
 else if(/^\/admin\/tenants\/(alpha|beta)\/handoff-data$/.test(path)){data={message:'server-data:'+path.split('/')[3]};delay=200}
 else{unknown.push(path);res.statusCode=404;data={}}
 await new Promise(r=>setTimeout(r,delay));call.end=performance.now();res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port}
const port=await freePort(),origin='http://127.0.0.1:'+port,env={...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_DEV_WORKSPACE:''};
const children=[];let logs='',browser,page;
function run(args,options={}){const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env,...options});children.push(child);child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);return child}
async function ready(url){for(let i=0;i<200;i++){try{if((await fetch(url)).status<500)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Fixture failed to start: '+logs.slice(-2000))}
try{
 if(mode==='proxy'){
  const appPort=await freePort(),entry=pathToFileURL(resolve(appRoot,'web/admin/server/index.mjs')).href;
  run(['--input-type=module','-e',`import {createServer} from 'node:http';import {handler} from ${JSON.stringify(entry)};createServer(handler).listen(${appPort},'127.0.0.1')`]);
  await ready('http://127.0.0.1:'+appPort+'/unmatched');
  const workspace=resolve(appRoot,'../handoff-workspace.json');await writeFile(workspace,JSON.stringify({format:'qicore-development-workspace-v1',applications:[{key:descriptor.key,packageKey:descriptor.packageKey,version:descriptor.version,path:resolve(appRoot),adminOrigin:'http://127.0.0.1:'+appPort}]}));
  env.NODE_ENV='development';env.QICORE_DEV_WORKSPACE=workspace;delete env.QICORE_COMPONENTS;
 }else env.QICORE_COMPONENTS=JSON.stringify({[descriptor.packageKey]:{type:'app',path:resolve(appRoot),version:descriptor.version}});
 run([join(output,'server/index.mjs')],{cwd:output});await ready(origin+'/brand/qicore.png');
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message));
 await context.addCookies([{name:'qicore_last_tenant_site',value:encodeURIComponent(JSON.stringify({accountId:session.id,tenantId:'alpha'})),url:origin}]);
 await page.addInitScript(()=>{window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});const ready=()=>{if(document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false)window.__readyAt=performance.now();else requestAnimationFrame(ready)};requestAnimationFrame(ready)});
 const hydrated=()=>page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false);
 async function snapshot(name,offset,html){
  await hydrated();await page.getByTestId('application-data').waitFor();assert.equal(await page.getByTestId('application-data').textContent(),'server-data:alpha');
  const timings=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],resources=performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script'||e.initiatorType==='link');return{ttfbMs:Math.round(n.responseStart),responseMs:Math.round(n.responseEnd),readyMs:Math.round(window.__readyAt??performance.now()),resourceCount:resources.length,transferredBytes:resources.reduce((sum,e)=>sum+e.transferSize,0),longTasks:window.__longTasks.map(e=>Math.round(e.duration))}});
  const readCount=process.env.EXPECT_HANDOFF_SNAPSHOT==='1'?1:2;
  assert.equal(calls.slice(offset).filter(c=>c.path==='/admin/auth/me').length,readCount);assert.equal(calls.slice(offset).filter(c=>c.path==='/admin/tenant-entry').length,readCount);assert.equal(calls.slice(offset).filter(c=>c.path==='/public/site').length,1);
  assert.equal(html.match(/<title>(.*?)<\/title>/)[1],await page.title());samples.push({name,...timings,api:calls.slice(offset).map(c=>({path:c.path,startMs:Math.round(c.start-calls[offset].start),durationMs:Math.round(c.end-c.start)}))});
 }
 for(let iteration=0;iteration<Number(process.env.TEST_HANDOFF_ITERATIONS||3);iteration++){
  await page.goto(origin+'/tenant/users');await hydrated();const offset=calls.length;
  const responseReady=page.waitForResponse(r=>r.request().isNavigationRequest()&&new URL(r.url()).pathname==='/tenant/handoff-summary');
  await page.getByRole('link',{name:'工作台',exact:true}).click();const response=await responseReady;assert.equal(response.status(),200);await snapshot('host-to-app-'+(iteration+1),offset,await response.text());
  const document=await page.evaluate(()=>performance.timeOrigin);
  const production=page.getByRole('button',{name:'制作管理',exact:true});if(await production.getAttribute('aria-expanded')!=='true')await production.click();await page.getByRole('link',{name:'应用记录',exact:true}).click();await page.getByRole('heading',{name:'应用记录',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.console-navigation-state'));
  assert.equal(await page.evaluate(()=>performance.timeOrigin),document,'within-app navigation keeps its document');
  const users=page.getByRole('button',{name:'用户管理',exact:true});if(await users.getAttribute('aria-expanded')!=='true')await users.click();const returned=page.waitForURL(url=>url.pathname==='/tenant/users');await page.getByRole('link',{name:'用户列表',exact:true}).click();await returned;await hydrated();assert.match(await page.title(),/^用户列表/);assert.notEqual(await page.evaluate(()=>performance.timeOrigin),document);
 }
 // Scope and revocation must be checked again on each document request.
 await context.addCookies([{name:'qicore_last_tenant_site',value:encodeURIComponent(JSON.stringify({accountId:session.id,tenantId:'beta'})),url:origin}]);
 const scoped=await page.goto(origin+'/tenant/handoff-summary');await hydrated();assert.equal(await page.getByTestId('application-data').textContent(),'server-data:beta');assert.match(await page.title(),/南城$/);assert.ok((await scoped.text()).includes('server-data:beta'));
 revoked=true;const denied=await context.request.get(origin+'/tenant/handoff-summary');assert.equal(denied.status(),403);assert.ok(!(await denied.text()).includes('server-data:'));revoked=false;
 assert.deepEqual(browserErrors,[]);assert.deepEqual(unknown,[]);
 await page.screenshot({path:join(evidence,'application.png'),animations:'disabled'});
 const result={mode,apiDelayMs:80,dataDelayMs:200,samples,scope:'passed',revocation:'passed',browserErrors,unknown,limitations:mode==='proxy'?'Production build over separate local processes; excludes Vite cold compilation.':'Two independently built production renderers, synthetic API responses.'};
 await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){const client=await page?.evaluate(()=>{const n=document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt;return{url:location.href,route:n?._route?.fullPath,current:n?.$router?.currentRoute.value.fullPath,navigation:n?.payload.state['$sconsole-navigation'],data:document.querySelector('[data-testid="application-data"]')?.textContent}}).catch(()=>null);if(page)await page.screenshot({path:join(evidence,'failed.png')}).catch(()=>{});await writeFile(join(evidence,'failed.json'),JSON.stringify({error:String(error),samples,client,calls,unknown,browserErrors,logs},null,2));throw error}
finally{await browser?.close();for(const child of children.reverse())if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited}await new Promise(r=>api.close(r))}
