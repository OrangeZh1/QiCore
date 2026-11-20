import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {fixture,initialRelease} from './fixtures/native-release.mjs';
import {InstallServer,installationDatabaseUrl,installationDatabaseError,installationRedisUrl,installationRedisView} from '../dist/lifecycle/install-server.js';
import {NativeHost} from '../dist/lifecycle/native-host.js';
import {assertInitialDatabase} from '../dist/lifecycle/native-installation.js';
import {NativeState} from '../dist/lifecycle/native-state.js';
import {LicenseClient} from '../dist/license/client.js';
import {createHash} from 'node:crypto';

test('archive checks distinguish an old missing path from a damaged or mismatched delivery',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-archive-preflight-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const archive=join(root,'qicore-0.1.8-linux-x64.zip'),body=Buffer.from('fixture-archive'),options={archive,release:{artifact:{size:String(body.length),sha256:createHash('sha256').update(body).digest('hex')}}};
 await assert.rejects(InstallServer.prototype.archive.call({options}),/INSTALL_ARCHIVE_MISSING/);
 writeFileSync(archive,body);await InstallServer.prototype.archive.call({options});
 writeFileSync(archive,Buffer.from('X'+body.toString().slice(1)));await assert.rejects(InstallServer.prototype.archive.call({options}),/INSTALL_ARCHIVE_INVALID/);
});

test('environment reports a missing code directory and old archive path as separate safe failures',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-environment-paths-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root,{initial:true});
 rmdirSync(f.state.config.root);f.state.config.runtimeUid=process.getuid?.()||1000;f.state.config.runtimeGid=process.getgid?.()||1000;
 const archive=join(root,'qicore-0.1.4-linux-x64.zip'),release=f.release('frm_fixture','0.1.0','0.0.0').release;
 const result=await InstallServer.prototype.environment.call({options:{state:f.state,archive,release,redisUrl:'redis://127.0.0.1:1/0'},archive:InstallServer.prototype.archive});
 const paths=result.checks.find(c=>c.key==='paths'),files=result.checks.find(c=>c.key==='archive');assert.equal(paths.passed,false);assert.match(paths.message,/代码目录不存在/);assert.ok(paths.message.includes(f.state.config.root));assert.equal(files.code,'INSTALL_ARCHIVE_MISSING');assert.ok(files.message.includes(archive));assert.equal(result.passed,false);
});

test('installation database fields preserve reserved characters and reject root or malformed endpoints',()=>{
 const input={host:'127.0.0.1',port:3306,database:'fresh',username:'user@local',password:'a%#:/?'};
 const url=new URL(installationDatabaseUrl(input));assert.equal(decodeURIComponent(url.username),input.username);assert.equal(decodeURIComponent(url.password),input.password);
 assert.throws(()=>installationDatabaseUrl({...input,username:'root'}));assert.throws(()=>installationDatabaseUrl({...input,host:'localhost:3306'}));
});

