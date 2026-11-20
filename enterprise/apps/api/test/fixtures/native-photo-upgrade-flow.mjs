import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {randomUUID,createPublicKey,verify} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {chromium} from 'playwright';
import {fixture,hash} from './native-release.mjs';
import {readPhotoInputs} from './photo-compatibility-inputs.mjs';
import {testMysqlClient,testDatabaseAccount} from './mysql-tools.mjs';
import {canonicalJson} from '../../dist/license/contracts.js';
import {nativeArchiveFromCatalog} from '../../dist/license/native-release.js';
import {assertNativeCompatibility} from '../../dist/license/native-updates.js';
import {NativeHost} from '../../dist/lifecycle/native-host.js';
import {StateStore} from '../../dist/license/store.js';
import {installNative} from '../../dist/lifecycle/native-installation.js';
import {updaterRequest} from '../../dist/lifecycle/updater-client.js';
import {assertNativeBuildTarget} from '../../../../scripts/native-build-target.mjs';

const json=async file=>JSON.parse(await readFile(file,'utf8')),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});

// Invoked by native-existing-upgrade.check.mjs only when the separate real-package gate is enabled.
export async function verifyPhotoCompatibilityUpgrade(t){
 assert.equal(process.platform,'linux');const inputs=await readPhotoInputs();
 const oldPackage=resolve(process.env.NATIVE_PHOTO_BASELINE_PACKAGE_DIR),candidate=resolve(process.env.NATIVE_PACKAGE_DIR),update=resolve(process.env.NATIVE_UPDATE_PACKAGE_DIR);
 const oldManifest=await json(join(oldPackage,'release-manifest.json')),oldReport=await json(join(oldPackage,'package-report.json')),targetManifest=await json(join(update,'release-manifest.json')),targetReport=await json(join(update,'package-report.json'));
 assert.equal(oldManifest.version,'0.1.0');assert.equal(targetManifest.version,'0.1.2');assert.equal(targetManifest.from_version,'0.1.1');
 const oldBaseline=await json(new URL('../../../../config/release-baselines/qicore-0.1.0.json',import.meta.url));assertNativeBuildTarget({packageKey:oldManifest.package_key,targetVersion:'0.1.1',fromVersion:'0.1.0',files:oldManifest.files,baseline:oldBaseline});
 const root=await mkdtemp(join(tmpdir(),'qicore-photo-upgrade-')),url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');const database='qicore_photo_'+randomUUID().replaceAll('-','').slice(0,16);url.pathname='/'+database;
 const sql=statement=>{const result=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:statement,encoding:'utf8'});assert.equal(result.status,0,'isolated photo database statement failed')};
 sql('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+database+'`.* TO '+testDatabaseAccount()+';');
 const appPackage=inputs.original.manifest.package_key,f=fixture(root,{initial:true,frameworkKey:oldManifest.package_key,version:'0.1.0',applicationPackageKey:appPackage,applicationTenantLimit:5}),state=f.state,c=state.config,db=new PrismaClient({datasources:{db:{url:url.href}}});let controller,initialHost,browser,passed=false;
 const stages=[],httpErrors=[],externalRequests=[],businessWrites=[];
 t.after(async()=>{if(!passed)await writeFile(join(update,'photo-compatibility-failure-report.json'),JSON.stringify({status:'failed',stages,httpErrors,externalRequests,tasks:state.tasks(),productionAccess:false},null,2)+'\n').catch(()=>{});await browser?.close();await controller?.close();await initialHost?.stop();await db.$disconnect();sql('DROP DATABASE `'+database+'`; REVOKE ALL PRIVILEGES ON `'+database+'`.* FROM '+testDatabaseAccount()+';');assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/qicore-photo-upgrade-'));await rm(root,{recursive:true,force:true})});
 const apiPort=await freePort(),adminPort=await freePort(),maintenancePort=await freePort(),api='http://127.0.0.1:'+apiPort,origin='http://127.0.0.1:'+adminPort;
 Object.assign(c,{healthUrl:api+'/health',loginUrl:origin+'/admin/login',migrationUrl:url.href,runtimeUid:process.getuid(),runtimeGid:process.getgid(),installationSocket:join(root,'install.sock')});
 const privateStore=new StateStore(join(root,'configuration')),nativeFile=privateStore.path('native.json'),bootstrapFile=privateStore.path('bootstrap.json');
 const preload=join(root,'network-boundary.mjs');await writeFile(preload,`import http from 'node:http';import https from 'node:https';import{syncBuiltinESMExports}from'node:module';const allowed=['127.0.0.1','localhost','[::1]'];function check(input){const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';if(!allowed.includes(host))throw Error('TEST_EXTERNAL_NETWORK_BLOCKED')}const original=fetch;globalThis.fetch=(input,options)=>{check(input?.url||input);return original(input,options)};for(const module of[http,https])for(const method of['request','get']){const old=module[method];module[method]=function(input,...args){check(input);return old.call(this,input,...args)}}syncBuiltinESMExports();`);
 class IsolatedHost extends NativeHost{async start(initial){if(!(await readFile(c.environmentFile,'utf8')).includes('NODE_OPTIONS='))await appendFile(c.environmentFile,'NODE_OPTIONS="--import='+pathToFileURL(preload).href+'"\nPAYMENT_EXECUTION_ENABLED=false\n');return super.start(initial)}}
 const oldArchive=join(oldPackage,oldReport.archive),oldRelease=f.signArchive(oldManifest,await readFile(oldArchive));initialHost=new IsolatedHost(state);
 const installed=await installNative(state,f.client,initialHost,{requestId:randomUUID(),archive:oldArchive,release:oldRelease,administrator:{username:'installAdmin',password:'123456'},redisUrl:process.env.REDIS_URL,adminOrigin:origin,acceptTerms:true});assert.equal(installed.status,'succeeded',JSON.stringify(installed));await initialHost.stop();
 const original=f.signArchive(inputs.original.manifest,inputs.original.bytes),compatible=f.signArchive(inputs.compatible.manifest,inputs.compatible.bytes),intermediate=f.signArchive(inputs.framework.manifest,inputs.framework.bytes),targetBytes=await readFile(join(update,targetReport.archive)),target=f.signArchive(targetManifest,targetBytes);
 const releases=[{release:original,bytes:inputs.original.bytes},{release:compatible,bytes:inputs.compatible.bytes},{release:intermediate,bytes:inputs.framework.bytes},{release:target,bytes:targetBytes}];
 const transport=async(input,init)=>{
  const path=new URL(input).pathname;if(!init?.body){const item=releases.find(item=>path.endsWith('/'+item.release.artifact.releaseId));assert.ok(item,'only approved isolated artifacts may be downloaded');return new Response(item.bytes,{headers:{'content-length':String(item.bytes.length)}})}
  const envelope=JSON.parse(init.body),body=envelope.payload,identity=f.client.identity(),key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(identity.publicKey,'base64url')]),format:'der',type:'spki'});assert.equal(envelope.instanceId,identity.instanceId);assert.ok(verify(null,Buffer.from(`${envelope.instanceId}\n${envelope.timestamp}\n${envelope.nonce}\n${hash(canonicalJson(body))}`),key,Buffer.from(envelope.signature,'base64url')));
  if(path.endsWith('/license/installation/report'))return Response.json({accepted:true,attemptId:body.attemptId,sequence:body.sequence});
  if(path.endsWith('/access'))return Response.json({accessToken:'fixture_update.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()});
  if(path.endsWith('/updates/plan')){
   const key=body.targetPackageKeys[0],frameworkVersion=body.installed.find(item=>item.packageKey===c.frameworkKey).version,release=key===appPackage?compatible:frameworkVersion==='0.1.0'?intermediate:target;
   const installedManifests=body.installed.map(item=>nativeArchiveFromCatalog(state.release(item.packageKey,state.active(item.packageKey).current).manifest));
   try{assertNativeCompatibility(installedManifests,nativeArchiveFromCatalog(release.manifest),'linux','x64','24.0.0')}catch(error){assert.equal(error.message,'COMPONENT_DEPENDENCY_CONFLICT');return Response.json({code:'SCOPED_UPDATE_DEPENDENCY_CONFLICT',message:'This component requires a joint update; check all updates.'},{status:409})}
   const plan=f.plan(release,body.installed,key);plan.generatedAt=new Date().toISOString();plan.validUntil=new Date(Date.now()+600000).toISOString();return Response.json({signedPlan:f.envelope(plan)});
  }
  if(path.endsWith('/updates/lifecycle/plan')){assert.equal(body.operation,'install');assert.equal(body.packageKey,appPackage);const now=Date.now();return Response.json({signedPlan:f.envelope({protocol:'license-api-v2',capability:'native-lifecycle-v1',operation:body.operation,key_id:'receipt',planId:'plan_'+randomUUID(),licenseId:'license-test',licenseRevision:1,instanceId:identity.instanceId,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+600000).toISOString(),productId:c.frameworkKey,domain:'127.0.0.1',packageKey:appPackage,installed:body.installed,release:original})})}
  throw Error('TEST_EXTERNAL_OPERATION_BLOCKED');
 };
 function configure(){privateStore.write('native.json',c);const {migrationUrl,...native}=c;privateStore.write('bootstrap.json',{native,controlRoot:join(root,'installer'),nativeConfigFile:nativeFile,archive:oldArchive,releaseFile:join(root,'initial-release.json'),adminOrigin:origin,redisUrl:process.env.REDIS_URL})}
 async function ready(){const active=state.active(c.frameworkKey);await controller.host.health(c.frameworkKey,active.current.version,state.release(c.frameworkKey,active.current).artifact.manifestSha256)}
 async function waitTask(id){for(let i=0;i<900;i++){const task=state.tasks().find(item=>item.id===id);if(task&&task.status!=='running'){assert.equal(task.status,'succeeded',JSON.stringify(task));return task}await delay(200)}throw Error('PHOTO_UPGRADE_TASK_TIMEOUT')}
 configure();const oldController=await import(pathToFileURL(join(oldPackage,'bootstrap/controller.mjs')).href);controller=await oldController.startController(bootstrapFile,join(oldPackage,'bootstrap/ui'),transport);await ready();
 const installId=randomUUID();await updaterRequest('/applications/execute',{requestId:installId,packageKey:appPackage,operation:'install',targetVersion:'0.1.0',manifestSha256:original.artifact.manifestSha256},c.socket);await waitTask(installId);
 const adminLogin=await fetch(api+'/api/v1/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'installAdmin',password:'123456',portal:'admin'})});assert.equal(adminLogin.status,200);const adminCookie=adminLogin.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),adminSession=(await adminLogin.json()).data;
 const tenantId='photo-upgrade-site';await db.tenant.create({data:{id:tenantId,name:'兼容验收站点'}});
 const assigned=await fetch(api+'/api/v1/admin/tenants/'+tenantId+'/applications/id-photo',{method:'PUT',headers:{origin,cookie:adminCookie,'content-type':'application/json','x-csrf-token':adminSession.csrfToken},body:JSON.stringify({version:0,enabled:true,expiresAt:null})});assert.equal(assigned.status,200,await assigned.text());
 const binding=await db.tenantApplication.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:'id-photo'}}});assert.equal(binding.config.paymentEnabled,false);assert.equal(binding.config.adEnabled,false);
 const tenantRole=await db.adminRole.findUnique({where:{systemCode:'tenant-admin'}}),admin=await db.adminAccount.findUnique({where:{username:'installadmin'}});assert.ok(tenantRole.permissions.includes('id-photo:overview.read'));
 await db.adminAccount.create({data:{id:'photo-upgrade-admin',username:'compattenant',nickname:'兼容验收员',passwordHash:admin.passwordHash,roleId:tenantRole.id,scopes:{create:{tenantId}}}});
 await db.$executeRawUnsafe("INSERT INTO Photo(id,tenantId,userId,path,mime,detection,consent,expiresAt) VALUES(?,?,?,?,?,?,?,?)",'photo-retained',tenantId,'fixture-user','fixture/photo.png','image/png',JSON.stringify({retained:true}),true,new Date('2099-01-01'));
 const rows=await db.$queryRawUnsafe('SELECT * FROM Photo WHERE id=?','photo-retained'),migrations=await db.$queryRawUnsafe('SELECT * FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',appPackage);assert.equal(migrations.length,3);
 browser=await chromium.launch({headless:true});const images=join(update,'ui-evidence');await mkdir(images,{recursive:true});
 async function verifyStage(label,frameworkVersion,applicationVersion){
  const health=await(await fetch(c.healthUrl)).json();assert.equal(health.version,frameworkVersion);assert.equal(health.components[appPackage].version,applicationVersion);await state.verifyCurrent(appPackage);
  assert.deepEqual(await db.tenantApplication.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:'id-photo'}}}),binding);assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM Photo WHERE id=?','photo-retained'),rows);assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',appPackage),migrations);
  const tables=(await db.$queryRawUnsafe('SHOW TABLES')).map(row=>Object.values(row)[0]);for(const name of ['Photo','Job','Work','Grant','Unlock','Ledger','GenerationCharge','Order','AdSession','ProviderEvent','TenantImageAiSetting','TenantImageAiTest'])assert.ok(tables.includes(name),name+' must remain assembled');
  for(const name of ['Job','Order','GenerationCharge','TenantImageAiTest'])assert.equal(Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS total FROM `'+name+'`'))[0].total),0,'no generation/payment/test work may be created');
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol))return route.continue();externalRequests.push(url.origin);return route.abort()});
  const login=await context.request.post(api+'/api/v1/admin/auth/login',{headers:{origin},data:{username:'compattenant',password:'123456',portal:'tenant'}});assert.equal(login.status(),200);
  const page=await context.newPage(),errors=[],assets=new Set();page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))businessWrites.push({method:request.method(),path:new URL(request.url()).pathname})});page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().includes('/application-assets/id-photo/')){assets.add(response.url());if(response.status()>=400)httpErrors.push({stage:label,url:response.url(),status:response.status()})}});page.on('requestfailed',request=>{if(request.url().includes('/application-assets/id-photo/'))httpErrors.push({stage:label,url:request.url(),failure:request.failure()?.errorText})});
  try{
   for(const route of ['/tenant/workbench','/tenant/jobs','/tenant/works','/tenant/templates','/tenant/production','/tenant/orders','/h5/'+tenantId+'/','/h5/'+tenantId+'/templates']){
    const response=await page.goto(origin+route,{waitUntil:'networkidle'});assert.equal(response.status(),200,label+' '+route);const html=await response.text();assert.match(html,/<title>[^<]+<\/title>/);assert.ok(html.includes('/application-assets/id-photo/'+applicationVersion+'/'),label+' app asset namespace missing '+route);if(applicationVersion!=='0.1.0')assert.ok(!html.includes('/application-assets/id-photo/0.1.0/'),label+' stale asset namespace');
    if(route.endsWith('/tenant/workbench')||route.endsWith('/h5/'+tenantId+'/'))await page.screenshot({path:join(images,'photo-'+label+(route.startsWith('/h5/')?'-h5':'-admin')+'.png'),fullPage:true});
   }
   assert.ok(assets.size>3,'real application assets must load');assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(businessWrites,[]);stages.push({label,frameworkVersion,applicationVersion,routes:8,assets:assets.size,data:'preserved',bindingAndConfig:'preserved',applicationTables:12,migrationCount:migrations.length});
  }finally{await context.close()}
 }
 await verifyStage('original','0.1.0','0.1.0');
 await controller.close();controller=null;c.maintenancePort=maintenancePort;configure();const nextController=await import(pathToFileURL(join(candidate,'bootstrap/controller.mjs')).href);controller=await nextController.startController(bootstrapFile,join(candidate,'bootstrap/ui'),transport);await ready();
 const blocked=await updaterRequest('/check',{packageKey:c.frameworkKey},c.socket);assert.equal(blocked.code,'SCOPED_UPDATE_DEPENDENCY_CONFLICT');assert.equal(blocked.state,'unavailable');assert.match(blocked.description,/先更新相关应用/);assert.equal(state.active(c.frameworkKey).current.version,'0.1.0');
 for(const [release,frameworkVersion,applicationVersion,label] of [[compatible,'0.1.0','0.1.1','compatible-app'],[intermediate,'0.1.1','0.1.1','framework-011'],[target,'0.1.2','0.1.1','framework-012']]){
  const id=randomUUID();await updaterRequest('/execute',{requestId:id,packageKey:release.manifest.packageKey,targetVersion:release.version,manifestSha256:release.artifact.manifestSha256},c.socket);await waitTask(id);await verifyStage(label,frameworkVersion,applicationVersion);
 }
 await controller.close();controller=null;controller=await nextController.startController(bootstrapFile,join(candidate,'bootstrap/ui'),transport);await ready();await verifyStage('restart','0.1.2','0.1.1');
 await writeFile(join(update,'photo-compatibility-upgrade-report.json'),JSON.stringify({status:'passed',chain:['framework0.1.0/app0.1.0','framework0.1.0/app0.1.1','framework0.1.1/app0.1.1','framework0.1.2/app0.1.1'],oldFrameworkBaseline:{sourceRef:oldBaseline.baselineSourceRef,rebuiltManifestSha256:oldReport.manifestSha256,publishedManifestSha256:oldBaseline.releaseManifestSha256,manifestByteIdentical:oldReport.manifestSha256===oldBaseline.releaseManifestSha256},inputHashes:Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,{sha256:input.sha256,manifestSha256:input.manifestSha256}])),stages,httpErrors,externalRequests,network:'loopback-only runtime HTTP and browser requests',generationRequests:0,paymentExecution:false,signing:'ephemeral fixture keys, original ZIP bytes unchanged',productionAccess:false},null,2)+'\n');passed=true;
}
