import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile,readdir,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {fixture} from './fixtures/native-release.mjs';
import {testMysqlClient,testDatabaseAccount} from './fixtures/mysql-tools.mjs';
import {NativeHost} from '../dist/lifecycle/native-host.js';
import {installNative} from '../dist/lifecycle/native-installation.js';
import {LicenseClient} from '../dist/license/client.js';
import {StateStore} from '../dist/license/store.js';
import {nativeArchiveManifestSchema} from '../dist/license/native-release.js';
import {verifyApplicationFlow} from './fixtures/native-application-flow.mjs';
import {verifyFrameworkUpdate} from './fixtures/native-framework-flow.mjs';
import {verifyInitialRepair} from './fixtures/native-initial-repair-flow.mjs';
import {nativeDependencyOmission,prismaQueryEngine} from '../../../scripts/native-runtime-policy.mjs';
import {nativeCheckTimeout} from './fixtures/native-check-budget.mjs';

for(const name of ['NATIVE_PACKAGE_DIR','TEST_DATABASE_URL','TEST_RESTORE_ROOT_CONFIG','REDIS_URL'])assert.ok(process.env[name],name+' required');
assert.equal(process.platform,'linux');
const freePort=()=>new Promise((ok,fail)=>{const s=createServer();s.on('error',fail);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>ok(port))})});

