import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const output=process.env.TEST_ADMIN_OUTPUT_DIR,evidence=process.argv[2];
assert.ok(output&&evidence);await mkdir(evidence,{recursive:true});
const {chromium}=createRequire(new URL('../../../package.json',import.meta.url))('playwright');
const brand={name:'QiCore',logo:null,favicon:null,defaultAvatar:null,loginImage:null,loginTitle:'验收',loginDescription:''};
const branding={version:1,platform:brand,tenant:brand,copyright:'',filing:{}};
const permissions=['tenant:settings.read','tenant:settings.write'];
const site={id:'fixture',name:'验收站点',enabled:true,expiresAt:null,consoleRoutes:[],canViewOverview:false};
const session={id:'qa',userId:'qa',username:'qa',nickname:'验收',role:'tenant',roleName:'管理员',permissions,tenantIds:['fixture'],tenantId:'fixture',csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00.000Z'};
const project={projectId:'project',templateId:'template',version:'0.1.2',name:'验收版本',artifactSha256:'a'.repeat(64)};
const config={uploadSupported:true,applicationKey:'fixture-app',applications:[{key:'fixture-app',name:'测试应用'}],version:3,config:{enabled:true,displayName:'测试',originalId:'',appId:'wx1234567890abcdef',versionDescription:'',qrMaterialId:null},hasAppSecret:true,hasUploadPrivateKey:true,domains:{available:true,request:'https://fixture.example',uploadFile:'https://fixture.example',downloadFile:'https://fixture.example',socket:'',udp:'',business:'https://fixture.example',message:''},paymentEnabled:false,paymentAppId:'',canWrite:true};
const root='/admin/tenants/fixture/mini-program',endpoint=root+'/fixture-app';
let task=null,finish=false,failNext=false;const calls=[],unknown=[],errors=[],checks=[];
const qr='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eff6ff"/><text x="128" y="128" text-anchor="middle" fill="#1d4ed8" font-size="18">测试预览图（仅验收）</text></svg>').toString('base64');
const api=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname.replace('/api/v1','');let body;const chunks=[];for await(const c of req)chunks.push(c);if(chunks.length)body=JSON.parse(Buffer.concat(chunks));calls.push({path,method:req.method});
 await new Promise(r=>setTimeout(r,450));let data;
 try{
  if(path==='/public/site')data=branding;
  else if(path==='/public/maintenance')data={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true};
  else if(path==='/admin/auth/me')data=session;
  else if(path==='/admin/tenant-entry')data={tenant:site,tenants:[site],applications:[],application:null,access:'no-applications',permissions,canViewOverview:false};
  else if(path==='/admin/tenants/fixture/branding')data={...branding,tenantId:'fixture'};
  else if(path===root)data=config;
  else if(path===endpoint+'/upload-catalog')data={projects:[project],ready:true};
  else if(path===endpoint+'/upload-tasks'&&req.method==='GET')data={items:task?[task]:[],total:task?1:0};
  else if(path===endpoint+'/upload-tasks'&&req.method==='POST'){
   task={...body,status:'RUNNING',progress:35,message:'正在处理',qrCode:null};
   if(failNext){failNext=false;res.statusCode=503;throw Error('提交响应中断')}
   data=task;
  }else if(path.endsWith('/refresh')){if(finish)task={...task,status:'SUCCEEDED',progress:100,qrCode:task.action==='preview'?qr:null};data=task;}
  else if(path===endpoint&&req.method==='PUT'){assert.equal(body.clearUploadPrivateKey,undefined);assert.equal(body.uploadPrivateKey,'');Object.assign(config,{version:4,config:body.config});data=config;}
  else{unknown.push(path);res.statusCode=404;throw Error('Unknown fixture route')}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));
 }catch(e){res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:e.message}}));}
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[join(output,'server/index.mjs')],{cwd:output,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ADMIN_ORIGIN:origin,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+api.address().port+'/api/v1',QICORE_COMPONENTS:'{}',QICORE_DEV_WORKSPACE:'',NODE_ENV:'production'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='',browser,page;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 for(let i=0;i<100;i++){try{await fetch(origin+'/brand/qicore.png');break}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(origin+'/tenant/mini-program');await page.getByRole('button',{name:'获取版本',exact:true}).waitFor();await page.waitForLoadState('networkidle');
 assert.equal((await response.text()).match(/<title>(.*?)<\/title>/)[1],await page.title());assert.equal(await page.getByText('上传记录',{exact:true}).count(),0);assert.equal(await page.getByText('清除已保存的上传密钥',{exact:true}).count(),0);
 await page.getByRole('button',{name:'获取版本',exact:true}).click();await page.waitForLoadState('networkidle');
 const preview=page.getByRole('button',{name:'生成预览',exact:true,includeHidden:true}),upload=page.getByRole('button',{name:'上传体验版',exact:true,includeHidden:true});
 await preview.click();await page.getByRole('dialog').waitFor();assert.equal(await preview.locator('.animate-spin').count(),1);assert.equal(await upload.locator('.animate-spin').count(),0);assert.equal(await page.getByRole('img',{name:'小程序预览二维码'}).count(),0);
 await page.getByText('35%',{exact:true}).waitFor();await page.screenshot({path:join(evidence,'preview-generating.png')});
 finish=true;await page.getByRole('img',{name:'小程序预览二维码'}).waitFor({timeout:12000});assert.equal(await preview.locator('.animate-spin').count(),0);assert.equal(calls.filter(c=>c.path===endpoint+'/upload-tasks'&&c.method==='POST').length,1);
 await page.screenshot({path:join(evidence,'preview-result.png')});checks.push('immediate dialog, isolated loading, automatic preview result, no history or clear-key control');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});finish=false;
 await upload.click();await page.getByText('35%',{exact:true}).waitFor();assert.equal(await upload.locator('.animate-spin').count(),1);assert.equal(await preview.locator('.animate-spin').count(),0);
 await page.reload();await page.getByRole('dialog').waitFor();await page.getByText('35%',{exact:true}).waitFor();finish=true;await page.getByText('体验版上传完成',{exact:true}).waitFor({timeout:12000});checks.push('upload progress and reload recovery');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('textbox',{name:'小程序名称',exact:true}).fill('改名验证');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByText('小程序配置已保存',{exact:true}).waitFor();checks.push('blank saved key preserved');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'查看上传进度',exact:true}).click();await page.screenshot({path:join(evidence,'mobile-result.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('mobile width');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.waitForFunction(()=>getComputedStyle(document.body).pointerEvents!=='none');await page.setViewportSize({width:1440,height:1000});
 // Keep the live Vue tree intact so the closing dialog can release its pointer lock.
 await page.evaluate(()=>{const fixture=document.createElement('section');fixture.id='sticky-table-fixture';fixture.className='qisvc-data-table';fixture.style.cssText='margin:40px 0;width:800px;max-width:100%;background:var(--ui-bg)';fixture.innerHTML='<div id="table-scroll" style="overflow:auto"><table style="width:1200px;border-collapse:collapse"><thead><tr><th style="height:48px;text-align:left">名称</th><th class="sticky bg-default" style="position:sticky;right:0;width:180px;text-align:left">操作</th></tr></thead><tbody><tr><td style="height:64px">验收记录</td><td class="sticky bg-default" style="position:sticky;right:0">编辑　停用　删除</td></tr></tbody></table></div>';document.querySelector('.qisvc-console-stage').append(fixture)});
 const colors=()=>page.evaluate(()=>{const fixture=document.querySelector('#sticky-table-fixture'),s=x=>getComputedStyle(fixture.querySelector(x)).backgroundColor;return{head:s('thead'),fixedHead:s('th.sticky'),row:s('tbody tr'),fixedCell:s('td.sticky'),hovered:fixture.querySelector('tbody tr').matches(':hover')}});
 for(const dark of [false,true]){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);await page.locator('#sticky-table-fixture tbody td').first().hover();const c=await colors();assert.equal(c.hovered,true);assert.equal(c.head,c.fixedHead);assert.equal(c.row,c.fixedCell);await page.screenshot({path:join(evidence,'sticky-'+(dark?'dark':'light')+'.png')});}
 checks.push('opaque sticky header and hovered row match in light/dark');assert.deepEqual(unknown,[]);assert.deepEqual(errors,[]);
 await writeFile(join(evidence,'result.json'),JSON.stringify({checks,calls,errors,unknown,fixtureOnly:true},null,2));console.log(JSON.stringify({passed:checks}));
}catch(e){if(page)await page.screenshot({path:join(evidence,'failed.png')}).catch(()=>{});await writeFile(join(evidence,'failure.json'),JSON.stringify({error:e.stack,unknown,errors,logs},null,2));throw e}
finally{await browser?.close();child.kill();api.closeAllConnections();await new Promise(r=>api.close(r));}
