import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {updatePreview} from '../app/utils/update-preview.ts';
const {chromium}=createRequire(new URL('../../../package.json',import.meta.url))('playwright'),origin=process.env.UPDATE_PREVIEW_ORIGIN||'http://127.0.0.1:3589',evidence=process.argv[2];assert.equal(new URL(origin).hostname,'127.0.0.1');assert.ok(evidence);await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),checks=[],errors=[];
try{
 for(const operation of ['install','repair','uninstall','app-update','framework-update']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const state=updatePreview(operation==='framework-update'?'available':'current');state.productName='QiCore';state.packageKey='frm_qa';state.backups={ready:true};state.update.manifestSha256='a'.repeat(64);
  const sample=state.applications.purchased[0],app={...sample,packageKey:'app_qa',key:'qa',name:'验收应用',description:'',source:operation==='install'?'catalog':'native',version:operation==='install'?null:'0.1.0',license:{...sample.license,label:'授权正常',tenantUsed:2},update:{state:operation==='app-update'?'available':'current',label:operation==='app-update'?'发现新版本':'已是最新版本',currentVersion:'0.1.0',latestVersion:operation==='app-update'?'0.2.0':null,canCheck:true,manifestSha256:'b'.repeat(64),releaseNotes:'新增：能力\n修复：问题\n优化：体验\n调整：第四条\n小程序更新：需要客户自行上传',files:[]},management:{available:true,canInstall:true,canRepair:true,canUninstall:true,reason:''},history:{available:true,items:[]}};
  state.applications.installed=operation==='install'?[]:[app];state.applications.purchased=operation==='install'?[app]:[];state.tasks=[];let executions=0,prechecks=0;
  await page.route('**/api/v1/admin/**',async route=>{const path=new URL(route.request().url()).pathname.replace('/api/v1','');let data;
   if(path==='/admin/updates')data=state;
   else if(path==='/admin/updates/applications/check'){prechecks++;data={targetVersion:'0.1.0',manifestSha256:'b'.repeat(64),releaseNotes:app.update.releaseNotes,tenants:2,pending:0,integrity:[]};}
   else if(['/admin/updates/execute','/admin/updates/applications/execute'].includes(path)){executions++;const body=route.request().postDataJSON();state.tasks=[{id:body.requestId,packageKey:body.packageKey,operation:body.operation||'update',status:'running',step:'PULL',version:body.targetVersion,fromVersion:operation==='install'?null:'0.1.0',updatedAt:'2026-10-25T01:02:03Z'}];Object.assign(app.management,{available:false,canInstall:false,canRepair:false,canUninstall:false});state.installer.canInstall=false;data={accepted:true};}
   else{await route.continue();return}await route.fulfill({json:{data}});
  });
  async function refresh(){const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/admin/updates'));await page.getByRole('button',{name:'刷新当前页面',exact:true}).click();await response;await page.waitForTimeout(80)}
  const modal=()=>page.getByRole('dialog').last();const close=async()=>{await modal().getByRole('button',{name:'关闭',exact:true}).last().click();await page.getByRole('dialog').waitFor({state:'hidden'})};
  await page.goto(origin+'/admin/updates');await page.getByRole('heading',{name:'框架与应用',exact:true}).waitFor();await refresh();
  assert.equal(await page.getByRole('button',{name:/任务记录|查看进度/}).count(),0);assert.equal(await page.getByText('剩余额度',{exact:true}).count(),0);
  if(operation==='framework-update'){
   await page.getByRole('button',{name:'更新框架',exact:true}).click();await page.getByRole('region',{name:'框架更新进度',exact:true}).getByText('正在更新',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
   state.tasks[0]={...state.tasks[0],status:'recovery_required',step:'CLEANUP',code:'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED',businessAvailable:true};state.update.state='current';state.update.latestVersion=null;await refresh();await page.getByRole('region',{name:'框架更新进度',exact:true}).getByRole('button',{name:'收起',exact:true}).click();await page.getByRole('button',{name:'更新框架',exact:true}).click();assert.equal(executions,1);await page.getByRole('region',{name:'框架更新进度',exact:true}).waitFor();
   await page.screenshot({path:join(evidence,'framework-inline-closeout.png'),fullPage:true});checks.push('框架进度仅在顶部卡片下方，待收尾收起后原更新入口重开且不重复执行');await page.close();continue;
  }
  if(operation==='install'){await page.getByRole('tab',{name:/已经购买未安装/}).click();assert.equal(await page.getByRole('button',{name:'更新日志',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'详情',exact:true}).count(),0);await page.getByRole('button',{name:'安装',exact:true}).click();await modal().getByRole('button',{name:'开始安装',exact:true}).click();}
  else if(operation==='repair'){await page.getByRole('button',{name:'修复验收应用',exact:true}).click();await modal().getByRole('button',{name:'开始修复',exact:true}).click();}
  else if(operation==='uninstall'){await page.getByRole('button',{name:'卸载',exact:true}).click();await modal().getByRole('button',{name:'保留数据并卸载',exact:true}).click();}
  else await page.getByRole('button',{name:'更新',exact:true}).click();
  await modal().locator('.progress-steps').waitFor();assert.equal(await modal().locator('.progress-steps li').count(),5);assert.equal(await page.getByRole('region',{name:'框架更新进度',exact:true}).count(),0);assert.equal(await modal().getByRole('list',{name:'其他历史任务',exact:true}).count(),0);
  if(operation==='install')assert.ok((await modal().innerText()).includes('安装版本 v0.1.0'));assert.ok(!(await modal().innerText()).includes('v—'));await close();await refresh();assert.equal(await page.getByRole('dialog').count(),0);
  if(operation==='install'){state.applications.installed=[{...app,version:'0.1.0',source:'native'}];state.applications.purchased=[];}
  if(operation==='uninstall'){state.applications.installed=[];state.applications.purchased=[{...app,version:null,source:'catalog'}];}
  state.tasks[0]={...state.tasks[0],status:'recovery_required',step:'CLEANUP',code:'ACTIVE_HEALTHY_CLOSEOUT_BLOCKED',businessAvailable:true};await refresh();await page.getByRole('tab',{name:operation==='uninstall'?/已经购买未安装/:/已经安装/}).click();
  const action={install:'安装',repair:'修复',uninstall:'卸载','app-update':'更新'}[operation];await page.getByRole('button',{name:action,exact:true}).click();await modal().locator('.progress-steps').waitFor();assert.equal(executions,1);assert.equal(prechecks,operation==='app-update'?0:1);await page.screenshot({path:join(evidence,'application-'+operation+'-closeout.png'),fullPage:true});checks.push(operation+'：卡片阶段、弹窗关闭不自动重开、跨安装分组按原操作重开、不重复POST');await close();
  state.tasks[0]={...state.tasks[0],status:'succeeded',step:'COMPLETE',code:undefined};Object.assign(app.management,{available:true,canInstall:true,canRepair:true,canUninstall:true});await page.close();
 }
 await writeFile(join(evidence,'update-center-flows.json'),JSON.stringify({at:new Date().toISOString(),origin,isolatedBrowserApi:true,checks,errors},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify(checks));
}finally{await browser.close()}
