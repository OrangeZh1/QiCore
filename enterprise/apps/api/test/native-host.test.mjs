import {test} from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture} from './fixtures/native-release.mjs';
import {NativeHost} from '../dist/lifecycle/native-host.js';
import {resolveRuntimeProduct} from '../dist/license/client.js';
import fs from 'node:fs';
import {PassThrough} from 'node:stream';

test('unexpected runtime exit or spawn error fails the controller once; planned stops and candidate recovery remain owned by their engines',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const root=mkdtempSync(join(tmpdir(),'qicore-host-check-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});
 const f=fixture(root),current=await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 let child,failed=0;
 const original=childProcess.fork;
 childProcess.fork=()=>{child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null,send:(_message,done)=>{child.exitCode=0;child.emit('exit',0);done?.()}});return child};syncBuiltinESMExports();
 t.after(()=>{childProcess.fork=original;syncBuiltinESMExports()});
 const host=new NativeHost(f.state,undefined,()=>{failed++});
 for(const code of [0,1]){await host.start();assert.equal(host.running(),true);child.exitCode=code;child.emit('exit',code);assert.equal(host.running(),false)}
 assert.equal(failed,2);
 await host.start();child.emit('error',Error('spawn failed'));child.emit('exit',1);assert.equal(failed,3);assert.equal(host.running(),false);
 await host.start();await host.stop();assert.equal(failed,3);assert.equal(host.running(),false);
 for(const status of ['running','recovery_required']){
  f.state.component('frm_fixture').write('tasks.json',[{id:'candidate',status}]);
  await host.start();child.exitCode=1;child.emit('exit',1);assert.equal(failed,3);assert.equal(host.running(),false);
 }
 f.state.component('frm_fixture').write('tasks.json',[]);
 t.mock.timers.tick(1000);assert.equal(failed,3,'old runtime failures cannot terminate a replacement');
 f.state.component('frm_fixture').write('tasks.json',[{id:'closeout',status:'running'}]);
 await host.start();child.exitCode=1;child.emit('exit',1);assert.equal(failed,3);
 f.state.component('frm_fixture').write('tasks.json',[{id:'closeout',status:'succeeded'}]);
 t.mock.timers.tick(1000);assert.equal(failed,4,'an exit during healthy closeout must not disappear after the engine completes');
 f.state.component('frm_fixture').write('tasks.json',[]);
 f.state.component('frm_fixture').write('active.json',null);
 await host.start({key:'frm_fixture',slot:current});child.exitCode=1;child.emit('exit',1);assert.equal(failed,4);
});

test('runtime startup rejects a signed application with a missing declared frontend before spawning',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-host-layout-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=fixture(root);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 const descriptor={format:'qicore-application-v1',key:'fixture',packageKey:'app_fixture',version:'1.0.0',name:'Fixture',pendingTasks:[],web:{h5:{directory:'web/h5'}}};
 await f.install(f.release('app_fixture','1.0.0','0.0.0',{'server/main.mjs':'export const healthy=true;','application.json':JSON.stringify(descriptor)}));
 let spawned=false;const original=childProcess.fork;
 childProcess.fork=()=>{spawned=true;throw Error('UNEXPECTED_RUNTIME_START')};syncBuiltinESMExports();
 t.after(()=>{childProcess.fork=original;syncBuiltinESMExports()});
 await assert.rejects(new NativeHost(f.state).start(),/APPLICATION_LAYOUT_INCOMPLETE/);
 assert.equal(spawned,false);
});

test('health connects to loopback with the public SSR host so production domains are not mistaken for H5 sites',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-health-host-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=fixture(root),digest='a'.repeat(64),runtimeId='fixture-runtime';let seen='';
 writeFileSync(f.state.config.environmentFile,'ADMIN_ORIGIN="https://console.example.test"\n');
 const api=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/v1/public/site'){res.end(JSON.stringify({data:{platform:{name:'QiCore'}}}));return}res.end(JSON.stringify({ready:true,mock:false,version:'1.0.0',runtimeId,components:{frm_fixture:{version:'1.0.0',manifestSha256:digest}}}))});
 const ssr=createServer((req,res)=>{seen=req.headers.host;res.statusCode=seen==='console.example.test'?200:503;res.setHeader('content-type','text/html');res.end('<html><title>登录</title></html>')});
 await Promise.all([api,ssr].map(server=>new Promise(ok=>server.listen(0,'127.0.0.1',ok))));t.after(()=>Promise.all([api,ssr].map(server=>new Promise(ok=>{server.close(ok);server.closeAllConnections()}))));
 f.state.config.healthUrl='http://127.0.0.1:'+api.address().port+'/health';f.state.config.loginUrl='http://127.0.0.1:'+ssr.address().port+'/admin/login';
 const host=new NativeHost(f.state);host.runtimeId=runtimeId;host.frameworkVersion='1.0.0';host.running=()=>true;
 await host.health('frm_fixture','1.0.0',digest);assert.equal(seen,'console.example.test');
});

