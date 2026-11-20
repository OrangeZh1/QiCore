import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,cp,readdir,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readPhoto017Inputs,PHOTO_KEY,FRAMEWORK_KEY} from './fixtures/photo-017-inputs.mjs';
import {photo017Environment} from './fixtures/native-photo-017-environment.mjs';
import {hash} from './fixtures/native-release.mjs';
import {updaterRequest} from '../dist/lifecycle/updater-client.js';
import {verifyNativeRelease} from '../dist/license/native-updates.js';
import {assertLegacyPhotoTransition} from './fixtures/native-photo-017-network.mjs';
import {seedTerminalTransitionHistory} from './fixtures/terminal-transition-history.mjs';

assert.equal(process.platform,'linux');
for(const key of ['NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','TEST_DATABASE_URL','TEST_RESTORE_ROOT_CONFIG','REDIS_URL','QICORE_TEST_RUNTIME_UID','QICORE_TEST_RUNTIME_GID','QICORE_PHOTO_016_ZIP','QICORE_PHOTO_017_ZIP','QICORE_PHOTO_016_RELEASE','QICORE_PHOTO_017_RELEASE'])assert.ok(process.env[key],key+' required');
const json=async file=>JSON.parse(await readFile(file,'utf8')),delay=ms=>new Promise(ok=>setTimeout(ok,ms));

