import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2];
assert.ok(output&&evidence,'Provide an isolated production build and evidence directory');await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(root+'/package.json')('playwright');
const brand={name:'QiCore',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'菜单验收',loginDescription:''};
const branding={version:1,platform:brand,tenant:brand,copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
const permissions=['tenant:settings.read','tenant:settings.write','settings.read','consumers.read','orders.read','entitlements.read'];
const site={id:'fixture',name:'菜单验收',enabled:true,expiresAt:null,consoleRoutes:[],canViewOverview:false};
const session={id:'qa-user',userId:'qa-user',username:'fixture',nickname:'菜单验收',role:'tenant',roleName:'管理员',permissions,tenantIds:[site.id],tenantId:site.id,csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00.000Z'};
let documentTarget=true,delayScripts=false,releaseDocument,heldDocument; const held=new Promise(resolve=>heldDocument=resolve);
const errors=[],unknown=[],checks=[],calls=[];
const api=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname.replace('/api/v1','');calls.push(path);
 for await(const chunk of req){};
 let data;
 if(path==='/public/site')data=branding;
 else if(path==='/public/maintenance')data={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true};
 else if(path==='/admin/auth/me')data=session;
 else if(path==='/admin/tenant-entry'){
  const tenant={...site,consoleRoutes:documentTarget?[{path:'/tenant/help',label:'帮助中心',group:'content',icon:'i-lucide-circle-help',applicationKey:'fixture-app'}]:[]};
  data={tenant,tenants:[tenant],applications:[],application:null,access:'no-applications',canViewOverview:false,permissions};
 }
 else if(path==='/admin/tenants/fixture/branding')data={...branding,tenantId:site.id};
 else if(path==='/admin/tenants/fixture/help')data={applicationKey:'system',applications:[{key:'system',name:'公共内容'}],canWrite:true,categories:[],items:[],total:0,page:1,pageSize:20};
 else{unknown.push(path);res.statusCode=404;data={};}
 await new Promise(r=>setTimeout(r,80));res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_COMPONENTS:'{}',QICORE_DEV_WORKSPACE:'',NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='',browser,page;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const openInHtml=(html,key)=>new RegExp('id="zjz-sidebar-'+key+'"[^>]*data-open="true"').test(html);
try{
 for(let i=0;i<150;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{if(route.request().isNavigationRequest()&&new URL(route.request().url()).searchParams.has('__qicore_menu')){heldDocument();await new Promise(resolve=>releaseDocument=resolve)}if(delayScripts&&route.request().resourceType()==='script')await new Promise(r=>setTimeout(r,1500));await route.continue();});
 await page.addInitScript(()=>{
  const realNow=Date.now;Date.now=()=>realNow()+60000;window.__menuFrames=[];
  const sample=()=>{const nodes=['users','decoration','channels'].map(key=>document.getElementById('zjz-sidebar-'+key));if(nodes.every(Boolean)&&getComputedStyle(nodes[0]).display==='grid')window.__menuFrames.push(nodes.map(node=>({open:node.dataset.open==='true',height:node.getBoundingClientRect().height})));if(window.__menuFrames.length<250)requestAnimationFrame(sample)};requestAnimationFrame(sample);
 });
 await page.goto(origin+'/tenant/workbench');await page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false);
 for(const label of ['用户管理','装修管理','渠道管理','内容管理'])await page.getByRole('button',{name:label,exact:true}).click();
 await page.waitForTimeout(250);assert.equal((await context.cookies()).some(cookie=>cookie.name.startsWith('qicore-tenant-menu-handoff-')),false,'ordinary expansion does not create persistence');
 // The destination still uses a real production SSR page; the initial route
 // metadata makes the source take the same document handoff as an installed app.
 documentTarget=false;delayScripts=true;
 const responseReady=page.waitForResponse(response=>response.request().isNavigationRequest()&&new URL(response.url()).pathname==='/tenant/help'&&new URL(response.url()).searchParams.has('__qicore_menu'));
 const clicking=page.getByRole('link',{name:'帮助中心',exact:true}).click({noWaitAfter:true});await held;
 const freshTab=await context.newPage(),freshResponse=await freshTab.goto(origin+'/tenant/help',{referer:origin+'/tenant/workbench'});
 const freshHtml=await freshResponse.text();for(const key of ['users','decoration','channels'])assert.equal(openInHtml(freshHtml,key),false,'new tab does not inherit '+key);
 assert.equal((await context.cookies()).some(cookie=>cookie.name.startsWith('qicore-tenant-menu-handoff-')),true,'fresh tab does not consume another navigation');await freshTab.close();
 checks.push('simultaneous new tab initializes from route without consuming pending handoff');releaseDocument();await clicking;
 const response=await responseReady,html=await response.text();
 for(const key of ['users','decoration','channels','content'])assert.equal(openInHtml(html,key),true,'first HTML preserves '+key);
 checks.push('first SSR HTML preserves all expanded groups before JavaScript');
 await page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false);await page.waitForTimeout(300);
 const frames=await page.evaluate(()=>window.__menuFrames);assert.ok(frames.length>10,'sampled delayed hydration');
 assert.ok(frames.every(frame=>frame.every(group=>group.open&&group.height>0)),'no pre-hydration collapsed frame');
 checks.push('1500ms delayed hydration has no collapsed menu frame despite client clock +60s');
 await page.waitForFunction(()=>!new URL(location.href).searchParams.has('__qicore_menu'));assert.equal(page.url(),origin+'/tenant/help');
 assert.equal((await context.cookies()).some(cookie=>cookie.name.startsWith('qicore-tenant-menu-handoff-')),false,'one-shot hint consumed');
 assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());
 await page.screenshot({path:join(evidence,'document-navigation.png'),animations:'disabled'});
 delayScripts=false;const reload=await page.reload();const reloaded=await reload.text();
 assert.equal(openInHtml(reloaded,'content'),true);for(const key of ['users','decoration','channels'])assert.equal(openInHtml(reloaded,key),false,'refresh resets '+key);
 checks.push('refresh initializes only current route ancestors');
 await page.waitForFunction(()=>document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating===false);
 await page.getByRole('button',{name:'用户管理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-controls="zjz-sidebar-users"]')?.getAttribute('aria-expanded')==='true');await page.getByRole('link',{name:'工作台',exact:true}).click();await page.waitForURL('**/tenant/workbench');
 assert.equal(await page.getByRole('button',{name:'用户管理',exact:true}).getAttribute('aria-expanded'),'true');assert.equal(await page.getByRole('button',{name:'内容管理',exact:true}).getAttribute('aria-expanded'),'true');
 const workbenchReload=await page.reload();for(const key of ['users','decoration','channels','content'])assert.equal(openInHtml(await workbenchReload.text(),key),false);
 checks.push('in-document workbench navigation preserves groups; workbench refresh resets');
 assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
 await writeFile(join(evidence,'result.json'),JSON.stringify({checks,frameCount:frames.length,errors,unknown},null,2));console.log(JSON.stringify({checks,frameCount:frames.length}));
}catch(error){if(page)await page.screenshot({path:join(evidence,'failed.png'),animations:'disabled'}).catch(()=>{});await writeFile(join(evidence,'failed.json'),JSON.stringify({error:String(error),errors,unknown,calls,logs},null,2));throw error}
finally{await browser?.close();child.kill();await new Promise(r=>api.close(r));}