test('database checks classify safe errors and preserve engine failures when disconnect also fails',()=>{
 for(const [code,expected] of Object.entries({P1000:'AUTHENTICATION',P1001:'UNREACHABLE',P1002:'UNREACHABLE',P1003:'MISSING',P1010:'PERMISSION'}))assert.equal(installationDatabaseError({errorCode:code,message:'must not expose connection credentials'}),'INSTALL_DATABASE_'+expected);
 assert.equal(installationDatabaseError(Error('INSTALL_DATABASE_NOT_EMPTY')),'INSTALL_DATABASE_NOT_EMPTY');
 const module=new URL('../dist/lifecycle/install-server.js',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';import {InstallServer} from ${JSON.stringify(module)};await assert.rejects(InstallServer.prototype.database.call({}, {host:'127.0.0.1',port:1,database:'fixture',username:'fixture',password:'not-a-real-password'}),{message:'INSTALL_DATABASE_ENGINE'});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,PRISMA_QUERY_ENGINE_LIBRARY:join(tmpdir(),'qicore-engine-does-not-exist-'+randomUUID()+'.node')},encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr);
});

test('a closed database port remains a connection error instead of a query-engine error',async()=>{
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 await assert.rejects(InstallServer.prototype.database.call({}, {host:'127.0.0.1',port,database:'fixture',username:'fixture',password:'fixture-only'}),{message:'INSTALL_DATABASE_UNREACHABLE'});
});
test('Redis configuration preserves encoded credentials without returning the password',()=>{
 const input={host:'::1',port:6380,database:2,username:'user@host',password:'a%#:/?',tls:true},url=installationRedisUrl(input);
 assert.equal(decodeURIComponent(new URL(url).password),input.password);assert.equal(new URL(url).hostname,'[::1]');assert.equal(new URL(url).protocol,'rediss:');
 const {password,...reuse}=input;assert.equal(installationRedisUrl(reuse,url),url);assert.equal(new URL(installationRedisUrl({...reuse,password:''},url)).password,'');
 assert.equal(installationRedisView(url).hasPassword,true);assert.equal('password' in installationRedisView(url),false);
 for(const invalid of [{...input,host:'host:6379'},{...input,password:'bad\nsecret'},{...input,port:0},{...input,database:-1}])assert.throws(()=>installationRedisUrl(invalid));
});
test('initialization checks server version and preserves nonempty or nested targets',async t=>{
 const db=(version,rows=[])=>({$queryRawUnsafe:async sql=>sql.includes('VERSION()')?[{version}]:rows});
 await assertInitialDatabase(db('8.0.46'));await assertInitialDatabase(db('8.4.0'));
 for(const version of ['5.7.44','10.11-MariaDB'])await assert.rejects(assertInitialDatabase(db(version)),/INSTALL_DATABASE_VERSION/);
 await assert.rejects(assertInitialDatabase(db('8.0.46',[{TABLE_NAME:'customer'}])),/INSTALL_DATABASE_NOT_EMPTY/);
 const root=mkdtempSync(join(tmpdir(),'qicore-install-path-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root);
 assert.throws(()=>new NativeState({...f.state.config,dataRoot:join(f.state.config.root,'..data')}),/PERSISTENT_PATH_IN_RELEASE_ROOT/);
});
test('installer HTTP enforces session, origin and CSRF, hides credentials and closes after durable installation',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-install-http-')),f=fixture(root,{initial:true}),origin='http://127.0.0.1:3500';
 const before=f.client.status().receipt;let authorizationCalls=0;f.client.transport=async()=>new Response(JSON.stringify({receipt:f.envelope({...before,revision:before.revision+(++authorizationCalls),issued_at:new Date().toISOString()})}));
 const server=new InstallServer({state:f.state,host:new NativeHost(f.state),client:f.client,controlRoot:join(root,'controller'),nativeConfigFile:join(root,'native.json'),archive:join(root,'fixture.zip'),release:initialRelease(f.release('frm_fixture','0.1.0','0.0.0').release),adminOrigin:origin,redisUrl:'redis://127.0.0.1:1'});
 t.after(async()=>{await server.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});await new Promise(ok=>server.server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.server.address().port;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const publicState=(await(await fetch(base+'/state')).json()).data;assert.equal(publicState.authenticated,false);assert.equal(publicState.csrf,undefined);assert.equal(publicState.job,undefined);
 assert.equal((await(await fetch(base+'/authorization')).json()).data.allowed,true);await fetch(base+'/authorization');assert.equal(authorizationCalls,1,'public domain checks share a short cache');
 assert.equal((await post('/environment',{})).status,401);assert.equal((await post('/execute',{})).status,401);assert.equal((await post('/resume-health',{})).status,401);
 const linkToken=()=>new URLSearchParams(new URL(server.launchUrl()).hash.slice(1)).get('setup');
 const oldToken=linkToken(),expiredToken=linkToken();assert.equal((await post('/session',{token:oldToken})).status,401);
 server.store.write('launch.json',{...server.store.read('launch.json'),expires:0});assert.equal((await post('/session',{token:expiredToken})).status,401);
 const token=linkToken();assert.equal((await post('/session',{token},{origin:'https://wrong.example'})).status,409);
 assert.equal((await post('/session',{token:'wrong'})).status,401);const session=await post('/session',{token}),view=(await session.json()).data,cookie=session.headers.getSetCookie()[0].split(';')[0],headers={cookie,'x-install-csrf':view.csrf};
 assert.equal((await post('/session',{token})).status,401,'launch links cannot be replayed');assert.equal(server.store.read('launch.json'),null);
 assert.ok(session.headers.getSetCookie()[0].includes('HttpOnly'));assert.equal((await post('/authorization',{}, {cookie})).status,409);
 assert.equal((await(await post('/authorization',{},headers)).json()).data.allowed,true);const state=(await(await fetch(base+'/state',{headers:{cookie}})).json()).data;assert.equal(state.authenticated,true);assert.ok(!JSON.stringify(state).includes(token));assert.ok(!JSON.stringify(state).includes(server.store.read('access.json').secret));
 const id=randomUUID(),store=f.state.component('frm_fixture');store.write('installation.json',{id,status:'recovery_required',phase:'migration'});server.store.write('request.json',{id,hash:'fixture',status:'recovery_required'});
 assert.equal(server.status().canResume,false);assert.equal((await post('/resume-health',{requestId:id},headers)).status,409);
 store.write('installation.json',{id,status:'recovery_required',phase:'health'});assert.equal(server.status().canResume,true);
 assert.equal((await post('/resume-health',{requestId:id},{cookie})).status,409);assert.equal((await post('/resume-health',{requestId:id},{...headers,origin:'https://wrong.example'})).status,409);assert.equal((await post('/resume-health',{requestId:randomUUID()},headers)).status,409);
 store.write('installation.json',{id,status:'succeeded',phase:'completion'});store.write('installed-receipt.json',{attemptId:id});store.write('active.json',{taskId:'later-update',health:'passed',current:{version:'0.2.0'}});
 assert.equal(server.completed(),true);assert.equal((await post('/authorization',{},headers)).status,410);assert.equal((await post('/execute',{},headers)).status,410);assert.equal((await(await fetch(base+'/status',{headers:{cookie}})).json()).data.complete,true);
 assert.equal((await post('/resume-health',{requestId:id},headers)).status,410);
});

test('customer domain controls the launch link, authorization and origin gate without accepting an old-domain receipt',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-install-customer-')),f=fixture(root,{initial:true});
 const old=f.client.status().receipt,origin='https://qisaas.vipui.cn';let contacted=false,requestedDomain;
 const client=new LicenseClient(f.client.store,f.product,'qisaas.vipui.cn',async(url,options)=>{
  contacted=true;requestedDomain=JSON.parse(options.body).domain;
  return new Response(JSON.stringify({instanceId:client.identity().instanceId,receipt:f.envelope({...old,authorized_domain:client.domain,revision:old.revision+1,issued_at:new Date(Date.now()+1000).toISOString()})}));
 });
 const server=new InstallServer({state:f.state,host:new NativeHost(f.state),client,controlRoot:join(root,'controller'),nativeConfigFile:join(root,'native.json'),archive:join(root,'fixture.zip'),release:initialRelease(f.release('frm_fixture','0.1.0','0.0.0').release),adminOrigin:origin,redisUrl:'redis://127.0.0.1:1'});
 t.after(async()=>{await server.close();rmSync(root,{recursive:true,force:true})});
 assert.throws(()=>client.status(),/RECEIPT_BINDING_MISMATCH/);
 assert.equal(new URL(server.launchUrl()).origin,origin);
 const result=await server.authorization();assert.equal(contacted,true);assert.equal(requestedDomain,'qisaas.vipui.cn');assert.equal(result.domain,'qisaas.vipui.cn');assert.equal(result.allowed,true);
 await new Promise(ok=>server.server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.server.address().port;
 const token=new URLSearchParams(new URL(server.launchUrl()).hash.slice(1)).get('setup');
 for(const testedOrigin of ['https://qicore.mcent.cn',origin]){
  const response=await fetch(base+'/session',{method:'POST',headers:{origin:testedOrigin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(response.status,testedOrigin===origin?200:409);
 }
});
