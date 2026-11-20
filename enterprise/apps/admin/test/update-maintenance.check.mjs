import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {updatePreview} from '../app/utils/update-preview.ts';
const output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2];assert.ok(output&&evidence);await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(new URL('../../../package.json',import.meta.url))('playwright');
const brand={name:'QiCore',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'控制台验收',loginDescription:''};
const session={id:'qa-admin',username:'qa-admin',nickname:'验收',role:'root',roleName:'管理员',permissions:['overview.read','services.read','services.update','backups.read','backups.create','backups.download'],tenantIds:[],csrfToken:'qa',expiresAt:'2099-01-01T00:00:00.000Z'};
const notes='【新增：这是普通标题】\n新增：蓝色能力\n修复：绿色修复\n优化：橙黄色说明\n安全：红色安全\n调整：灰色调整\n\n<script>window.untrusted=true</script>\n'+('普通说明：保留长正文与换行。'.repeat(12)+'\n').repeat(8)+'小程序更新：需要客户自行上传';
const updates=updatePreview('current');updates.productName='QiCore';updates.packageKey='frm_qa';updates.applications.installed=[];updates.applications.purchased[0]={...updates.applications.purchased[0],name:'验收应用',management:{available:true,canInstall:true,reason:''}};
let status={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true,startedAt:null,estimatedSeconds:null},available=true,backupReady=false,delay=0,child,browser,page;
const calls=[],checks=[],errors=[];
const record={id:'backup-00000000-0000-4000-8000-000000000001',source:'manual',actorName:'验收',version:'0.1.0',createdAt:'2026-10-25T01:02:03Z',finishedAt:'2026-10-25T01:02:04Z',deleteBlocked:null,status:'completed',stage:'complete',bytes:1024,sha256:'a'.repeat(64),verification:'passed',verifiedAt:'2026-10-25T01:02:04Z',error:null};
const api=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname.replace('/api/v1','');calls.push({path,method:req.method});
 if(!available){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'APPLICATION_MAINTENANCE',message:'系统正在更新'}}));return;}
 let data;if(delay)await new Promise(r=>setTimeout(r,delay));
 if(path==='/public/site')data={version:1,platform:brand,tenant:brand,copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''}};
 else if(path==='/admin/auth/me')data=session;
 else if(path==='/admin/updates')data=updates;
 else if(path==='/admin/license/status')data={allowed:true,canCheck:true,license:updates.license,update:updates.update};
 else if(path==='/admin/backups')data=req.method==='POST'?record:{ready:backupReady,message:backupReady?'数据库备份服务可用':'备份目录或密钥不可读写，请检查运行用户及父目录权限',automaticBeforeUpdate:backupReady,running:false,total:1,items:[record]};
 else if(path.endsWith('/verify'))data=record;
 else if(path==='/admin/updates/applications/check')data={targetVersion:'0.1.0',manifestSha256:'a'.repeat(64),tenants:0,pending:0,integrity:[],releaseNotes:notes};
 else if(path==='/public/h5/runtime')data={contentSource:'framework',tenantId:'qa',applicationKey:'system',apiBase:'/api/v1',siteName:'验收站点',homeTitle:'验收首页',profileTitle:'个人中心',registration:{passwordLoginEnabled:true,autoRegister:false}};
 else if(path==='/apps/system/wallet')data={points:{amount:10,version:1,unit:'POINT'},balance:{amount:1234,version:1,unit:'CNY_CENT'}};
 else if(path==='/apps/system/recharge/catalog')data={version:1,points:[],balance:{tiers:[],customEnabled:true,minCents:1,maxCents:1000000}};
 else if(path==='/apps/system/recharge/orders/original-order'||path.startsWith('/apps/system/recharge/orders/by-request/'))data={id:'original-order',status:'pending'};
 else{res.statusCode=404;data=null;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
});
const listen=server=>new Promise(ok=>server.listen(0,'127.0.0.1',ok));await listen(api);
const reserve=createServer();await listen(reserve);const ssrPort=reserve.address().port;await new Promise(ok=>reserve.close(ok));
const gateway=createServer((req,res)=>{
 if(req.url==='/api/v1/public/maintenance'){calls.push({path:'/public/maintenance',method:req.method});res.setHeader('content-type','application/json');res.end(JSON.stringify({data:status}));return;}
 const proxy=request({host:'127.0.0.1',port:req.url.startsWith('/api/')?api.address().port:ssrPort,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});
 proxy.on('error',()=>{res.statusCode=502;res.end('upstream unavailable')});req.pipe(proxy);
});await listen(gateway);const origin='http://127.0.0.1:'+gateway.address().port;
async function start(){child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,HOST:'127.0.0.1',PORT:String(ssrPort),PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',NODE_ENV:'production',QICORE_DEV_WORKSPACE:'',QICORE_COMPONENTS:'{}'},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.resume();child.stderr.on('data',data=>errors.push(String(data)));for(let i=0;i<150;i++){try{const response=await fetch('http://127.0.0.1:'+ssrPort+'/brand/qicore.png');if(response.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('SSR_NOT_READY')}
async function stop(){if(child&&child.exitCode===null)await new Promise(ok=>{child.once('exit',ok);child.kill()})}
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
try{
 await start();browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(origin+'/admin/data-security');await page.getByText('备份目录或密钥不可读写，请检查运行用户及父目录权限',{exact:true}).waitFor();
 assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());assert.ok(await page.getByRole('button',{name:'新建备份',exact:true}).isDisabled());
 await page.screenshot({path:join(evidence,'backup-unavailable.png'),fullPage:true});checks.push('备份不可用原因、禁用创建、短状态与首屏标题');
 backupReady=true;await page.reload();await page.getByRole('button',{name:'新建备份',exact:true}).click();delay=700;await page.getByRole('button',{name:'开始备份',exact:true}).click();await wait(150);
 assert.equal(await page.locator('button').filter({has:page.locator('.animate-spin')}).count(),1);await page.getByRole('dialog').waitFor({state:'hidden'});delay=0;checks.push('延迟创建备份仅确认动作 loading，刷新不跟随旋转');
 await page.getByRole('link',{name:'框架与应用',exact:true}).click();await page.waitForURL('**/admin/updates');await page.getByRole('heading',{name:'框架与应用',exact:true}).waitFor();const routeTitle=await page.title(),rawTitle=(await (await fetch(origin+'/admin/updates')).text()).match(/<title>(.*?)<\/title>/)[1];assert.equal(routeTitle,rawTitle);await page.reload();assert.equal(await page.title(),routeTitle);await page.getByRole('tab',{name:/已经购买未安装/}).click();await page.getByRole('button',{name:'安装',exact:true}).click();await page.getByText('小程序需要客户自行上传',{exact:true}).waitFor();
 const dialog=page.getByRole('dialog').last();assert.equal(await dialog.getByText('小程序需要客户自行上传',{exact:true}).count(),1);assert.equal(await page.evaluate(()=>window.untrusted),undefined);
 assert.ok(await dialog.getByText('<script>window.untrusted=true</script>',{exact:true}).isVisible());assert.equal(await dialog.getByText('新增：这是普通标题',{exact:true}).locator('..').locator('[data-slot=base]').count(),0);
 await page.screenshot({path:join(evidence,'install-notes-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(evidence,'install-notes-mobile.png'),fullPage:true});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));checks.push('安装应用日志五类颜色、普通标题、HTML安全文本、单独提醒、长文窄屏');
 assert.equal(calls.filter(c=>c.path==='/public/maintenance').length,0,'console must not use global maintenance polling');checks.push('后台无新增全局维护提示、状态轮询或恢复自动重载');
 await page.getByRole('dialog').last().getByRole('button',{name:'取消',exact:true}).click();await page.setViewportSize({width:1280,height:900});
 const task={id:'framework-refresh-check',packageKey:'frm_qa',operation:'update',status:'running',step:'HEALTH',version:'0.2.0',fromVersion:'0.1.0',updatedAt:'2026-10-25T01:02:03Z'};updates.tasks=[task];
 const framework=()=>page.getByRole('region',{name:'框架更新进度',exact:true});
 const refresh=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/admin/updates'));await page.getByRole('button',{name:'刷新当前页面',exact:true}).click();await response;await wait(80)};
 await page.goto(origin+'/admin/updates');await framework().waitFor();await refresh();assert.ok(await framework().isVisible());checks.push('框架运行中浏览器刷新和顶部刷新均恢复显示');
 updates.tasks=[{...task,status:'succeeded',step:'COMPLETE'}];await framework().getByText('更新完成',{exact:true}).waitFor({timeout:20000});assert.ok(await framework().isVisible());await refresh();await framework().waitFor({state:'hidden'});assert.equal(updates.tasks.length,1);await page.reload();assert.equal(await framework().count(),0);checks.push('框架当次完成结果保留，顶部刷新和浏览器刷新隐藏成功展示且任务记录保留');
 updates.tasks=[{...task,status:'recovery_required',step:'CLEANUP',code:'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED',businessAvailable:true}];await page.reload();await framework().waitFor();await refresh();assert.ok(await framework().isVisible());checks.push('框架待恢复任务浏览器刷新和顶部刷新均继续显示');
 updates.tasks=[];await page.close();
 for(const [file,folder] of [['update-center-flows.check.mjs','flows'],['update-history-details.check.mjs','history']]){const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./'+file,import.meta.url)),join(evidence,folder)],{env:{...process.env,UPDATE_PREVIEW_ORIGIN:origin},maxBuffer:4*1024*1024,windowsHide:true});console.log(result.stdout)}checks.push('五种流程和内联历史在本任务独立API/SSR夹具内复验');
 const pauseMs=null;
 await writeFile(join(evidence,'browser-check.json'),JSON.stringify({at:new Date().toISOString(),checks,pauseMs,requests:calls,errors,scope:'local real admin SSR with isolated API fixtures; client checked separately'},null,2));console.log(JSON.stringify({checks,pauseMs,errors}));
}catch(error){console.error(error);if(page&&!page.isClosed())await page.screenshot({path:join(evidence,'browser-failed.png'),fullPage:true}).catch(()=>{});await writeFile(join(evidence,'browser-failure.json'),JSON.stringify({error:String(error),checks,calls,errors},null,2));process.exitCode=1}
finally{await browser?.close();await stop();for(const server of [gateway,api])await new Promise(ok=>{server.close(ok);server.closeAllConnections()})}
