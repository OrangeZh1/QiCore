// Real Linux worker/Host regression without a database. Candidate abort remains a distinct operation from ready draining.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/native-release.mjs';
import {NativeHost} from '../dist/lifecycle/native-host.js';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';

assert.equal(process.platform,'linux');assert.ok(process.getuid()>0,'Use the isolated non-root Linux acceptance account');
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const port=()=>new Promise(ok=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>ok(value))})});
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
async function setup(t,mode='ready'){
 const root=await mkdtemp(join(tmpdir(),'qicore-startup-abort-')),f=fixture(root),apiPort=await port(),adminPort=await port(),owned=new Set();let unexpected=0;
 Object.assign(f.state.config,{runtimeUid:process.getuid(),runtimeGid:process.getgid(),healthUrl:'http://127.0.0.1:'+apiPort+'/health',loginUrl:'http://127.0.0.1:'+adminPort+'/admin/login'});
 const marker=join(root,'signal-handler-ready');
 const ready=`import http from 'node:http';import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const entry=JSON.parse(process.env.QICORE_COMPONENTS).frm_fixture;
 const api=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/v1/public/site'?{data:{platform:{name:'QiCore'}}}:{ready:true,mock:false,version:entry.version,runtimeId:process.env.QICORE_RUNTIME_ID,components:{frm_fixture:{version:entry.version,manifestSha256:entry.manifestSha256}}}))});
 const admin=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<html><title>isolated runtime</title></html>')});api.listen(${apiPort},'127.0.0.1');admin.listen(${adminPort},'127.0.0.1');process.on('SIGTERM',()=>{api.close();admin.close();process.exit(${mode==='ready-failure'?17:0})});
 ${mode==='ready-leftover'?`const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});descendant.once('spawn',()=>{writeFileSync(${JSON.stringify(marker+'.descendant')},String(descendant.pid));writeFileSync(${JSON.stringify(marker)},'ready')});`:''}`;
 const unready=mode==='unready-leftover'?`import{writeFileSync}from'node:fs';import{spawn}from'node:child_process';
 const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 descendant.once('spawn',()=>{writeFileSync(${JSON.stringify(marker+'.descendant')},String(descendant.pid));writeFileSync(${JSON.stringify(marker)},'ready')});setInterval(()=>{},1000);`
 :`import{writeFileSync}from'node:fs';const stop=()=>{${mode==='unready-kill'?'process.kill(process.pid,"SIGKILL")':'process.exit(17)'}};process.on('SIGTERM',stop);process.on('SIGUSR2',stop);writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);`;
 const release=f.release('frm_fixture','1.0.0','0.0.0',{'server/main.mjs':mode.startsWith('unready')?unready:ready}),slot=await f.install(release);
 await writeFile(f.state.config.environmentFile,'ADMIN_ORIGIN="http://127.0.0.1:'+adminPort+'"\nNODE_OPTIONS="--max-old-space-size=128"\n');
 const host=new NativeHost(f.state,undefined,()=>{unexpected++}),effects=new NativeEffects(f.state,host,f.client,'frm_fixture',randomUUID());
 async function track(){assert.ok(host.child?.pid);owned.add(host.child.pid);for(let i=0;i<100;i++){try{const children=(await readFile('/proc/'+host.child.pid+'/task/'+host.child.pid+'/children','utf8')).trim().split(/\s+/).filter(Boolean).map(Number);if(children.length){for(const pid of children)owned.add(pid);return}}catch(error){if(error.code!=='ENOENT')throw error}await delay(10)}throw Error('FIXTURE_RUNTIME_NOT_SPAWNED')}
 async function assertStopped(){for(let i=0;i<200&&[...owned].some(alive);i++)await delay(10);assert.deepEqual([...owned].filter(alive),[],'task-owned worker and runtime must exit')}
 async function trackDescendant(){const pid=Number(await readFile(marker+'.descendant','utf8'));assert.ok(Number.isInteger(pid)&&pid>0);const status=await readFile('/proc/'+pid+'/stat','utf8'),fields=status.slice(status.lastIndexOf(')')+2).split(/\s+/),parent=Number(fields[1]),group=Number(fields[2]);assert.ok(owned.has(parent),'descendant must belong to this fixture runtime');assert.equal(group,parent,'descendant must share the detached entry process group');owned.add(pid);return pid}
 t.after(async()=>{let failure;try{await host.shutdown();await assertStopped();assert.equal(unexpected,0)}catch(error){failure=error;for(const pid of owned)if(alive(pid))try{process.kill(pid,'SIGKILL')}catch{}}if(![...owned].some(alive)){assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/qicore-startup-abort-'));await rm(root,{recursive:true,force:true})}if(failure)throw failure});
 return{root,f,host,effects,slot,release,track,trackDescendant,assertStopped,marker};
}

test('cold candidate startup cancellation releases the worker and allows the real old runtime to restart',{timeout:20000},async t=>{
 const e=await setup(t);await e.host.start();await e.host.health('frm_fixture','1.0.0',e.release.release.artifact.manifestSha256);await e.track();
 const candidate=e.f.release('frm_fixture','1.0.1','1.0.0',{'server/main.mjs':"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);setInterval(()=>{},1000);"}),slot=e.f.state.slot(candidate.release),store=e.f.state.component('frm_fixture');store.write('release-'+candidate.release.artifact.manifestSha256+'.json',candidate.release);const path=e.f.state.path('frm_fixture',slot);await mkdir(join(path,'server'),{recursive:true});await writeFile(join(path,'server/main.mjs'),candidate.files['server/main.mjs']);
 await e.f.state.switchTo('frm_fixture',slot,randomUUID());await e.host.start();await e.track();await e.effects.stop();assert.equal(e.host.running(),false);await e.assertStopped();
 await e.f.state.switchTo('frm_fixture',e.slot,randomUUID());await e.host.start();await e.host.health('frm_fixture','1.0.0',e.release.release.artifact.manifestSha256);await e.track();await e.effects.stop();await e.assertStopped();
});
test('ready runtime nonzero drain remains a failure even when the update engine permits startup abort',{timeout:15000},async t=>{
 const e=await setup(t,'ready-failure');await e.host.start();await e.host.health('frm_fixture','1.0.0',e.release.release.artifact.manifestSha256);await e.track();await assert.rejects(e.effects.stop(),/RUNTIME_DRAIN_FAILED/);await e.assertStopped();
});
test('HTTP-ready runtime without an explicit host health call still keeps its strict nonzero drain result',{timeout:15000},async t=>{
 const e=await setup(t,'ready-failure');await e.host.start();await e.track();let ready=false;
 for(let i=0;i<100;i++){try{ready=(await(await fetch(e.f.state.config.healthUrl)).json()).ready===true;if(ready)break}catch{}await delay(10)}assert.equal(ready,true);
 await assert.rejects(e.effects.stop(),/RUNTIME_DRAIN_FAILED/);await e.assertStopped();
});
test('ready runtime exit zero with a same-group descendant is a failed drain even after worker cleanup',{timeout:15000},async t=>{
 const e=await setup(t,'ready-leftover');await e.host.start();await e.host.health('frm_fixture','1.0.0',e.release.release.artifact.manifestSha256);await e.track();
 let ready=false;for(let i=0;i<100;i++){try{ready=await readFile(e.marker,'utf8')==='ready';if(ready)break}catch(error){if(error.code!=='ENOENT')throw error}await delay(10)}assert.equal(ready,true);
 const descendant=await e.trackDescendant();assert.equal(alive(descendant),true);await assert.rejects(e.effects.stop(),/RUNTIME_DRAIN_FAILED/);await e.assertStopped();assert.equal(alive(descendant),false,'forced descendant cleanup must never turn the ready drain into success');
});
for(const mode of ['unready-failure','unready-kill','unready-leftover'])test('unready candidate '+mode+' is never normalized as a clean startup abort',{timeout:15000},async t=>{
 const e=await setup(t,mode);await e.host.start();await e.track();let ready=false;for(let i=0;i<100;i++){try{ready=await readFile(e.marker,'utf8')==='ready';if(ready)break}catch(error){if(error.code!=='ENOENT')throw error}await delay(10)}assert.equal(ready,true);
 // The leftover entry has no cancellation-signal handler: the request terminates it while its same-group child remains.
 const descendant=mode==='unready-leftover'?await e.trackDescendant():null;if(descendant)assert.equal(alive(descendant),true);
 await assert.rejects(e.effects.stop(),/RUNTIME_DRAIN_FAILED/);await e.assertStopped();if(descendant)assert.equal(alive(descendant),false,'worker must clean its rejected leftover descendant');
});