const timeout=nativeCheckTimeout();
test('complete Linux archive installs only into an empty database, commits real health and restarts without the checkout',{timeout},async t=>{
 const started=performance.now(),phase=label=>console.log('[native-package +'+((performance.now()-started)/1000).toFixed(1)+'s] '+label);
 phase('START total harness budget='+timeout+'ms');
 const pkg=resolve(process.env.NATIVE_PACKAGE_DIR),manifest=nativeArchiveManifestSchema.parse(JSON.parse(await readFile(join(pkg,'release-manifest.json'),'utf8'))),report=JSON.parse(await readFile(join(pkg,'package-report.json'),'utf8'));
 const archive=join(pkg,report.archive),root=await mkdtemp(join(tmpdir(),'qicore-native-install-'));
 assert.ok(!manifest.files.some(file=>/^node_modules\/(?:typescript|nuxt|vite|vue-tsc|esbuild)\//.test(file.path)),'build tools must not enter the runtime package');
 assert.ok(!manifest.files.some(file=>nativeDependencyOmission(file.path)),'unused Prisma payloads must not enter the runtime package');
 assert.equal(manifest.files.filter(file=>file.path.endsWith('/'+prismaQueryEngine)).length,1,'one query engine per runtime');
 for(const path of ['apps/api/dist/file-service/service.mjs','apps/api/dist/data-safety/service.mjs','node_modules/qiniu/qiniu/storage-code/form.js','node_modules/multer/storage-code/memory.js'])assert.ok(manifest.files.some(file=>file.path===path),'runtime module is required: '+path);
 const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');
 const name='qicore_native_qa_'+randomUUID().replaceAll('-','').slice(0,16);assert.match(name,/^qicore_native_qa_[a-f0-9]{16}$/);url.pathname='/'+name;
 const rootSql=sql=>{const r=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:sql,encoding:'utf8'});assert.equal(r.status,0,'isolated schema operation failed')};
 const preload=join(root,'deny-external.mjs');await writeFile(preload,`import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';const allowed=['127.0.0.1','localhost','[::1]'];function check(input){const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';if(!allowed.includes(host))throw Error('TEST_EXTERNAL_NETWORK_BLOCKED')}const original=globalThis.fetch;globalThis.fetch=(input,options)=>{check(input?.url||input);return original(input,options)};for(const module of [http,https])for(const method of ['request','get']){const original=module[method];module[method]=function(input,...args){check(input);return original.call(this,input,...args)}}syncBuiltinESMExports();`);
 class IsolatedHost extends NativeHost {async start(initial){const text=await readFile(this.state.config.environmentFile,'utf8');if(!text.includes('NODE_OPTIONS='))await appendFile(this.state.config.environmentFile,'NODE_OPTIONS="--import='+pathToFileURL(preload).href+'"\n');return super.start(initial)}}
 const f=fixture(root,{frameworkKey:manifest.package_key,version:manifest.version,initial:true}),state=f.state,config=state.config,host=new IsolatedHost(state),db=new PrismaClient({datasources:{db:{url:url.href}}});let created=false;
 t.after(async()=>{phase('CLEANUP start');await host.stop();await db.$disconnect();if(created)rootSql('DROP DATABASE `'+name+'`; REVOKE ALL PRIVILEGES ON `'+name+'`.* FROM '+testDatabaseAccount()+';');assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/qicore-native-install-'));await rm(root,{recursive:true,force:true});phase('CLEANUP done')});
 const apiPort=await freePort(),adminPort=await freePort();config.healthUrl='http://127.0.0.1:'+apiPort+'/health';config.loginUrl='http://127.0.0.1:'+adminPort+'/admin/login';config.migrationUrl=url.href;config.runtimeUid=process.getuid();config.runtimeGid=process.getgid();
 // Sign the exact production candidate bytes with independent test keys. No real authority is impersonated.
 const release=f.signArchive(manifest,await readFile(archive)),input={requestId:randomUUID(),archive,release,administrator:{username:'installAdmin',password:'123456'},redisUrl:process.env.REDIS_URL,adminOrigin:'http://127.0.0.1:'+adminPort,acceptTerms:true};
 const invalid=structuredClone(input);invalid.release.artifact.sha256='0'.repeat(64);await assert.rejects(installNative(state,f.client,host,invalid),/RELEASE_IDENTITY_MISMATCH/);
 const unauthorized=new LicenseClient(new StateStore(join(root,'unlicensed')),f.product,'127.0.0.1');await assert.rejects(installNative(state,unauthorized,host,input),/INSTALL_LICENSE_IDENTITY_MISMATCH/);
 rootSql('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+name+'`.* TO '+testDatabaseAccount()+';');created=true;
 await db.$executeRawUnsafe('CREATE TABLE installer_protected (id INT)');await db.$executeRawUnsafe('INSERT INTO installer_protected VALUES (7)');
 await assert.rejects(installNative(state,f.client,host,input),/INSTALL_DATABASE_NOT_EMPTY/);assert.equal((await db.$queryRawUnsafe('SELECT id FROM installer_protected'))[0].id,7);
 await db.$executeRawUnsafe('DROP TABLE installer_protected');
 // External traffic is blocked in the runtime via a preload outside the immutable release.
 // NativeHost inherits only its private env; test transport blocks the installer itself.
 f.client.transport=async()=>{throw Error('TEST_EXTERNAL_NETWORK_BLOCKED')};
 // The migration CLI must not silently download a removed duplicate engine.
 const oldNodeOptions=process.env.NODE_OPTIONS;process.env.NODE_OPTIONS=[oldNodeOptions,'--import='+pathToFileURL(preload).href].filter(Boolean).join(' ');
 phase('EMPTY_DATABASE_INSTALL start');
 let result;try{result=await installNative(state,f.client,host,input)}finally{if(oldNodeOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldNodeOptions}
 assert.equal(result.status,'succeeded',JSON.stringify(result));
 phase('EMPTY_DATABASE_INSTALL done');
 assert.equal(state.active(config.frameworkKey).health,'passed');assert.equal(state.active(config.frameworkKey).previous,null);
 assert.equal(state.installed().length,1);assert.equal(await db.adminAccount.count(),1);
 for(const model of ['tenant','tenantApplication','consumerProfile','rechargeOrder','walletAccount'])assert.equal(await db[model].count(),0,model);
 const tables=await db.$queryRawUnsafe('SHOW TABLES');assert.ok(!tables.some(row=>Object.values(row).includes('Photo')));
 assert.deepEqual((await readdir(state.directory(config.frameworkKey))).sort(),['current.json','releases']);
 const privateEnv=await readFile(config.environmentFile,'utf8');assert.ok(!privateEnv.includes('123456'));assert.ok(!JSON.stringify(state.component(config.frameworkKey).read('installation.json')).includes('123456'));
 const login=await fetch('http://127.0.0.1:'+apiPort+'/api/v1/admin/auth/login',{method:'POST',headers:{origin:input.adminOrigin,'content-type':'application/json'},body:JSON.stringify({...input.administrator,portal:'admin'})});assert.equal(login.status,200);
 const html=await(await fetch(config.loginUrl)).text();assert.equal(html.match(/<title>(.*?)<\/title>/)?.[1],'总后台登录 · QiCore');
 assert.equal((await installNative(state,f.client,host,input)).status,'succeeded');
 await assert.rejects(installNative(state,f.client,host,{...input,administrator:{...input.administrator,password:'different'}}),/INSTALL_TARGET_CHANGED/);
 await appendFile(config.environmentFile,'PRISMA_QUERY_ENGINE_LIBRARY="/untrusted-host-engine.node"\n');
 phase('INITIAL_RESTART start');
 await host.stop();await host.start();await host.health(config.frameworkKey,release.version,release.artifact.manifestSha256);
 const health=await(await fetch(config.healthUrl)).json();assert.equal(health.mock,false);assert.deepEqual(health.components[config.frameworkKey],{version:release.version,manifestSha256:release.artifact.manifestSha256});
 assert.equal(await db.adminAccount.count(),1);await state.verifyCurrent(config.frameworkKey);
 phase('INITIAL_RESTART done');phase('SAME_VERSION_REPAIR start');
 await verifyInitialRepair({f,host,db,pkg,root,manifest});
 phase('SAME_VERSION_REPAIR done');phase('APPLICATION_LIFECYCLE start');
 await verifyApplicationFlow({f,host,db,pkg,origin:input.adminOrigin,apiBase:'http://127.0.0.1:'+apiPort});
 phase('APPLICATION_LIFECYCLE done');phase('DERIVED_FRAMEWORK_UPDATE start');
 await verifyFrameworkUpdate({f,host,db,pkg,root,manifest,origin:input.adminOrigin,apiBase:'http://127.0.0.1:'+apiPort});
 phase('DERIVED_FRAMEWORK_UPDATE done');
 await writeFile(join(pkg,'installation-report.json'),JSON.stringify({status:'passed',version:release.version,archiveSha256:release.artifact.sha256,files:manifest.files.length,emptyDatabaseMigration:'passed',signedAuthorization:'test keys, normal verification',initialAdminMinimum:6,login:'passed',ssrTitle:'passed',restart:'passed',idempotency:'passed',nonemptyDatabase:'rejected and preserved',initialApplicationsInstalled:0,finalApplicationsInstalled:1,productionSigning:false},null,2)+'\n');
 phase('COMPLETE');
});
