import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createNativeUpdaterServer} from '../../dist/lifecycle/native-updater.js';
import {nativeLifecycleCapability,nativeUpdateCapability} from '../../dist/license/native-updates.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
export function applicationFlowAuthority({f,first,second,installRelease}){
 return async(path,body)=>{
  if(path.endsWith('/access'))return{accessToken:'fixture_access.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.equal(body.protocol,'license-api-v2');
  const now=Date.now(),timing={licenseRevision:f.client.status().receipt.revision,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+600000).toISOString()};
  if(path==='updates/plan'){
   assert.equal(body.capability,nativeUpdateCapability(f.client.product));assert.deepEqual(body.targetPackageKeys,['app_fixture']);
   return{signedPlan:f.envelope({...f.plan(second.release,body.installed,'app_fixture',body.capability),...timing})};
  }
  assert.equal(path,'updates/lifecycle/plan');assert.equal(body.capability,nativeLifecycleCapability(f.client.product));assert.equal(body.packageKey,'app_fixture');assert.ok(['install','repair'].includes(body.operation));
  const release=body.operation==='repair'?([first,second].find(item=>item.release.version===body.installed.find(c=>c.packageKey==='app_fixture').version)):installRelease();
  return {signedPlan:f.envelope({protocol:'license-api-v2',capability:nativeLifecycleCapability(f.client.product),operation:body.operation,key_id:'receipt',planId:'plan_'+randomUUID(),licenseId:'license-test',...timing,instanceId:f.client.identity().instanceId,productId:f.state.config.frameworkKey,domain:'127.0.0.1',packageKey:'app_fixture',installed:body.installed,release:release.release})};
 };
}
export async function verifyApplicationFlow({f,host,db,pkg,origin,apiBase}){
 const state=f.state,frameworkBefore=structuredClone(state.active(state.config.frameworkKey)),name='生命周期验收应用',applicationKey='lifecycle-fixture';
 const initialSql='CREATE TABLE AppLifecycleFixture (id INTEGER PRIMARY KEY, state VARCHAR(20) NOT NULL, value VARCHAR(60) NOT NULL);',nextSql='ALTER TABLE AppLifecycleFixture ADD note VARCHAR(60) NULL;';
 const make=(version,from)=>{
  const descriptor={format:'qicore-application-v1',key:applicationKey,packageKey:'app_fixture',version,name,pendingTasks:[{table:'AppLifecycleFixture',statusColumn:'state',pendingStates:['pending']}]};
  const scripts=[['20261019000000_fixture',initialSql],...(version==='1.1.0'?[['20261019000100_note',nextSql]]:[])];
  const files={'application.json':JSON.stringify(descriptor),'readme.txt':'original '+version,'server/main.mjs':`export const format='qicore-application-v1',version='${version}';export const definition={key:'${applicationKey}',name:'${name}',licensePackageKey:'app_fixture',permissions:['records.read'],defaultConfig:()=>({}),validateConfig:v=>v};export function createRuntime({db}){return{key:'${applicationKey}',consumerPaths:['records'],connect(){},async initialize(){await db.$queryRawUnsafe('SELECT 1 FROM AppLifecycleFixture LIMIT 1')},async tick(){},async admin(){throw Error('NOT_IMPLEMENTED')},async consumer(){throw Error('NOT_IMPLEMENTED')},async health(){await db.$queryRawUnsafe('SELECT 1 FROM AppLifecycleFixture LIMIT 1');return true},async close(){}}}`, ...Object.fromEntries(scripts.map(([id,sql])=>['migrations/'+id+'.sql',sql]))};
  return f.release('app_fixture',version,from,files,{frameworkRange:'^0.1.0',framework:{packageKey:state.config.frameworkKey,range:'^0.1.0'},migrations:scripts.map(([id,sql],order)=>({id,order,kind:'database',path:'migrations/'+id+'.sql',sha256:digest(sql),transactional:false,reversible:true}))});
 };
 const first=make('1.0.0','0.0.0'),second=make('1.1.0','1.0.0');let installRelease=first;
 f.client.machine=applicationFlowAuthority({f,first,second,installRelease:()=>installRelease});
 f.client.transport=async url=>{const selected=[first,second].find(item=>String(url).endsWith('/'+item.release.artifact.releaseId));assert.ok(selected,'only the two signed fixture archives are downloadable');return new Response(selected.archive,{headers:{'content-length':String(selected.archive.length)}})};
 const updater=createNativeUpdaterServer(state,f.client,host);await new Promise((ok,fail)=>{updater.once('error',fail);updater.listen(state.config.socket,ok)});
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const images=join(pkg,'ui-evidence');await mkdir(images,{recursive:true});
 const waitTask=async operation=>{
  for(let i=0;i<180;i++){const task=state.tasks().filter(t=>t.packageKey==='app_fixture'&&(operation==='update'?!t.operation:t.operation===operation)).at(-1);if(task&&task.status!=='running'){assert.equal(task.status,'succeeded',JSON.stringify(task));return task}await delay(500)}throw Error('application operation timeout');
 };
 const loadPage=async()=>{await page.goto(origin+'/admin/updates');await page.waitForLoadState('networkidle');await page.getByRole('heading',{name:'框架与应用',exact:true}).waitFor();assert.equal(await page.title(),'框架与应用 · 总后台 · QiCore')};
 try{
  const login=await page.request.post(apiBase+'/api/v1/admin/auth/login',{headers:{origin},data:{username:'installAdmin',password:'123456',portal:'admin'}});assert.equal(login.status(),200);
  await loadPage();await page.getByRole('tab',{name:'已经购买未安装（1）'}).click();await page.getByRole('button',{name:'安装',exact:true}).click();await page.getByRole('button',{name:'开始安装',exact:true}).waitFor();
  await page.screenshot({path:join(images,'application-install-desktop.png'),fullPage:true});await page.getByRole('button',{name:'开始安装',exact:true}).click();await waitTask('install');await loadPage();await page.getByText(name,{exact:true}).first().waitFor();
  assert.equal(state.active('app_fixture').current.version,'1.0.0');assert.deepEqual(state.active(state.config.frameworkKey),frameworkBefore);assert.equal((await(await fetch(state.config.healthUrl)).json()).components.app_fixture.version,'1.0.0');
  await db.$executeRawUnsafe("INSERT INTO AppLifecycleFixture(id,state,value) VALUES(1,'done','retained customer data')");
  await db.tenant.create({data:{id:'native-application-site',name:'保留的关联站点'}});await db.tenantApplication.create({data:{tenantId:'native-application-site',applicationKey,config:{retained:true}}});
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'更新',exact:true}).click();await waitTask('update');await loadPage();assert.equal(state.active('app_fixture').current.version,'1.1.0');assert.equal(state.active('app_fixture').previous,null);assert.equal((await readdir(join(state.directory('app_fixture'),'releases'))).length,1);
  await page.screenshot({path:join(images,'application-installed-desktop.png'),fullPage:true});
  const currentPath=state.path('app_fixture',state.active('app_fixture').current);await writeFile(join(currentPath,'readme.txt'),'preserve this local edit');
  await page.getByRole('button',{name:'修复'+name,exact:true}).click();await page.getByRole('button',{name:'开始修复',exact:true}).waitFor();await page.getByText('已修改或损坏：readme.txt',{exact:true}).waitFor();await page.screenshot({path:join(images,'application-repair-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'开始修复',exact:true}).click();const repair=await waitTask('repair');await page.getByText('已恢复：readme.txt',{exact:true}).waitFor();await assert.rejects(access(join(state.component('app_fixture').root,'repair-evidence-'+repair.id)));assert.equal(state.component('app_fixture').read('recovery-archive-'+repair.id+'.json').status,'removed');await state.verifyCurrent('app_fixture');await loadPage();assert.equal(state.active('app_fixture').current.version,'1.1.0');
  await db.$executeRawUnsafe("UPDATE AppLifecycleFixture SET state='pending' WHERE id=1");await page.getByRole('button',{name:'卸载',exact:true}).click();await page.getByText('请先处理未完成的支付、退款或应用任务',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保留数据并卸载',exact:true}).isEnabled(),false);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(images,'application-uninstall-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'取消',exact:true}).click();await db.$executeRawUnsafe("UPDATE AppLifecycleFixture SET state='done' WHERE id=1");
  const receipt=f.client.status().receipt;
  const renewFixture=(revision,entitlements)=>{const now=Date.now();f.client.acceptReceipt(f.envelope({...receipt,revision,entitlements,issued_at:new Date(now).toISOString(),refresh_after:new Date(now+60000).toISOString(),online_valid_until:new Date(now+3600000).toISOString(),grace_until:new Date(now+7200000).toISOString()}))};
  renewFixture(2,receipt.entitlements.map(item=>item.packageKey==='app_fixture'?{...item,useExpiresAt:new Date(Date.now()-60000).toISOString()}:item));
  await loadPage();await page.getByRole('button',{name:'卸载',exact:true}).click();await page.getByRole('button',{name:'保留数据并卸载',exact:true}).click();await waitTask('uninstall');assert.equal(state.active('app_fixture'),null);assert.equal((await(await fetch(state.config.healthUrl)).json()).components.app_fixture,undefined);
  assert.equal(await db.tenantApplication.count(),1);assert.equal((await db.$queryRawUnsafe('SELECT value FROM AppLifecycleFixture WHERE id=1'))[0].value,'retained customer data');
  renewFixture(3,receipt.entitlements);installRelease=second;
  await loadPage();await page.getByRole('tab',{name:'已经购买未安装（1）'}).click();await page.getByRole('button',{name:'安装',exact:true}).click();await page.getByRole('button',{name:'开始安装',exact:true}).click();
  for(let i=0;i<180;i++){if(state.active('app_fixture')?.current.version==='1.1.0'&&state.tasks().filter(t=>t.operation==='install').length===2&&state.tasks().filter(t=>t.operation==='install').at(-1)?.status==='succeeded')break;if(i===179)throw Error('reinstall timeout');await delay(500)}
  assert.equal((await db.$queryRawUnsafe('SELECT value FROM AppLifecycleFixture WHERE id=1'))[0].value,'retained customer data');assert.equal((await db.$queryRawUnsafe("SELECT COUNT(*) AS total FROM _qicore_migrations WHERE package_key='app_fixture'"))[0].total,2n);assert.deepEqual(state.active(state.config.frameworkKey),frameworkBefore);
  await host.stop();await host.start();await host.health('app_fixture','1.1.0',second.release.artifact.manifestSha256);assert.deepEqual(errors,[]);
  await writeFile(join(pkg,'application-lifecycle-report.json'),JSON.stringify({status:'passed',application:'signed isolated fixture, not a real business application',operations:['install','update','repair','uninstall','reinstall','restart'],actualRuntimeLoading:true,frameworkUnchanged:true,preserved:['database rows','tenant binding','configuration','repair difference audit'],pendingTaskUninstall:'blocked',expiredApplicationUninstall:'passed',currentOnly:true,migrationCount:2,pageErrors:errors},null,2)+'\n');
 }finally{await browser.close();await new Promise(ok=>updater.close(ok))}
}
