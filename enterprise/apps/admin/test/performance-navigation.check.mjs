import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),state=process.argv[2]||await mkdtemp(join(tmpdir(),'qicore-navigation-check-'));
if(!process.env.TEST_ADMIN_OUTPUT_DIR)throw Error('Set TEST_ADMIN_OUTPUT_DIR to an isolated production console build');
await mkdir(state,{recursive:true});
const {chromium}=createRequire(root+'/package.json')('playwright');
const {defaultDecoration,decorationTargets,decorationBlock}=await import(pathToFileURL(root+'/apps/api/src/core/decoration-contract.mjs'));
const label='navigation',build={output:process.env.TEST_ADMIN_OUTPUT_DIR};
const startupOnly=process.env.TEST_STARTUP_ONLY==='1',slowNetwork=process.env.TEST_SLOW_NETWORK==='1';
const brand={name:'性能验收',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'性能验收',loginDescription:''};
const siteBrand={version:1,platform:brand,tenant:brand,copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
const tenant={id:'performance',name:'性能验收站点',enabled:true,expiresAt:null,consoleRoutes:[],canViewOverview:false,application:{key:'performance-app',name:'验收应用',state:'available',consoleRoutes:[]}};
const session={id:'performance-user',userId:'performance-user',username:'performance',nickname:'性能验收',avatar:null,profileVersion:1,tenantId:tenant.id,tenantIds:[tenant.id],role:'tenant',roleName:'管理员',permissions:['tenant:settings.read','tenant:settings.write','tenant:materials.read','tenant:materials.write','settings.read','settings.write','consumers.read','orders.read','entitlements.read'],csrfToken:'performance-only',expiresAt:'2099-01-01T00:00:00.000Z'};
const entry={tenant,tenants:[tenant],applications:[tenant.application],application:null,access:'choose-application',canViewOverview:false,permissions:session.permissions};
let row={id:'current',name:'性能验收装修',scheme:defaultDecoration(),updatedAt:'2026-10-23T00:00:00.000Z'};
const view=()=>({applicationKey:'performance-app',applications:[{key:'performance-app',name:'验收应用'}],canWrite:true,version:1,current:row,currentSaved:true,schemes:[row],templates:[],systemTemplates:[],targets:decorationTargets,groups:[],activeId:'current',publishedAt:row.updatedAt,published:row.scheme});
const calls=[],unknown=[];
const api=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/api/v1','');const item={path,method:req.method,start:performance.now()};calls.push(item);let data;
if(path==='/public/site')data=siteBrand;
else if(path==='/admin/auth/me')data=session;
else if(path==='/admin/tenant-entry')data=entry;
else if(path==='/admin/tenants/performance/branding')data={...siteBrand,tenantId:tenant.id};
else if(path==='/admin/tenants/performance/decoration')data=view();
else if(path==='/admin/tenants/performance/h5')data={previewUrl:'http://example.test',qrCode:'',title:'验收'};
else if(['/admin/tenants/performance/materials/performance-app','/admin/tenants/performance/materials/shared'].includes(path))data={items:[],total:0,groups:[],canManage:true,canUpload:false,policy:{label:'验收素材',revisionId:'fixture',maxFileMb:20}};
else if(path==='/admin/tenants/performance/decoration/performance-app'&&req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));row.scheme=body.scheme;data=view();}
else {unknown.push(path);res.statusCode=404;data={};}
await new Promise(r=>setTimeout(r,120));item.end=performance.now();res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const output=build.output,child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:'http://127.0.0.1:'+port,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_DEV_WORKSPACE:'',QICORE_COMPONENTS:'{}',NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const origin='http://127.0.0.1:'+port;
let browser;
try{
 for(let i=0;i<150;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(),errors=[],downloads=[],compressed=new Set();
 if(slowNetwork){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})}
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.request().resourceType()==='script'){downloads.push(r.url().split('/').pop());if(r.headers()['content-encoding'])compressed.add(r.url())}});
 await page.addInitScript(()=>{window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
 async function snapshot(name,start,offset){const readyMs=Math.round(performance.now()-start);await page.waitForTimeout(350);const transfer=await page.evaluate(()=>{const assets=performance.getEntriesByType('resource').filter(r=>/\.(?:js|css)(?:\?|$)/.test(r.name)),scripts=assets.filter(r=>/\.js(?:\?|$)/.test(r.name));return{assetEncodedBytes:assets.reduce((n,r)=>n+r.encodedBodySize,0),assetDecodedBytes:assets.reduce((n,r)=>n+r.decodedBodySize,0),scriptEncodedBytes:scripts.reduce((n,r)=>n+r.encodedBodySize,0),scriptDecodedBytes:scripts.reduce((n,r)=>n+r.decodedBodySize,0)}});return{name,readyMs,elapsedMs:Math.round(performance.now()-start),...transfer,compressedScripts:compressed.size,title:await page.title(),calls:calls.slice(offset).map(c=>({path:c.path,durationMs:Math.round((c.end||performance.now())-c.start)})),scripts:[...new Set(downloads)],longTasks:await page.evaluate(()=>window.__longTasks)};}
 const results=[];
 let start=performance.now(),offset=calls.length;const response=await page.goto(origin+'/tenant/workbench');await page.locator('.qisvc-console-sidebar-group-trigger').first().waitFor();await page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false&&!document.querySelector('.console-navigation-state,.page-enter-active,.page-leave-active'));
 results.push(await snapshot('workbench',start,offset));results[0].initialTitle=(await response.text()).match(/<title>(.*?)<\/title>/)?.[1];
 if(!startupOnly){
 const menu=page.getByRole('button',{name:'装修管理',exact:true});start=performance.now();await menu.click();await page.getByRole('button',{name:'手机端',exact:true}).click();results.push({name:'menu',elapsedMs:Math.round(performance.now()-start)});
 start=performance.now();offset=calls.length;await page.getByRole('link',{name:'页面装修',exact:true}).click();await page.locator('.decoration-overview').waitFor();results.push(await snapshot('decoration-navigation',start,offset));
 start=performance.now();offset=calls.length;await page.goto(origin+'/tenant/decoration-editor?application=performance-app&page=home');await page.locator('.studio-header').waitFor();results.push(await snapshot('editor',start,offset));
 // A typed title must survive internal tabs, undo and redo without a reload.
 const input=page.locator('.studio-properties input[type=text]').first();
 await input.fill('性能草稿保留测试');
 start=performance.now();offset=calls.length;await page.getByRole('navigation',{name:'编辑区域'}).getByRole('button',{name:'主题',exact:true}).click();await page.waitForURL('**tab=theme**');await page.locator('.theme-panel').waitFor();await page.getByRole('navigation',{name:'编辑区域'}).getByRole('button',{name:'首页',exact:true}).click();await page.waitForFunction(()=>!new URL(location.href).searchParams.has('tab'));await page.locator('.studio-properties input[type=text]').first().waitFor();results.push(await snapshot('editor-tabs',start,offset));
 results.at(-1).draftRetained=await page.locator('input').evaluateAll(nodes=>nodes.some(n=>n.value==='性能草稿保留测试'));
 assert.equal(results.at(-1).draftRetained,true,'internal tabs must preserve the draft');
 assert.equal(results.at(-1).calls.length,0,'internal tabs must not reload tenant context');
 assert.equal(results[0].initialTitle,results[0].title);
 const check=async(name,fn)=>{try{await fn();results.push({name,passed:true})}catch(error){await page.screenshot({path:join(state,'failed.png'),animations:'disabled'});await writeFile(join(state,'failed.json'),JSON.stringify({name,error:String(error),text:await page.locator('body').innerText(),row,errors,unknown},null,2));throw error}};
 await check('undo-redo',async()=>{await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.studio-properties input[type=text]')?.value==='首页');await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.studio-properties input[type=text]')?.value==='性能草稿保留测试')});
 await check('all-tabs-and-browser-history',async()=>{
  const tabs=page.getByRole('navigation',{name:'编辑区域'});
  await tabs.getByRole('button',{name:'个人中心',exact:true}).click();await page.waitForURL('**page=profile**');
  await tabs.getByRole('button',{name:'底部导航',exact:true}).click();await page.waitForURL('**tab=navigation**');
  await page.goBack();await page.waitForFunction(()=>new URL(location.href).searchParams.get('page')==='profile'&&!new URL(location.href).searchParams.has('tab'));
  await page.goBack();await page.waitForFunction(()=>document.querySelector('.studio-properties input[type=text]')?.value==='性能草稿保留测试');
 });
 await check('leave-guard',async()=>{await page.getByRole('link',{name:'返回页面装修',exact:true}).click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.ok(page.url().includes('decoration-editor'));assert.equal(await input.inputValue(),'性能草稿保留测试')});
 await check('save-failure-preserves-draft-and-loading',async()=>{
  await page.route('**/api/v1/admin/tenants/performance/decoration/performance-app',async route=>{await new Promise(r=>setTimeout(r,400));await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'验收保存失败'}})})});
  const save=page.getByRole('button',{name:'保存',exact:true});await save.click();await page.waitForTimeout(80);assert.equal(await page.getByRole('button',{name:'预览',exact:true}).locator('.animate-spin').count(),0);
  await page.getByText('验收保存失败',{exact:true}).waitFor();assert.equal(await input.inputValue(),'性能草稿保留测试');await page.waitForFunction(()=>!document.querySelector('.studio-header-actions button[aria-busy=true]'));await page.unroute('**/api/v1/admin/tenants/performance/decoration/performance-app');
  await page.screenshot({path:join(state,'save-error.png'),animations:'disabled'});
  const reads=calls.length;await page.getByRole('button',{name:'关闭保存提示',exact:true}).click();assert.equal(await page.locator('.studio-error').count(),0);assert.equal(await input.inputValue(),'性能草稿保留测试');assert.equal(calls.length,reads,'closing the notice must not reload or save the draft');assert.equal(await save.isEnabled(),true);
 });
 await check('save-success-and-refresh',async()=>{
  await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.studio-state')?.textContent?.includes('已保存并生效'));assert.equal(row.scheme.home.title,'性能草稿保留测试');
  const response=await page.reload();await input.waitFor();assert.equal(await input.inputValue(),'性能草稿保留测试');assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)?.[1],await page.title());
 });
 await check('direct-entry-title',async()=>{
  const html=await (await context.request.get(origin+'/tenant/decoration-editor?application=performance-app&page=home')).text();assert.equal(html.match(/<title>(.*?)<\/title>/)?.[1],await page.title());
 });
 await check('incomplete-components-save-with-a-dismissible-warning',async()=>{
  await page.locator('.studio-component-grid').getByRole('button',{name:'按钮',exact:true}).click();
  await page.getByRole('button',{name:'保存',exact:true}).click();
  const warning=page.getByText(/^首页第 \d+ 个组件的内容、图片或跳转目标尚未补全$/).locator('xpath=../..');
  await warning.waitFor({timeout:5000});assert.equal(await page.locator('.studio-error').count(),0);assert.equal(row.scheme.home.blocks.at(-1).type,'button');assert.equal(row.scheme.home.blocks.at(-1).target,'');
  assert.ok((await warning.innerText()).includes('已保存并生效'));await page.screenshot({path:join(state,'save-warning.png'),animations:'disabled'});await warning.getByRole('button').click();await warning.waitFor({state:'hidden'});
  const response=await page.reload();await page.locator('[data-block-id]').first().waitFor();assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)?.[1],await page.title());
 });
 await check('retired-application-urls-redirect-on-direct-entry-refresh-and-client-navigation',async()=>{
  for(const path of ['/tenant/apps/performance-app','/tenant/performance/apps/old-app']){
   const response=await page.goto(origin+path+'?tab=recent#section');assert.equal(response.status(),200);assert.equal(new URL(page.url()).pathname,'/tenant/workbench');assert.equal(new URL(page.url()).search,'?tab=recent');assert.equal(new URL(page.url()).hash,'#section');
   await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();assert.equal(await page.getByText('应用访问正常',{exact:true}).count(),0);assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)?.[1],await page.title());
   await page.reload();await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
  }
  await page.evaluate(()=>{void document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$nuxt.$router.push('/tenant/apps/old-app')});
  await page.waitForURL(url=>url.pathname==='/tenant/workbench'&&!url.search);await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
  assert.equal(await page.locator('a[href^="/tenant/apps/"]').count(),0);
 });
 if(process.env.TEST_ADMIN_MANIFEST){const {checkLazyComponents}=await import('./fixtures/lazy-components.mjs');results.push({name:'lazy-components',...await checkLazyComponents({browser,origin,row,state,output,manifestPath:process.env.TEST_ADMIN_MANIFEST,decorationBlock})})}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
 await page.screenshot({path:state+'/'+label+'-workbench.png'});
 await writeFile(state+'/'+label+'-browser.json',JSON.stringify({delayPerApiMs:120,startupOnly,slowNetwork,network:slowNetwork?{latencyMs:80,downloadBytesPerSecond:200000,cpuSlowdown:4}:null,results,errors,unknown},null,2));
 console.log(JSON.stringify({results:results.map(({scripts,longTasks,...rest})=>({...rest,scriptCount:scripts?.length,longTasks:longTasks?.length})),errors,unknown},null,2));
}finally{await browser?.close();if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await new Promise(r=>api.close(r));await writeFile(state+'/'+label+'-server.log',logs);}
