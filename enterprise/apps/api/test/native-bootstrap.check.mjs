import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,readFile,writeFile,chmod,stat,readdir,rm} from 'node:fs/promises';
import {tmpdir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,hash} from './fixtures/native-release.mjs';

assert.equal(process.platform,'linux');assert.ok(process.env.NATIVE_PACKAGE_DIR);
const port=()=>new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value))})});
test('packaged launcher initializes host configuration, serves installation UI and keeps runtime unprivileged',{timeout:90000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-bootstrap-check-'));await chmod(root,0o755);const pkg=resolve(process.env.NATIVE_PACKAGE_DIR),report=JSON.parse(await readFile(join(pkg,'package-report.json'),'utf8')),manifest=JSON.parse(await readFile(join(pkg,'release-manifest.json'),'utf8'));
 const f=fixture(join(root,'test-signing'),{initial:true,frameworkKey:manifest.package_key,version:manifest.version}),bootstrap=join(root,'bundle/bootstrap'),incoming=join(root,'bundle/incoming'),secret=join(root,'config/bootstrap.json');
 // Only code/ is the restricted fixture; bootstrap/UI still needs a traversable site root.
 await mkdir(join(root,'bundle'),{mode:0o755});
 // Reproduce a deployer-created 0750 root:root code directory before first startup.
 await mkdir(join(root,'bundle/code'),{recursive:true,mode:0o750});await chmod(join(root,'bundle/code'),0o750);
 await cp(join(pkg,'bootstrap'),bootstrap,{recursive:true});await mkdir(incoming,{recursive:true});const archive=await readFile(join(pkg,report.archive));await writeFile(join(incoming,report.archive),archive);await writeFile(join(incoming,'release.json'),JSON.stringify(f.signArchive(manifest,archive)));
 const adminPort=await port(),apiPort=await port(),settings={adminOrigin:'http://127.0.0.1:'+adminPort,adminPort,apiPort,uiPort:await port()},delivery={format:'qicore-bootstrap-delivery-v1',product:f.product,archive:report.archive,privateRoot:join(root,'private'),backupRoot:join(root,'backups'),runtimeUser:process.env.QICORE_TEST_RUNTIME_USER||userInfo().username},deliveryBytes=Buffer.from(JSON.stringify(delivery));
 await writeFile(join(root,'bundle/deployment.json'),JSON.stringify(settings));
 await writeFile(join(bootstrap,'delivery.json'),deliveryBytes);const inventory=JSON.parse(await readFile(join(bootstrap,'bootstrap-manifest.json'),'utf8'));inventory.files.push({path:'delivery.json',size:deliveryBytes.length,sha256:hash(deliveryBytes)});await writeFile(join(bootstrap,'bootstrap-manifest.json'),JSON.stringify(inventory));
 await writeFile(join(bootstrap,'.htaccess'),'# 请将伪静态规则或自定义Apache配置填写到此处\n');
 let child,launchLink;const stop=async()=>{if(!child||child.exitCode!==null)return;const current=child;current.kill('SIGTERM');for(let i=0;i<150&&current.exitCode===null;i++)await delay(100);assert.notEqual(current.exitCode,null,'launcher must stop its UI and controller');child=undefined};
 t.after(async()=>{await stop();assert.ok(root.startsWith(join(tmpdir(),'qicore-bootstrap-check-')));await rm(root,{recursive:true,force:true})});
 const launch=async()=>{child=spawn(process.execPath,[join(bootstrap,'start.mjs'),secret],{env:{...process.env,PRISMA_QUERY_ENGINE_LIBRARY:join(root,'untrusted-host-engine.node')},stdio:['ignore','pipe','pipe']});let ready=false,errors='',output='';child.stdout.on('data',bytes=>{output+=bytes.toString();launchLink=output.match(/http:\/\/127\.0\.0\.1:\d+\/install#setup=[A-Za-z0-9_-]+/)?.[0];ready=!!launchLink});child.stderr.on('data',bytes=>errors+=bytes);for(let i=0;i<150&&!ready&&child.exitCode===null;i++)await delay(100);assert.ok(ready,errors);assert.equal((await(await fetch(settings.adminOrigin+'/health')).json()).stage,'installation')};
 await launch();const config=JSON.parse(await readFile(secret,'utf8'));assert.equal((await stat(secret)).mode&0o777,0o600);assert.ok(config.native.runtimeUid>0);assert.equal((await stat(config.native.licenseStateRoot)).uid,config.native.runtimeUid);assert.deepEqual(await readdir(config.native.licenseStateRoot),[]);
 assert.equal((await stat(config.native.root)).mode&0o777,0o755);
 const access=spawnSync(process.execPath,['-e',"require('node:fs').accessSync(process.argv[1],5)",config.native.root],{uid:config.native.runtimeUid,gid:config.native.runtimeGid,stdio:'pipe'});assert.equal(access.status,0,'the real runtime user must traverse the existing code root');
 for(const method of ['GET','HEAD'])for(const path of ['/','/?from=bookmark','/profile','/admin/login','/tenant/orders']){
  const response=await fetch(settings.adminOrigin+path,{method,redirect:'manual',headers:{host:'customer.example.test'}});
  assert.equal(response.status,302,path);assert.equal(response.headers.get('location'),'/install');assert.equal(response.headers.get('cache-control'),'no-store, private');
 }
 const page=await fetch(settings.adminOrigin+'/install',{headers:{host:'customer.example.test'}});assert.equal(page.status,200);assert.match(await page.text(),/<title>安装须知 · 安装引导 · QiCore<\/title>/);
 const token=new URLSearchParams(new URL(launchLink).hash.slice(1)).get('setup'),session=await fetch(settings.adminOrigin+'/api/v1/install/session',{method:'POST',headers:{origin:settings.adminOrigin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(session.status,200);
 const csrf=(await session.json()).data.csrf,cookie=session.headers.get('set-cookie').split(';')[0];
 const unreachable=await fetch(settings.adminOrigin+'/api/v1/install/database',{method:'POST',headers:{origin:settings.adminOrigin,'content-type':'application/json','x-install-csrf':csrf,cookie},body:JSON.stringify({host:'127.0.0.1',port:await port(),database:'fixture',username:'fixture',password:'fixture-only'})});
 assert.equal((await unreachable.json()).error.code,'INSTALL_DATABASE_UNREACHABLE','the packaged engine must initialize despite an unrelated host override');
 assert.equal(JSON.parse(await readFile(join(config.controlRoot,'bootstrap-init.json'),'utf8')).status,'complete');const before=hash(await readFile(secret));
 const duplicate=spawnSync(process.execPath,[join(bootstrap,'start.mjs'),secret],{encoding:'utf8',timeout:30000});assert.equal(duplicate.status,73,duplicate.stderr);await stop();await launch();assert.equal(hash(await readFile(secret)),before);
 await stop();settings.adminPort=await port();settings.apiPort=await port();settings.uiPort=await port();settings.adminOrigin='http://127.0.0.1:'+settings.adminPort;
 await writeFile(join(root,'bundle/deployment.json'),JSON.stringify(settings));await launch();
 const updated=JSON.parse(await readFile(secret,'utf8'));assert.equal(updated.adminOrigin,settings.adminOrigin);assert.equal(updated.publicPort,settings.adminPort);assert.equal(new URL(updated.native.healthUrl).port,String(settings.apiPort));assert.equal(new URL(updated.native.loginUrl).port,String(settings.uiPort));assert.equal(updated.native.maintenancePort,undefined);
 assert.equal((await(await fetch(settings.adminOrigin+'/api/v1/public/maintenance')).json()).data.protocol,'qicore-maintenance-v1');
 assert.ok(!(await readdir(join(root,'config'))).some(name=>name.startsWith('nginx')));
});