test('real photo 0.1.6 upgrades to compatible 0.1.7 before the ordinary framework 0.1.7, with failure recovery',{timeout:900000},async t=>{
 const inputs=await readPhoto017Inputs(),baseline=resolve(process.env.NATIVE_BASELINE_PACKAGE_DIR),candidate=resolve(process.env.NATIVE_PACKAGE_DIR),update=resolve(process.env.NATIVE_UPDATE_PACKAGE_DIR);
 const e=await photo017Environment(t,{baseline,candidate,update,inputs}),{root,f,c,db}=e,stages=[],tasks=[],httpDispatches=[];
 const api=c.healthUrl.replace('/health',''),origin=new URL(c.loginUrl).origin;
 const execute=async(release,throughApi=false)=>{
  await e.preparePlan(release);const id=randomUUID(),body={requestId:id,packageKey:release.manifest.packageKey,targetVersion:release.version,manifestSha256:release.artifact.manifestSha256};
  if(throughApi){assert.equal((await e.health()).version,'0.1.6');const result=await adminPost('/updates/execute',body);assert.equal(result.accepted,true);assert.equal(result.taskId,id);httpDispatches.push({runtimeVersion:'0.1.6',endpoint:'/api/v1/admin/updates/execute',packageKey:release.manifest.packageKey,requestId:id})}
  else await updaterRequest('/execute',body,c.socket);
  const task=await e.waitTask(id);tasks.push({id,status:task.status,step:task.step,code:task.code,packageKey:release.manifest.packageKey});return task;
 };

 // Preserve the historical signature; only the exact photo 0.1.7 path uses ordinary metadata.
 verifyNativeRelease(f.product,e.original);verifyNativeRelease(f.product,e.compatible);
 assert.equal(e.compatible.artifact.integrity.format,'id-photo-release-integrity-v1');assert.ok(!('signatureEnvelope' in e.compatible.artifact));
 const missing=structuredClone(e.compatible);delete missing.artifact.integrity;assert.throws(()=>verifyNativeRelease(f.product,missing));
 const damagedHistory=structuredClone(e.original);damagedHistory.artifact.signatureEnvelope.signature=Buffer.alloc(64).toString('base64url');assert.throws(()=>verifyNativeRelease(f.product,damagedHistory),/RELEASE_SIGNATURE_INVALID/);
 damagedHistory.artifact.integrity=e.compatible.artifact.integrity;assert.throws(()=>verifyNativeRelease(f.product,damagedHistory));
 let entry=await e.launch();await e.preparePlan(e.original,true);
 const installId=randomUUID();await updaterRequest('/applications/execute',{requestId:installId,packageKey:PHOTO_KEY,operation:'install',targetVersion:'0.1.6',manifestSha256:e.original.artifact.manifestSha256},c.socket);
 assert.equal((await e.waitTask(installId)).status,'succeeded');await e.health();

 async function login(username,portal){
  const response=await fetch(api+'/api/v1/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'123456',portal})});assert.equal(response.status,200);
  const name=portal==='tenant'?'qicore_tenant_session':'qicore_admin_session';
  // Login also expires the old /api/v1 cookie; do not send that duplicate empty cookie to SSR.
  const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).find(v=>v.startsWith(name+'=')&&v.length>name.length+1);
  assert.ok(cookie,'live portal session cookie required');const session=(await response.json()).data;
  assert.ok(session.id&&session.csrfToken);assert.equal(session.role,portal==='tenant'?'tenant':'root');return{cookie,session};
 }
 async function adminPost(path,body){const signed=await login('transitionAdmin','admin');const response=await fetch(api+'/api/v1/admin'+path,{method:'POST',headers:{origin,cookie:signed.cookie,'content-type':'application/json','x-csrf-token':signed.session.csrfToken},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return(await response.json()).data}
 const admin=await login('transitionAdmin','admin'),tenants=['photo-017-a','photo-017-b'];
 for(const tenantId of tenants){
  await db.tenant.create({data:{id:tenantId,name:'隔离照片验收 '+tenantId}});
  const response=await fetch(api+'/api/v1/admin/tenants/'+tenantId+'/applications/id-photo',{method:'PUT',headers:{origin,cookie:admin.cookie,'content-type':'application/json','x-csrf-token':admin.session.csrfToken},body:JSON.stringify({version:0,enabled:true,expiresAt:null})});assert.equal(response.status,200,await response.text());
  await db.consumerProfile.create({data:{tenantId,applicationKey:'id-photo',userId:'same-user',nickname:tenantId}});
  await db.consumerExternalIdentity.create({data:{tenantId,applicationKey:'id-photo',userId:'same-user',provider:'wechat',appId:'wxfixture017',subjectHash:hash(tenantId),identityCipher:'isolated-identity-sentinel-'+tenantId}});
  await db.$executeRawUnsafe('INSERT INTO Photo(id,tenantId,userId,path,mime,detection,consent,expiresAt) VALUES(?,?,?,?,?,?,?,?)','photo-'+tenantId,tenantId,'same-user','fixture/'+tenantId+'.png','image/png',JSON.stringify({retained:tenantId}),true,new Date('2099-01-01'));
 }
 const role=await db.adminRole.findUnique({where:{systemCode:'tenant-admin'}}),account=await db.adminAccount.findUnique({where:{username:'transitionadmin'}});assert.ok(role.permissions.includes('id-photo:overview.read'));
 await db.adminAccount.create({data:{id:'photo-017-admin',username:'photocompat',nickname:'隔离验收账号',passwordHash:account.passwordHash,roleId:role.id,scopes:{create:{tenantId:tenants[0]}}}});
 const sentinel=join(c.dataRoot,'photo-017-retained.bin');await writeFile(sentinel,'isolated persistent data; no real upload');
 const applicationHistory=()=>db.$queryRawUnsafe('SELECT * FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',PHOTO_KEY);
 const prismaHistory=()=>db.$queryRawUnsafe('SELECT id,migration_name,checksum,finished_at FROM _prisma_migrations ORDER BY migration_name,id');
 async function snapshot(){return{
  bindings:await db.tenantApplication.findMany({where:{tenantId:{in:tenants}},orderBy:{tenantId:'asc'}}),
  profiles:await db.consumerProfile.findMany({where:{tenantId:{in:tenants}},orderBy:{tenantId:'asc'}}),
  identities:await db.consumerExternalIdentity.findMany({where:{tenantId:{in:tenants}},orderBy:{tenantId:'asc'}}),
  photos:await db.$queryRawUnsafe('SELECT * FROM Photo ORDER BY id'),appMigrations:await applicationHistory(),prisma:await prismaHistory(),
  persistent:hash(await readFile(sentinel)),identity:hash(await readFile(join(c.licenseStateRoot,'identity.json'))),
 }}
 const preserved=await snapshot();assert.equal(preserved.appMigrations.length,3);assert.equal(preserved.profiles.length,2);assert.equal(preserved.bindings.filter(v=>v.activeSlot===1).length,2);
 async function verifyStage(label,frameworkVersion,appVersion){
  const health=await e.health(frameworkVersion);assert.equal(health.components[PHOTO_KEY].version,appVersion);await f.state.verifyCurrent(PHOTO_KEY);
  assert.deepEqual(await snapshot(),preserved,'data/tenant binding/identity/application and Prisma history: '+label);
  const tables=(await db.$queryRawUnsafe('SHOW TABLES')).map(row=>Object.values(row)[0]);
  for(const name of ['Photo','Job','Work','Grant','Unlock','Ledger','GenerationCharge','Order','AdSession','ProviderEvent','TenantImageAiSetting','TenantImageAiTest'])assert.ok(tables.includes(name));
  for(const name of ['Job','Order','GenerationCharge','TenantImageAiTest','PaymentRecord','SubscriptionDelivery'])assert.equal(Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS total FROM `'+name+'`'))[0].total),0,'no real generation/payment/notifications');
  const tenant=await login('photocompat','tenant'),cookie=tenant.cookie+'; qicore_last_tenant_site='+encodeURIComponent(JSON.stringify({accountId:tenant.session.id,tenantId:tenants[0]}));
  const checked=[];
  for(const path of ['/tenant/workbench','/tenant/jobs','/tenant/works','/tenant/templates','/tenant/production','/tenant/orders','/h5/'+tenants[0]+'/','/h5/'+tenants[0]+'/templates']){
   const response=await fetch(origin+path,{headers:{cookie}}),html=await response.text();assert.equal(response.status,200,label+' '+path);
   assert.match(html,/<title>[^<]+<\/title>/);assert.ok(html.includes('/application-assets/id-photo/'+appVersion+'/'),label+' application asset namespace');
   if(appVersion==='0.1.7')assert.ok(!html.includes('/application-assets/id-photo/0.1.6/'));
   const assets=[...html.matchAll(/(?:src|href)="(\/application-assets\/id-photo\/[^"?]+\.(?:js|css))(?:\?[^\"]*)?"/g)].map(v=>v[1]);
   for(const asset of new Set(assets)){const r=await fetch(origin+asset);assert.equal(r.status,200,asset);assert.ok((await r.arrayBuffer()).byteLength>0)}checked.push(path);
  }
  const denied=await fetch(api+'/api/v1/admin/tenants/'+tenants[1]+'/apps/id-photo/templates',{headers:{origin,cookie:tenant.cookie}});assert.equal(denied.status,403,'tenant administrator cannot access another tenant');
  stages.push({label,frameworkVersion,applicationVersion:appVersion,routes:checked.length,identityAndBindings:'preserved',migrationHistory:'preserved'});
 }
 const terminalHistory=seedTerminalTransitionHistory(f.state,[FRAMEWORK_KEY,PHOTO_KEY]);
 await verifyStage('baseline','0.1.6','0.1.6');
 await e.preparePlan(e.compatible);const legacyOffset=(await e.networkEvents()).length,legacyActive=f.state.installed(),legacyTasks=f.state.tasks().length;
 const legacy=await adminPost('/updates/check',{packageKey:PHOTO_KEY});
 const legacyRefusal=assertLegacyPhotoTransition(legacy,(await e.networkEvents()).slice(legacyOffset),PHOTO_KEY);
 assert.deepEqual(f.state.installed(),legacyActive);assert.equal(f.state.tasks().length,legacyTasks,'rejected check must not accept an application update task');
 assert.deepEqual(await snapshot(),preserved,'old capability cannot mutate the installed pair');

 // Transition the controller only: the installed runtime/application pair remains 0.1.6/0.1.6.
 await e.stop(entry);const transitionTool=join(root,'transition.mjs');await cp(join(candidate,'bootstrap/transition.mjs'),transitionTool);
 const transitionFile=join(root,'transition-input.json');await writeFile(transitionFile,JSON.stringify({bootstrapRoot:e.live,candidateRoot:join(candidate,'bootstrap'),config:e.configFile,version:'0.1.7',manifestSha256:hash(await readFile(join(candidate,'bootstrap/bootstrap-manifest.json')))}));
 const transition=operation=>e.run(process.execPath,[transitionTool,operation,transitionFile]);
 const applied=await transition('apply').done;assert.equal(applied.code,0,applied.stderr);entry=await e.launch();
 for(let i=0;i<150;i++){try{const ready=await json(join(e.controlRoot,'bootstrap-ready.json'));if(ready.manifestSha256===(await json(join(e.controlRoot,'bootstrap-transition.json'))).manifestSha256)break}catch{}assert.ok(i<149,'bootstrap readiness receipt');await delay(100)}
 const complete=await transition('complete').done;assert.equal(complete.code,0,complete.stderr);await assert.rejects(access(join(root,'bundle/.qicore-bootstrap-previous')),/ENOENT/);
 terminalHistory.assertFilesUnchanged();
 await verifyStage('controller-transition','0.1.6','0.1.6');
 const modernOffset=(await e.networkEvents()).length;

 const activeBefore=structuredClone(f.state.active(FRAMEWORK_KEY)),appBefore=structuredClone(f.state.active(PHOTO_KEY));
 const blocked=await execute(e.target);assert.equal(blocked.status,'blocked');assert.equal(blocked.step,'COMPATIBILITY');assert.equal(blocked.code,'COMPONENT_DEPENDENCY_CONFLICT');
 assert.deepEqual(f.state.active(FRAMEWORK_KEY),activeBefore);assert.deepEqual(f.state.active(PHOTO_KEY),appBefore);await verifyStage('direct-framework-rejected','0.1.6','0.1.6');

 // Reject a real incompatible app runtime start, then prove the exact same ZIP can be retried.
 await e.preparePlan(e.compatible);const available=await adminPost('/updates/check',{packageKey:PHOTO_KEY});assert.equal(available.state,'available');assert.equal(available.latestVersion,'0.1.7');assert.equal(available.manifestSha256,e.compatible.artifact.manifestSha256);
 await e.setNetwork({failApplicationVersion:'0.1.7'});const badApp=await execute(e.compatible,true);assert.equal(badApp.status,'rolled_back',JSON.stringify(badApp));
 await verifyStage('application-health-rollback','0.1.6','0.1.6');await e.setNetwork({failApplicationVersion:null});
 const appUpgrade=await execute(e.compatible,true);assert.equal(appUpgrade.status,'succeeded',JSON.stringify(appUpgrade));await verifyStage('compatible-application','0.1.6','0.1.7');
 await e.preparePlan(e.compatible);const repair=await adminPost('/updates/applications/check',{packageKey:PHOTO_KEY,operation:'repair'});assert.equal(repair.targetVersion,'0.1.7');assert.equal(repair.manifestSha256,e.compatible.artifact.manifestSha256);
 const compatibleReceipt=structuredClone(f.state.active(PHOTO_KEY));

 await e.stop(entry);const normalDump=c.mysqldump,failure=join(root,'dump-failure.sh');await writeFile(failure,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "mysqldump fixture"; exit 0; fi\nexit 17\n',{mode:0o755});c.mysqldump=failure;e.configure();entry=await e.launch();
 const backupFailure=await execute(e.target);assert.equal(backupFailure.status,'rolled_back',JSON.stringify(backupFailure));await verifyStage('framework-backup-rollback','0.1.6','0.1.7');
 await e.stop(entry);c.mysqldump=normalDump;e.configure();entry=await e.launch();
 await e.setNetwork({failRuntimeVersion:'0.1.7'});const unhealthy=await execute(e.target);assert.equal(unhealthy.status,'rolled_back',JSON.stringify(unhealthy));await verifyStage('framework-health-rollback','0.1.6','0.1.7');
 const nativeHistory=await db.$queryRawUnsafe('SELECT package_key,migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',FRAMEWORK_KEY);
 assert.deepEqual(nativeHistory.map(row=>({id:row.migration_id,sha256:row.sha256,finished:!!row.finished})),e.target.migrations.map(m=>({id:m.id,sha256:m.sha256,finished:true})));
 await e.setNetwork({failRuntimeVersion:null});const upgraded=await execute(e.target);assert.equal(upgraded.status,'succeeded',JSON.stringify(upgraded));await verifyStage('combined-upgrade','0.1.7','0.1.7');
 await e.stop(entry);entry=await e.launch('0.1.7');await verifyStage('restart','0.1.7','0.1.7');await e.stop(entry);
 assert.deepEqual(f.state.active(PHOTO_KEY),compatibleReceipt);assert.deepEqual(await db.$queryRawUnsafe('SELECT package_key,migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',FRAMEWORK_KEY),nativeHistory);
 for(const key of [FRAMEWORK_KEY,PHOTO_KEY]){assert.equal(f.state.active(key).previous,null);assert.equal((await readdir(join(f.state.directory(key),'releases'))).length,1)}
 assert.notEqual((await transition('recover').done).code,0,'completed transition cannot restore an obsolete controller');
 const modernEvents=(await e.networkEvents()).slice(modernOffset);
 for(const event of modernEvents)assert.equal(event.capability,event.endpoint==='/updates/plan'?'native-full-v3':'native-lifecycle-v2','new controller must never fall back to legacy capabilities');
 for(const endpoint of ['/updates/plan','/updates/lifecycle/plan'])assert.ok(modernEvents.some(event=>event.endpoint===endpoint&&event.packageKey===PHOTO_KEY&&event.phase==='response'&&event.status===200&&event.planIssued===true),'ordinary application plan accepted by the new controller: '+endpoint);
 terminalHistory.assertPreserved();
 await writeFile(join(update,'photo-017-upgrade-report.json'),JSON.stringify({status:'passed',terminalHistory:{...terminalHistory.report,transitionFileBytesPreserved:true},chain:['framework0.1.6/app0.1.6','framework0.1.6/app0.1.7','framework0.1.7/app0.1.7'],inputs:Object.fromEntries(Object.entries(inputs).map(([name,v])=>[name,{sha256:v.sha256,manifestSha256:v.manifestSha256}])),frameworkUpdateSha256:e.target.artifact.sha256,stages,tasks,httpDispatches,applicationReleaseEvidence:{original:'unchanged published 0.1.6 signature',compatible:'id-photo-release-integrity-v1; no release signature',zipBytesUnchanged:true,legacyRefusal,upgradeCapability:'native-full-v3',repairCapability:'native-lifecycle-v2',brokenHistoryRejected:true},oldFrameworkSignature:'original published initial v1',newFrameworkMaterial:'ordinary integrity v2',fixtureDatabase:true,externalNetwork:false,generationRequests:0,realPayments:0,notificationsSent:0,productionAccess:false,browserInteractionTested:false,currentOnly:true},null,2)+'\n');e.pass();
});