test('a signed active 0.1.1 runtime overrides stable 0.1.0 configuration and cross-checks actual package and health versions',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-runtime-version-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root,{version:'0.1.0'});
 const release=f.release('frm_fixture','0.1.1','0.1.0',{'server/main.mjs':'export const ready=true;','package.json':JSON.stringify({name:'qicore-runtime',type:'module',version:'0.1.1'})}),slot=await f.install(release),stable=structuredClone(f.state.config.product);
 let environment,spawned=0;const original=childProcess.fork;childProcess.fork=(_entry,_args,options)=>{environment=options.env;spawned++;const child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null,send:(_message,done)=>{child.exitCode=0;child.emit('exit',0);done?.()}});return child};syncBuiltinESMExports();t.after(()=>{childProcess.fork=original;syncBuiltinESMExports()});
 const host=new NativeHost(f.state);await host.start();const runtime=JSON.parse(environment.QICORE_PRODUCT),components=JSON.parse(environment.QICORE_COMPONENTS),pkg=JSON.parse(readFileSync(join(f.state.path('frm_fixture',slot),'package.json'),'utf8'));
 assert.equal(stable.version,'0.1.0');assert.equal(runtime.version,'0.1.1');assert.deepEqual({...runtime,version:stable.version},stable);assert.equal(resolveRuntimeProduct(runtime,pkg.version,components).version,'0.1.1');assert.deepEqual(f.state.config.product,stable);
 assert.throws(()=>resolveRuntimeProduct(runtime,'0.1.0',components),/RUNTIME_PRODUCT_VERSION_MISMATCH/);assert.throws(()=>resolveRuntimeProduct({...runtime,version:'0.1.0'},pkg.version,components),/RUNTIME_PRODUCT_VERSION_MISMATCH/);
 assert.equal(host.acceptsHealth({runtimeId:environment.QICORE_RUNTIME_ID,version:'0.1.0'}),false);assert.equal(host.acceptsHealth({runtimeId:environment.QICORE_RUNTIME_ID,version:'0.1.1'}),true);await host.stop();
 writeFileSync(join(f.state.path('frm_fixture',slot),'package.json'),JSON.stringify({...pkg,version:'0.1.2'}));await assert.rejects(host.start(),/LOCAL_RELEASE_MODIFIED/);assert.equal(spawned,1);
});
test('shutdown during signed tree verification prevents the final worker spawn',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-host-shutdown-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root),slot=await f.install(f.release('frm_fixture','0.1.1','0.1.0'));
 const file=join(f.state.path('frm_fixture',slot),'server/main.mjs'),bytes=readFileSync(file),stream=new PassThrough();let reached,spawned=false,blocked=false;const entered=new Promise(resolve=>reached=resolve),originalRead=fs.createReadStream,originalFork=childProcess.fork;
 fs.createReadStream=(path,...args)=>{if(String(path)===file&&!blocked){blocked=true;reached();return stream}return originalRead(path,...args)};childProcess.fork=()=>{spawned=true;throw Error('UNEXPECTED_SPAWN')};syncBuiltinESMExports();t.after(()=>{fs.createReadStream=originalRead;childProcess.fork=originalFork;syncBuiltinESMExports()});
 const host=new NativeHost(f.state),starting=host.start(),rejected=assert.rejects(starting,/RUNTIME_HOST_CLOSING/);await entered;await host.shutdown();stream.end(bytes);await rejected;assert.equal(spawned,false);assert.equal(host.running(),false);
});

test('only explicit unready startup cancellation uses abort IPC; observed readiness keeps nonzero drain failures strict',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-host-startup-stop-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=fixture(root);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 let host,child,exitCode=0,failSend=false,published=false;const messages=[],original=childProcess.fork;
 childProcess.fork=()=>{child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null,send:(message,done)=>{messages.push(message);if(failSend){failSend=false;done?.(Error('fixture send failed'));return}child.exitCode=exitCode;child.emit('exit',exitCode);done?.()}});return child};syncBuiltinESMExports();t.after(()=>{childProcess.fork=original;syncBuiltinESMExports()});
 const api=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ready:published,mock:false,version:'1.0.0',runtimeId:host.runtimeId}))});await new Promise(ok=>api.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>{api.close(ok);api.closeAllConnections()}));f.state.config.healthUrl='http://127.0.0.1:'+api.address().port+'/health';
 host=new NativeHost(f.state);await host.start();await host.stop({abortStartup:true});assert.equal(messages.at(-1),'abort-startup');
 exitCode=1;await host.start();await assert.rejects(host.stop(),/RUNTIME_DRAIN_FAILED/);assert.equal(messages.at(-1),'stop','ordinary stop cannot turn a startup failure into success');
 published=true;await host.start();await assert.rejects(host.stop({abortStartup:true}),/RUNTIME_DRAIN_FAILED/);assert.equal(messages.at(-1),'stop','actual HTTP readiness protects a started old runtime before explicit health was requested');
 await host.start();assert.equal(await host.available(),true);failSend=true;await assert.rejects(host.stop({abortStartup:true}),/RUNTIME_STOP_FAILED/);assert.equal(host.running(),true,'send failure did not stop the ready child');
 await assert.rejects(host.stop({abortStartup:true}),/RUNTIME_DRAIN_FAILED/);assert.deepEqual(messages.slice(-2),['stop','stop'],'a failed stop cannot erase readiness and turn its retry into startup abort');assert.equal(host.running(),false);
 published=false;exitCode=0;await host.start();await host.stop({abortStartup:true});assert.equal(messages.at(-1),'abort-startup','a new child does not inherit the prior child readiness');
});
