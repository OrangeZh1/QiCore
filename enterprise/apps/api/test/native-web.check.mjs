import {test} from 'node:test';
import {startBootstrapNginx} from './fixtures/nginx-bootstrap.mjs';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,cp,appendFile,chmod,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {randomUUID,createHash,createPublicKey,verify} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {PrismaClient} from '@prisma/client';
import {fixture} from './fixtures/native-release.mjs';
import {testMysqlClient,testDatabaseAccount} from './fixtures/mysql-tools.mjs';
import {bootstrapSigningMessage,canonicalJson} from '../dist/license/contracts.js';
import {extractCustomerInstallZip} from './fixtures/customer-install-package.mjs';

const customerMode=!!process.env.QICORE_CUSTOMER_INSTALL_ZIP;
if(customerMode){assert.equal(process.platform,'linux');assert.equal(new URL(process.env.REDIS_URL).hostname,'127.0.0.1');assert.ok(isAbsolute(process.env.QICORE_CUSTOMER_INSTALL_ZIP));assert.ok(isAbsolute(process.env.QICORE_WEB_EVIDENCE_DIR||''))}
assert.equal(customerMode,!!process.env.QICORE_CUSTOMER_INSTALL_SHA256,'Customer ZIP and SHA256 must be supplied together');
for(const key of [...(customerMode?['QICORE_WEB_EVIDENCE_DIR']:['NATIVE_PACKAGE_DIR']),'TEST_DATABASE_URL','TEST_RESTORE_ROOT_CONFIG','REDIS_URL'])assert.ok(process.env[key],key+' required');
const freePort=()=>new Promise(ok=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>ok(port))})});
const stop=async child=>{if(!child)return;if(child.exitCode!==null||child.signalCode!==null){if(customerMode)assert.equal(child.exitCode,0);return;}await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('controller did not stop')),80000);child.once('exit',code=>{clearTimeout(timer);if(customerMode&&code!==0)fail(Error('WEB_LAUNCHER_STOP_FAILED'));else ok()});child.kill('SIGTERM')})};

