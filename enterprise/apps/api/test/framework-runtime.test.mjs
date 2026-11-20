import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,cp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {initializeStandalone} from '../../../scripts/install-standalone.mjs';
import {testDatabaseAccount,testMysqlClient} from './fixtures/mysql-tools.mjs';
import {passwordHash} from '../dist/core/admin-auth.mjs';
import {verifyAdvertisingHost} from './fixtures/advertising-host.mjs';
import {PlatformStorage} from '../dist/storage/service.mjs';
import {verifyStorageHost} from './fixtures/storage-host.mjs';

if(process.env.CI)for(const key of ['TEST_DATABASE_URL','TEST_RESTORE_ROOT_CONFIG','REDIS_URL'])assert.ok(process.env[key],'CI must execute the isolated integration test: '+key);

test('standalone default selects no application catalog or grants in source and build',()=>{
 for(const tree of ['src','dist']){
  const program=`const r=await import('./${tree}/applications/registry.mjs');const a=await import('./${tree}/core/admin-auth.mjs');if(r.applicationCatalog().length||r.loadedApplications().length||a.tenantPermissions.some(p=>!p.startsWith('tenant:')))throw Error('APP_LEAK');console.log('empty')`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'empty');
 }
});

test('framework migrates a fresh database and serves isolated API and SSR',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');
 const name='qicore_empty_qa_'+randomUUID().replaceAll('-','').slice(0,16);assert.match(name,/^qicore_empty_qa_[a-f0-9]{16}$/);url.pathname='/'+name;
 const rootSql=sql=>{const r=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:sql,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'isolated schema operation failed')};
 const root=await mkdtemp(join(tmpdir(),'qicore-empty-runtime-')),apiRoot=join(root,'apps/api'),dist=join(apiRoot,'dist'),db=new PrismaClient({datasources:{db:{url:url.href}}});let child,server,created=false;
 const stop=async process=>{if(!process||process.exitCode!==null)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture process did not stop')),10000);process.once('exit',()=>{clearTimeout(timer);resolve()});process.kill()})};
 t.after(async()=>{await stop(server);await stop(child);await db.$disconnect();if(created)rootSql('DROP DATABASE `'+name+'`; REVOKE ALL PRIVILEGES ON `'+name+'`.* FROM '+testDatabaseAccount()+';');assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/')||resolve(root).startsWith(resolve(tmpdir())+'\\'));await rm(root,{recursive:true,force:true})});
 rootSql('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+name+'`.* TO '+testDatabaseAccount()+';');created=true;
 const passwordFile=join(root,'admin-password'),loginName='fixtureadmin',loginPassword=randomUUID();
 await writeFile(passwordFile,loginPassword,{mode:0o600});
 const installEnv={...process.env,NODE_ENV:'production',DATABASE_URL:url.href,STANDALONE_STATE_ROOT:join(root,'install-state'),STANDALONE_ADMIN_USERNAME:loginName,STANDALONE_ADMIN_PASSWORD_FILE:passwordFile};
 const {enterpriseId,alreadyInstalled}=await initializeStandalone(installEnv);
 assert.equal(alreadyInstalled,false);assert.equal((await initializeStandalone(installEnv)).alreadyInstalled,true);
 const installation=JSON.parse(await readFile(join(installEnv.STANDALONE_STATE_ROOT,'installed.json'),'utf8'));
 assert.equal(installation.enterpriseId,enterpriseId);assert.ok(installation.ownerId);
 await mkdir(apiRoot,{recursive:true});await cp('dist',dist,{recursive:true});
 await symlink(resolve('node_modules'),join(apiRoot,'node_modules'),'junction');
 await writeFile(join(root,'package.json'),JSON.stringify({type:'module',version:'0.1.0'}));
 const licensePath=join(root,'license');
 const preload=join(root,'deny-business.mjs');await writeFile(preload,`import {registerHooks} from 'node:module';registerHooks({load(url,context,next){if(/\\/photo-[^/]+\\.mjs$/.test(url)||/\\/core\\/(service|config|adapters)\\.mjs$/.test(url))throw Error('BUSINESS_MODULE_IMPORTED');return next(url,context)}});globalThis.fetch=async()=>{throw Error('FIXTURE_EXTERNAL_NETWORK_BLOCKED')};`);
 const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})});const port=await freePort(),uiPort=await freePort(),origin='http://127.0.0.1:3400',base='http://127.0.0.1:'+port;
 const env={...process.env,NODE_ENV:'production',DATABASE_URL:url.href,API_HOST:'127.0.0.1',API_PORT:String(port),ADMIN_ORIGIN:origin,PUBLIC_ADMIN_ORIGIN:'http://127.0.0.1:'+uiPort,ADMIN_DEMO_LOGIN:'true',ADMIN_STATE_PATH:join(root,'admin'),ADMIN_BOOTSTRAP_USERNAME:'fixtureAdmin',LICENSE_STATE_PATH:licensePath,STORAGE_PATH:join(root,'storage'),STORAGE_STATE_PATH:join(root,'storage-key'),BACKUP_DATABASE_URL:url.href,BACKUP_PATH:join(root,'backups'),BACKUP_KEY_PATH:join(root,'backup-keys'),PAYMENT_EXECUTION_ENABLED:'false'};
 const fileStore=new PlatformStorage(db,{root:env.STORAGE_PATH,keyRoot:env.STORAGE_STATE_PATH});await fileStore.init();
 const storageScope={tenantId:enterpriseId,userId:'same-user'},scopedStorage=fileStore.forApplication('storage-fixture'),target=await scopedStorage.uploadTarget(storageScope);
 const expiredRef=await scopedStorage.put(target,storageScope,Buffer.from('expiry fixture'),'png','image/png',new Date(Date.now()+60000),{retention:'expiry'});
 const protectedRef=await scopedStorage.put(target,storageScope,Buffer.from('application fixture'),'png','image/png',new Date(Date.now()+60000),{retention:'application'});
 await db.storageObject.updateMany({data:{expiresAt:new Date(Date.now()-1000)}});
 let output='';async function startApi(extra={}){await stop(child);output='';child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'dist/main.js'],{cwd:apiRoot,env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>{output+=c});child.stderr.on('data',c=>{output+=c});
 let ready=false;for(let i=0;i<100;i++){try{ready=(await(await fetch(base+'/health')).json()).ready===true}catch{}if(ready||child.exitCode!==null)break;await delay(100)}assert.ok(ready,output)}await startApi();
 for(let n=0;n<50;n++){if((await db.storageObject.findFirst({where:fileStore.reference(expiredRef)})).deletedAt)break;await delay(50)}
 assert.ok((await db.storageObject.findFirst({where:fileStore.reference(expiredRef)})).deletedAt,'empty host must run storage expiry without an application worker');
 assert.equal((await db.storageObject.findFirst({where:fileStore.reference(protectedRef)})).deletedAt,null,'unloaded application still owns its retained files');
 // Two individually valid image fields must reach authentication rather than fail at the JSON parser.
 const customerBody=JSON.stringify({version:0,config:{miniMode:'page',phone:'',wechat:'',description:'',avatar:'data:image/webp;base64,'+'A'.repeat(105000),qrCode:'data:image/webp;base64,'+'A'.repeat(105000)}});
 assert.ok(Buffer.byteLength(customerBody)>128*1024);
 const unauthenticated=await fetch(base+'/api/v1/admin/tenants/'+enterpriseId+'/consumer-settings/app-a/customerService',{method:'PUT',headers:{origin,'content-type':'application/json'},body:customerBody});assert.equal(unauthenticated.status,401);
 const signIn=(username,password,portal='tenant')=>fetch(base+'/api/v1/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password,portal})});
 const oldPortal=await signIn(loginName,loginPassword,'admin');assert.equal(oldPortal.status,404);
 const login=await signIn(loginName,loginPassword);assert.equal(login.status,200);const loginView=await login.json();
 assert.equal(loginView.integrationMode,'production');
 const auth=loginView.data,cookie=login.headers.getSetCookie().find(c=>c.startsWith('qicore_enterprise_session=')).split(';')[0],headers={origin,cookie,'x-console-portal':'tenant','x-csrf-token':auth.csrfToken,'content-type':'application/json'};
 assert.deepEqual(auth.tenantIds,[enterpriseId]);assert.equal(auth.role,'tenant');assert.ok(!auth.delegated);
 for(const path of ['/admin/auth/me','/admin/tenant-entry','/admin/tenants/'+enterpriseId+'/roles','/admin/tenants/'+enterpriseId+'/administrators','/admin/tenants/'+enterpriseId+'/site-settings']){
  const response=await fetch(base+'/api/v1'+path,{headers});assert.equal(response.status,200,path);const body=await response.json();assert.notEqual(body.mock,true);assert.notEqual(body.integrationMode,'development-mock');
 }
 for(const path of ['/admin/overview','/admin/platform-admins','/admin/roles','/admin/tenants']){
  assert.equal((await fetch(base+'/api/v1'+path,{headers})).status,404,path);
 }
 const publicHealth=await(await fetch(base+'/health')).json();assert.equal(publicHealth.ready,true);
 assert.deepEqual((await(await fetch(base+'/api/v1/admin/tenant-entry',{headers})).json()).data.applications,[]);
 const emptyAppOverview=await fetch(base+'/api/v1/admin/tenants/'+enterpriseId+'/overview',{headers});
 assert.equal(emptyAppOverview.status,409,'a business overview requires an actual application binding');
 assert.equal((await fetch(base+'/api/v1/admin/tenant-entry?tenantId=another-enterprise',{headers})).status,403);
 assert.equal((await fetch(base+'/api/v1/admin/tenant-entry',{headers:{...headers,'x-tenant-id':enterpriseId}})).status,400);
 assert.equal((await fetch(base+'/api/v1/admin/tenant-entry',{headers:{...headers,cookie:cookie+'; qicore_tenant_delegate=denied'}})).status,403);
 for(const path of ['/config','/jobs','/photos','/account','/apps/id-photo/config'])assert.equal((await fetch(base+'/api/v1'+path)).status,404,path);
 assert.equal((await fetch(base+'/api/v1/dev/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);
 for(const portal of ['admin','tenant']){const blocked=await fetch(base+'/api/v1/admin/auth/demo-login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({portal})});assert.equal(blocked.status,404);assert.notEqual((await blocked.json()).mock,true);assert.equal(blocked.headers.get('set-cookie'),null)}
 assert.equal((await fetch(base+'/api/v1/consumer/auth/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);
 assert.equal((await fetch(base+'/api/v1/install/authorization')).status,404);
 const tables=await db.$queryRawUnsafe('SHOW TABLES');for(const name of ['Photo','Job','Work','Grant','Unlock','Order','Ledger','GenerationCharge','AdSession','ProviderEvent','TenantImageAiSetting','TenantImageAiTest'])assert.ok(!tables.some(row=>Object.values(row).includes(name)),name+' is application-owned');
 assert.equal(await db.tenant.count(),1);
 for(const model of ['tenantApplication','consumerProfile','rechargeOrder','walletAccount'])assert.equal(await db[model].count(),0,model+' must remain empty');
 const roles=await db.adminRole.findMany({where:{portal:'tenant'}});assert.ok(roles.every(role=>role.permissions.every(p=>p.startsWith('tenant:'))));
 // Existing bindings survive an unavailable application; they do not mount its routes or grant menus.
 await assert.rejects(db.tenant.create({data:{id:'another-enterprise',name:'第二企业'}}),e=>e.code==='P2002');
 await db.tenantApplication.create({data:{tenantId:enterpriseId,applicationKey:'id-photo',config:{kept:true}}});
 const role=await db.adminRole.create({data:{id:randomUUID(),name:'保留授权',portal:'tenant',permissions:['overview.read','jobs.read','templates.read','orders.read','tenant:settings.read']}}),tenantPassword=randomUUID();
 await db.adminAccount.create({data:{id:randomUUID(),username:'retainedtenant',nickname:'只读管理员',passwordHash:await passwordHash(tenantPassword),roleId:role.id,scopes:{create:{tenantId:enterpriseId}}}});
 const tenantLogin=await fetch(base+'/api/v1/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'retainedtenant',password:tenantPassword,portal:'tenant'})});assert.equal(tenantLogin.status,200);
 const tenantCookie=tenantLogin.headers.getSetCookie().find(c=>c.startsWith('qicore_enterprise_session=')).split(';')[0],tenantHeaders={cookie:tenantCookie,'x-console-portal':'tenant'};
 const entry=await(await fetch(base+'/api/v1/admin/tenant-entry?tenantId='+enterpriseId,{headers:tenantHeaders})).json();assert.equal(entry.data.access,'no-applications');assert.equal(entry.data.canViewOverview,false);assert.deepEqual(entry.data.applications,[]);assert.deepEqual(entry.data.permissions,['tenant:settings.read']);
 const restored=await(await fetch(base+'/api/v1/admin/auth/me',{headers:tenantHeaders})).json();assert.deepEqual(restored.data.permissions,['tenant:settings.read']);assert.deepEqual(restored.data.permissionsByTenant[enterpriseId],['tenant:settings.read']);assert.ok((await db.adminRole.findUnique({where:{id:role.id}})).permissions.includes('jobs.read'),'stored grants are preserved, only effective loaded grants are exposed');
 assert.equal((await fetch(base+'/api/v1/admin/tenants/'+enterpriseId+'/apps/id-photo/jobs',{headers:tenantHeaders})).status,404);assert.equal(await db.tenantApplication.count(),1);
 // Test the existing compiled console against the empty host without changing the user's dev servers.
 const uiOutput=resolve(process.env.TEST_ADMIN_OUTPUT_DIR||'../admin/.output');server=spawn(process.execPath,[join(uiOutput,'server/index.mjs')],{cwd:resolve('../admin'),env:{...process.env,NITRO_HOST:'127.0.0.1',NITRO_PORT:String(uiPort),NUXT_API_INTERNAL_BASE:base+'/api/v1'},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
 let html;for(let i=0;i<100;i++){try{const response=await fetch('http://127.0.0.1:'+uiPort+'/admin/login');if(response.status===200){html=await response.text();break}}catch{}if(server.exitCode!==null)break;await delay(100)}assert.equal(html?.match(/<title>(.*?)<\/title>/)?.[1],'后台登录 · QiCore');assert.doesNotMatch(html,/开发演示登录|免密码/);
 const uiOrigin='http://127.0.0.1:'+uiPort;
 for(const path of ['/tenant','/tenant/login','/tenant/roles','/admin/tenants','/admin/saas-users']){
  assert.equal((await fetch(uiOrigin+path,{headers:{cookie},redirect:'manual'})).status,404,path);
 }
 const installPreview=await fetch(uiOrigin+'/install?preview=1');assert.ok(installPreview.status>=400,'source runtime cannot impersonate the installer');assert.doesNotMatch(await installPreview.text(),/开发预览/);
 const overview=await fetch(uiOrigin+'/admin',{headers:{cookie},redirect:'manual'});assert.equal(overview.status,302);assert.equal(new URL(overview.headers.get('location'),uiOrigin).pathname,'/admin/workbench');
 const entryPage=await fetch(uiOrigin+'/admin/workbench',{headers:{cookie:tenantCookie}});assert.equal(entryPage.status,200);const entryHtml=await entryPage.text();assert.equal(entryHtml.match(/<title>(.*?)<\/title>/)?.[1],'工作台 · QiCore');assert.ok(entryHtml.includes('常用功能'));assert.ok(!/href="\/(?:tenant(?:\/|")|admin\/(?:jobs|templates|works|orders)(?=["/?#]))/.test(entryHtml),'retired URLs and unavailable application links must be absent');
 for(const [path,title] of [['/','首页'],['/profile','个人中心'],['/login','登录'],['/help','帮助中心']]){
  const response=await fetch('http://127.0.0.1:'+uiPort+'/h5/'+enterpriseId+path);assert.equal(response.status,200,response.ok?path:path+' '+await response.text());const page=await response.text();assert.equal(page.match(/<title>(.*?)<\/title>/)?.[1],title+' · H5端');assert.ok(page.includes('"contentSource":"framework"'));assert.doesNotMatch(page,/application-assets\/id-photo/);
  const asset=page.match(/src="([^\"]+\.js)"/)?.[1];assert.ok(asset);assert.equal((await fetch('http://127.0.0.1:'+uiPort+asset)).status,200);
 }
 assert.doesNotMatch(output,/BUSINESS_MODULE_IMPORTED|Error:|STARTUP_BLOCKED/);
 await verifyStorageHost({base,uiBase:'http://127.0.0.1:'+uiPort,cookie,tenantCookie,enterpriseId,db,evidence:process.env.TEST_STORAGE_EVIDENCE_DIR||root});
 await verifyAdvertisingHost({root,db,base,origin,uiOrigin:'http://127.0.0.1:'+uiPort,startApi,enterpriseId,licensePath,ownerHeaders:headers});
});