test('packaged web installer activates verified rights, completes the browser flow and restarts through the stable locked entry',{timeout:300000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-web-install-'));let managed=false;
 t.after(async()=>{if(!managed)await rm(root,{recursive:true,force:true})});
 const customer=customerMode?await extractCustomerInstallZip(resolve(process.env.QICORE_CUSTOMER_INSTALL_ZIP),process.env.QICORE_CUSTOMER_INSTALL_SHA256,join(root,'bundle')):null;
 const pkg=customer?.root??resolve(process.env.NATIVE_PACKAGE_DIR),manifest=customer?.manifest??JSON.parse(await readFile(join(pkg,'release-manifest.json'),'utf8')),packageReport=customer?null:JSON.parse(await readFile(join(pkg,'package-report.json'),'utf8'));
 const evidence=customerMode?resolve(process.env.QICORE_WEB_EVIDENCE_DIR):pkg;
 if(customerMode){const r=relative(root,evidence);assert.ok(r==='..'||r.startsWith('../')||r.startsWith('..\\')||isAbsolute(r),'Evidence must be outside the extracted customer package');await mkdir(evidence,{recursive:true});await chmod(root,0o755)}
 const f=fixture(root,{frameworkKey:manifest.package_key,version:manifest.version,initial:true});
 const bootstrap=join(root,'bundle/bootstrap');if(!customer)await cp(join(pkg,'bootstrap'),bootstrap,{recursive:true});
 const preload=fileURLToPath(new URL('./fixtures/native-web-network.mjs',import.meta.url));
 const template=f.client.status().receipt;f.client.store.remove('receipt.json');let revision=1,activationCalls=0,bindingCalls=0;const reports=[],challengeToken='challenge_'+randomUUID().replaceAll('-','');
 const transport=async(url,init)=>{
  assert.equal(new URL(url).hostname,'license.example');const body=JSON.parse(init.body),path=new URL(url).pathname;const identity=f.client.identity();
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(identity.publicKey,'base64url')]),format:'der',type:'spki'});
  if(path.endsWith('/license/bootstrap')){activationCalls++;const {signature,...payload}=body;assert.ok(verify(null,Buffer.from(bootstrapSigningMessage(payload)),key,Buffer.from(signature,'base64url')));assert.equal(body.domain,'127.0.0.1');return Response.json({instanceId:identity.instanceId,status:'binding_required',requestId:'binding_fixture',challenge:{domain:'127.0.0.1',path:'/.well-known/qilicense-challenge',token:challengeToken,expiresAt:new Date(Date.now()+300000).toISOString()}})}
  else{const signed=`${body.instanceId}\n${body.timestamp}\n${body.nonce}\n${createHash('sha256').update(canonicalJson(body.payload)).digest('hex')}`;assert.ok(verify(null,Buffer.from(signed),key,Buffer.from(body.signature,'base64url')))}
  if(path.endsWith('/license/installation/report')){reports.push(body.payload);return Response.json({accepted:true,attemptId:body.payload.attemptId,sequence:body.payload.sequence})}
  if(path.endsWith('/license/binding/challenge')){bindingCalls++;assert.deepEqual(JSON.parse(await readFile(join(root,'bundle/.well-known/qilicense-challenge'),'utf8')),{token:challengeToken});const response=await fetch(origin+'/.well-known/qilicense-challenge?token='+challengeToken);assert.equal(response.status,200);assert.deepEqual(await response.json(),{token:challengeToken});const dynamic='http://127.0.0.1:'+adminPort+'/.well-known/qilicense-challenge';assert.equal((await fetch(dynamic+'?token='+challengeToken,{headers:{host:new URL(origin).host}})).status,200);assert.equal((await fetch(dynamic+'?token=wrong',{headers:{host:new URL(origin).host}})).status,401)}
  assert.ok(path.endsWith('/license/binding/challenge')||path.endsWith('/license/renew'),'unexpected external request: '+path);
  const now=Date.now(),receipt=f.envelope({...template,revision:revision++,issued_at:new Date(now).toISOString(),refresh_after:new Date(now+300000).toISOString(),online_valid_until:new Date(now+3600000).toISOString(),grace_until:new Date(now+7200000).toISOString()});
  return Response.json({instanceId:identity.instanceId,receipt});
 };
 const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');const name='qicore_web_qa_'+randomUUID().replaceAll('-','').slice(0,16);assert.match(name,/^qicore_web_qa_[a-f0-9]{16}$/);url.pathname='/'+name;
 const rootSql=sql=>{const r=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:sql,encoding:'utf8'});assert.equal(r.status,0,'isolated schema operation failed')};
 let controller,browser,entry,nginx,created=false;const db=new PrismaClient({datasources:{db:{url:url.href}}});
 t.after(async()=>{await browser?.close();await controller?.close();await stop(entry);await nginx?.close();await db.$disconnect();if(created)rootSql('DROP DATABASE `'+name+'`; REVOKE ALL PRIVILEGES ON `'+name+'`.* FROM '+testDatabaseAccount()+';');assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/qicore-web-install-'));await rm(root,{recursive:true,force:true})});managed=true;
 rootSql('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+name+'`.* TO '+testDatabaseAccount()+';');created=true;
 const apiPort=await freePort(),adminPort=await freePort(),uiPort=await freePort(),publicPort=await freePort(),origin='http://127.0.0.1:'+publicPort;
 const {migrationUrl:_,...native}=f.state.config;Object.assign(native,{healthUrl:'http://127.0.0.1:'+apiPort+'/health',loginUrl:'http://127.0.0.1:'+uiPort+'/admin/login',runtimeUid:customerMode?Number(process.env.QICORE_TEST_RUNTIME_UID):process.getuid(),runtimeGid:customerMode?Number(process.env.QICORE_TEST_RUNTIME_GID):process.getgid(),installationSocket:join(root,'install.sock')});
 if(customerMode){assert.equal(process.getuid(),0,'Customer ZIP web acceptance runs a root controller');assert.ok(Number.isInteger(native.runtimeUid)&&native.runtimeUid>0&&Number.isInteger(native.runtimeGid)&&native.runtimeGid>0);await chmod(native.root,0o755)}
 const archive=customer?.runtime??join(pkg,packageReport.archive),releaseFile=customer?.releaseFile??join(root,'release.json'),configPath=join(root,'bootstrap.json');
 if(!customer)await writeFile(releaseFile,JSON.stringify(f.signArchive(manifest,await readFile(archive))),{mode:0o600});
 const config={native,publicPort:adminPort,challengeRoot:join(root,'bundle'),controlRoot:join(root,'control'),nativeConfigFile:join(root,'native.json'),archive,releaseFile,adminOrigin:origin,redisUrl:process.env.REDIS_URL};await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 const {startController}=await import(pathToFileURL(join(bootstrap,'controller.mjs')).href);controller=await startController(configPath,join(bootstrap,'ui'),transport);
 if(customerMode){const start=controller.host.start.bind(controller.host);controller.host.start=async initial=>{const text=await readFile(native.environmentFile,'utf8');assert.ok(!text.includes('NODE_OPTIONS='),'No unexpected runtime preload');await appendFile(native.environmentFile,'NODE_OPTIONS="--import='+pathToFileURL(preload).href+'"\n');return start(initial)}}
 nginx=await startBootstrapNginx(join(root,'nginx'),join(root,'bundle'),publicPort,adminPort);
 browser=await chromium.launch({headless:true});if(customerMode){const create=browser.newContext.bind(browser);browser.newContext=async options=>{const ctx=await create(options);await ctx.route('**/*',route=>['127.0.0.1','localhost','[::1]'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort('blockedbyclient'));return ctx};}const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const entryPage=await page.goto(origin+'/install');assert.equal((await entryPage.text()).match(/<title>(.*?)<\/title>/)?.[1],'安装须知 · 安装引导 · QiCore');assert.equal(await page.title(),'安装须知 · 安装引导 · QiCore');assert.equal(await page.getByText('开发预览',{exact:true}).count(),0);
 const images=join(evidence,'ui-evidence');await mkdir(images,{recursive:true});
 await page.getByText('当前域名已通过授权校验',{exact:true}).waitFor();assert.equal(activationCalls,1);assert.equal(bindingCalls,1);assert.equal(await page.getByPlaceholder('请输入安装访问凭据').count(),0);assert.equal(await page.getByRole('button',{name:'下一步',exact:true}).isEnabled(),false);
 await assert.rejects(readFile(join(root,'bundle/.well-known/qilicense-challenge')),error=>error.code==='ENOENT');assert.equal((await fetch(origin+'/.well-known/qilicense-challenge')).status,404);await nginx.verifyUnchanged();assert.equal((await(await fetch(origin+'/api/v1/public/maintenance')).json()).data.protocol,'qicore-maintenance-v1');
 const publicState=(await(await page.request.get(origin+'/api/v1/install/state')).json()).data;assert.equal(publicState.authenticated,false);assert.equal(publicState.csrf,undefined);
 const link=controller.installation.launchUrl(),linkToken=new URLSearchParams(new URL(link).hash.slice(1)).get('setup');
 assert.ok(!(await(await page.request.get(origin+'/install')).text()).includes(linkToken));
 await page.goto(link);await page.waitForFunction(()=>!location.hash);await page.getByText('当前域名已通过授权校验',{exact:true}).waitFor();assert.ok(!(await page.content()).includes(linkToken));
 await page.getByRole('checkbox').check();await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);await page.getByRole('checkbox').uncheck();
 assert.equal((await page.request.post(origin+'/api/v1/install/session',{headers:{origin},data:{token:linkToken}})).status(),401);
 if(customerMode){
  const authorized=(await(await page.request.get(origin+'/api/v1/install/state')).json()).data;assert.ok(authorized.csrf);
  const csrfRejected=await page.request.post(origin+'/api/v1/install/environment',{headers:{origin,'x-install-csrf':'invalid'},data:{}});assert.equal(csrfRejected.status(),409);assert.equal((await csrfRejected.json()).error.code,'INSTALL_CSRF_REJECTED');
  const originRejected=await page.request.post(origin+'/api/v1/install/environment',{headers:{origin:'https://invalid.example','x-install-csrf':authorized.csrf},data:{}});assert.equal(originRejected.status(),409);assert.equal((await originRejected.json()).error.code,'INSTALL_ORIGIN_REJECTED');
 }

 const direct=await browser.newContext(),directPage=await direct.newPage(),directLink=controller.installation.launchUrl();const directResponse=await directPage.goto(directLink);
 assert.equal((await directResponse.text()).match(/<title>(.*?)<\/title>/)?.[1],'安装须知 · 安装引导 · QiCore');await directPage.getByText('当前域名已通过授权校验',{exact:true}).waitFor();assert.equal(new URL(directPage.url()).hash,'');assert.equal((await(await directPage.request.get(origin+'/api/v1/install/state')).json()).data.authenticated,true);await direct.close();
 await page.screenshot({path:join(images,'notice-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(images,'notice-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 const refreshed=await page.reload();assert.equal((await refreshed.text()).match(/<title>(.*?)<\/title>/)?.[1],'安装须知 · 安装引导 · QiCore');assert.equal(await page.title(),'安装须知 · 安装引导 · QiCore');await page.getByText('当前域名已通过授权校验',{exact:true}).waitFor();
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'下一步',exact:true}).click();assert.equal(await page.title(),'环境检查 · 安装引导 · QiCore');
 await page.getByText('全部检查通过，可以继续安装。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'修改配置',exact:true}).getAttribute('aria-expanded'),'false');
 if(customerMode){
  await page.getByRole('button',{name:'修改配置',exact:true}).click();const fields=page.locator('#redis-connection-settings'),redis=new URL(process.env.REDIS_URL),numbers=fields.getByRole('spinbutton');assert.equal(await numbers.count(),2);
  await numbers.nth(0).fill(String(await freePort()));
  await page.getByText('填写连接信息后，检测安装所需的运行条件。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'下一步',exact:true}).isDisabled(),true);
  await page.getByRole('region',{name:'环境检测',exact:true}).getByRole('button',{name:'检测环境',exact:true}).click();
  await page.getByText('请处理未通过的项目，然后重新检测。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'下一步',exact:true}).isDisabled(),true);
  await fields.getByPlaceholder('127.0.0.1',{exact:true}).fill(redis.hostname);await numbers.nth(0).fill(redis.port||'6379');
  await numbers.nth(1).fill('1');
  await page.getByText('填写连接信息后，检测安装所需的运行条件。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'下一步',exact:true}).isDisabled(),true);
  await page.getByRole('region',{name:'环境检测',exact:true}).getByRole('button',{name:'检测环境',exact:true}).click();await page.getByText('全部检查通过，可以继续安装。',{exact:true}).waitFor();
  assert.equal(new URL(JSON.parse(await readFile(configPath,'utf8')).redisUrl).pathname,'/1');
 }
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await page.getByPlaceholder('例如：127.0.0.1').fill(url.hostname);await page.getByPlaceholder('3306',{exact:true}).fill(url.port||'3306');await page.getByPlaceholder('例如：qicore').fill(name);await page.getByPlaceholder('请输入数据库用户名').fill(decodeURIComponent(url.username));await page.getByPlaceholder('请输入数据库密码').fill(decodeURIComponent(url.password));
 const passwordInput=page.getByPlaceholder('请输入数据库密码');await page.getByRole('button',{name:'显示数据库密码',exact:true}).click();assert.equal(await passwordInput.getAttribute('type'),'text');assert.equal(await passwordInput.inputValue(),decodeURIComponent(url.password));await page.getByRole('button',{name:'隐藏数据库密码',exact:true}).click();assert.equal(await passwordInput.getAttribute('type'),'password');
 await page.getByRole('button',{name:'测试连接',exact:true}).click();await page.getByText('连接检查通过',{exact:true}).waitFor();await page.screenshot({path:join(images,'database-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(images,'database-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'下一步',exact:true}).click();await page.getByPlaceholder('例如：admin').fill('webadmin');await page.getByPlaceholder('例如：总管理员').fill('网页验收管理员');await page.getByPlaceholder('请输入登录密码').fill('12345');await page.getByPlaceholder('请再次输入密码').fill('12345');await page.getByRole('button',{name:'下一步',exact:true}).click();await page.getByText('密码至少需要 6 位',{exact:true}).waitFor();
 await page.getByPlaceholder('请输入登录密码').fill('123456');await page.getByPlaceholder('请再次输入密码').fill('123456');await page.getByRole('button',{name:'下一步',exact:true}).click();
 await page.getByRole('button',{name:'开始安装',exact:true}).click();await page.getByText('一切就绪，开始构建',{exact:true}).waitFor({timeout:120000});assert.equal(await page.title(),'安装完成 · 安装引导 · QiCore');await page.screenshot({path:join(images,'complete-desktop.png'),fullPage:true});assert.deepEqual(errors,[]);
 const state=(await(await page.request.get(origin+'/api/v1/install/state')).json()).data;assert.equal(state.complete,true);assert.equal((await page.request.post(origin+'/api/v1/install/authorization',{headers:{origin,'x-install-csrf':state.csrf},data:{}})).status(),410);
 for(const path of ['/install','/install?step=1&preview=1']){
  const existing=await page.request.get(origin+path,{maxRedirects:0});assert.equal(existing.status(),302);assert.equal(existing.headers().location,'/admin/login');
  const anonymous=await fetch(origin+path,{redirect:'manual'});assert.equal(anonymous.status,302);assert.equal(anonymous.headers.get('location'),'/admin/login');
 }
 for(const path of ['/session','/environment','/database','/execute'])assert.equal((await page.request.post(origin+'/api/v1/install'+path,{headers:{origin,'x-install-csrf':state.csrf},data:{}})).status(),410);
 assert.equal((await db.adminAccount.findUnique({where:{username:'webadmin'}})).nickname,'网页验收管理员');assert.equal(await db.tenant.count(),0);assert.equal(await db.tenantApplication.count(),0);assert.ok(reports.some(report=>report.status==='SUCCEEDED'));
 await page.getByRole('link',{name:'进入后台',exact:true}).click();await page.waitForURL('**/admin/login');assert.equal(await page.title(),'总后台登录 · QiCore');
 const login=await page.request.post('http://127.0.0.1:'+apiPort+'/api/v1/admin/auth/login',{headers:{origin},data:{username:'webadmin',password:'123456',portal:'admin'}});assert.equal(login.status(),200);
 await controller.close();controller=undefined;
 Object.assign(config,JSON.parse(await readFile(configPath,'utf8')));config.archive=join(root,'removed-incoming.zip');config.releaseFile=join(root,'removed-incoming.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 entry=spawn(process.execPath,[join(bootstrap,'start.mjs'),configPath],{stdio:['ignore','pipe','pipe'],...(customerMode?{env:{...process.env,NODE_OPTIONS:'--import='+pathToFileURL(preload).href}}:{})});let output='';entry.stdout.on('data',c=>output+=c);entry.stderr.on('data',c=>output+=c);
 let healthy=false;for(let i=0;i<100;i++){try{const value=await(await fetch(native.healthUrl,{signal:AbortSignal.timeout(2000)})).json();if(value.ready){healthy=true;break}}catch{}if(entry.exitCode!==null)break;await delay(200)}assert.ok(healthy,output);
 const duplicate=spawnSync(process.execPath,[join(bootstrap,'start.mjs'),configPath],{encoding:'utf8',timeout:30000,...(customerMode?{env:{...process.env,NODE_OPTIONS:'--import='+pathToFileURL(preload).href}}:{})});assert.equal(duplicate.status,73,duplicate.stderr);
 await page.goto(origin+'/install');await page.waitForURL('**/admin');assert.equal(await page.title(),'工作台 · 总后台 · QiCore');assert.equal(await db.adminAccount.count(),1);
 const guest=await browser.newContext(),guestPage=await guest.newPage();const guestResponse=await guestPage.goto(origin+'/install');await guestPage.waitForURL('**/admin/login');assert.equal((await guestResponse.text()).match(/<title>(.*?)<\/title>/)?.[1],'总后台登录 · QiCore');assert.equal(await guestPage.title(),'总后台登录 · QiCore');await guest.close();
 await nginx.verifyUnchanged();
 if(customer){
  const active=controller?.state?.active(native.frameworkKey)??JSON.parse(await readFile(join(native.stateRoot,native.frameworkKey,'active.json'),'utf8'));
  assert.equal(active.current.version,customer.release.version);assert.equal(active.health,'passed');
  const stored=JSON.parse(await readFile(join(native.stateRoot,native.frameworkKey,'release-'+customer.release.artifact.manifestSha256+'.json'),'utf8'));assert.deepEqual(stored,customer.release);
  const runtimeProcesses=spawnSync('ps',['-eo','uid=,gid=,args='],{encoding:'utf8'});assert.equal(runtimeProcesses.status,0);assert.ok(runtimeProcesses.stdout.split('\n').some(line=>new RegExp('^\\s*'+native.runtimeUid+'\\s+'+native.runtimeGid+'\\s').test(line)&&line.includes(join(bootstrap,'native-worker.js'))),'packaged runtime must actually run as the configured non-root identity');
  for(const name of ['identity.json','receipt.json']){const info=await lstat(join(native.licenseStateRoot,name));assert.equal(info.uid,native.runtimeUid);assert.equal(info.mode&0o777,0o600)}
  const health=await fetch(native.healthUrl,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());assert.equal(health.ready,true);assert.notEqual(health.mock,true);assert.equal(health.version,customer.release.version);assert.equal(health.components[native.frameworkKey].manifestSha256,customer.release.artifact.manifestSha256);
  await stop(entry);entry=undefined;const locked=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73',join(config.controlRoot,'controller.lock'),'true']);assert.equal(locked.status,0);
  for(const url of [native.healthUrl,native.loginUrl])await assert.rejects(fetch(url,{signal:AbortSignal.timeout(2000)}));
  await customer.verifyUnchanged();
 }
 await writeFile(join(evidence,'web-installation-report.json'),JSON.stringify({status:'passed',...(customer?{input:'exact-customer-install-zip',customerZipSha256:customer.zipSha256,customerZipBytes:(await lstat(process.env.QICORE_CUSTOMER_INSTALL_ZIP)).size,runtimeSha256:customer.release.artifact.sha256,releaseFormat:customer.release.format,bootstrapManifestSha256:customer.bootstrapManifestSha256,bootstrapInventoryUnchanged:true,incomingUnchanged:true,rootController:true,runtimeUid:native.runtimeUid,csrfAndOriginRejection:true,redisFormFailureAndCorrection:true,explicitPrivateConfig:true,initialController:'packaged startController with isolated signed transport',restartEntry:'unchanged packaged start.mjs',baotaAutoDiscoveryTested:false,productionAccess:false}:{}),nginx:'real default static well-known and whole-site proxy; no custom exact routes',nginxConfigurationUnchanged:true,activationProtocol:'verified signed bootstrap and renewal',automaticDomainCheck:'passed without installation access',launchLink:'one use, auto session, fragment cleared, no credential field',browser:'Chromium',viewports:['1440x1000','390x844'],ssrAndRefreshTitles:'passed',initialAdminMinimum:6,closedInstallWrites:'passed',closedInstallPage:'redirects existing and anonymous sessions; query bypass rejected; persists after restart',reportAcknowledged:true,stableLauncherRestart:'passed',existingAdminSessionAfterRestart:'preserved',freshBrowserLogin:'passed',duplicateController:'rejected by flock',applicationsInstalled:0,pageErrors:errors},null,2)+'\n');
});
