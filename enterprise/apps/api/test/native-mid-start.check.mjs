// Real production supervisor, real worker and real child exits; no database or external channels.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/native-release.mjs';
import {NativeHost} from '../dist/lifecycle/native-host.js';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';

assert.equal(process.platform,'linux');assert.ok(process.getuid()>0);
const production=await readFile(new URL('../dist/lifecycle/production.js',import.meta.url),'utf8');
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const port=()=>new Promise(ok=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>ok(value))})});
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
async function setup(t,mode='startup'){
 const root=await mkdtemp(join(tmpdir(),'qicore-mid-start-')),f=fixture(root),apiPort=await port(),adminPort=await port(),owned=new Set();let unexpected=0;
 Object.assign(f.state.config,{runtimeUid:process.getuid(),runtimeGid:process.getgid(),healthUrl:'http://127.0.0.1:'+apiPort+'/health',loginUrl:'http://127.0.0.1:'+adminPort+'/admin/login'});
 const events=join(root,'child-exits.jsonl'),preload=join(root,'observe.mjs');
 await writeFile(preload,`import cp from'node:child_process';import{appendFileSync}from'node:fs';import{syncBuiltinESMExports}from'node:module';const original=cp.spawn;cp.spawn=(file,args,options)=>{const child=original(file,args,options);child.on('exit',(code,signal)=>appendFileSync(${JSON.stringify(events)},JSON.stringify({pid:child.pid,args,code,signal})+'\\n'));return child};syncBuiltinESMExports();\n`);
 await writeFile(f.state.config.environmentFile,Object.entries({ADMIN_ORIGIN:'http://127.0.0.1:'+adminPort,API_PORT:String(apiPort),ADMIN_PORT:String(adminPort),ADMIN_HOST:'127.0.0.1',NODE_OPTIONS:'--max-old-space-size=128 --import='+pathToFileURL(preload).href}).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n');
 const ready=`import http from'node:http';const entry=JSON.parse(process.env.QICORE_COMPONENTS).frm_fixture;const api=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/v1/public/site'?{data:{platform:{name:'QiCore'}}}:{ready:true,mock:false,version:entry.version,runtimeId:process.env.QICORE_RUNTIME_ID,components:{frm_fixture:{version:entry.version,manifestSha256:entry.manifestSha256}}}))});const admin=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<html><title>old fixture runtime</title></html>')});api.listen(${apiPort},'127.0.0.1');admin.listen(${adminPort},'127.0.0.1');process.on('SIGTERM',()=>{api.close();admin.close();process.exit(0)});`;
 const old=f.release('frm_fixture','1.0.0','0.0.0',{'server/main.mjs':ready,'package.json':JSON.stringify({type:'module'})}),oldSlot=await f.install(old);
 function dummy(role){return`import{writeFileSync}from'node:fs';${role==='api'&&mode==='exit17'?"process.on('SIGTERM',()=>process.exit(17));":role==='api'&&mode==='sigkill'?"process.on('SIGTERM',()=>process.kill(process.pid,'SIGKILL'));":''}writeFileSync(${JSON.stringify(join(root,role+'.before-handler'))},String(process.pid));await new Promise(r=>setTimeout(r,8000));process.on('SIGTERM',()=>process.exit(0));writeFileSync(${JSON.stringify(join(root,role+'.handler-ready'))},'ready');setInterval(()=>{},1000);`}
 const files={'package.json':JSON.stringify({type:'module'}),'apps/api/dist/lifecycle/production.js':production,'apps/api/dist/main.js':dummy('api'),'apps/admin/.output/server/index.mjs':dummy('admin')};
 const candidate=f.release('frm_fixture','1.0.1','1.0.0',files,{entrypoint:'apps/api/dist/lifecycle/production.js'}),slot=f.state.slot(candidate.release),store=f.state.component('frm_fixture');store.write('release-'+candidate.release.artifact.manifestSha256+'.json',candidate.release);const target=f.state.path('frm_fixture',slot);for(const [path,bytes]of Object.entries(files)){await mkdir(join(target,path,'..'),{recursive:true});await writeFile(join(target,path),bytes)}
 const host=new NativeHost(f.state,undefined,()=>{unexpected++}),effects=new NativeEffects(f.state,host,f.client,'frm_fixture',randomUUID());
 async function track(){if(host.child?.pid)owned.add(host.child.pid);const result=spawnSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'});assert.equal(result.status,0);const rows=result.stdout.trim().split('\n').filter(Boolean).map(line=>line.trim().split(/\s+/).map(Number));for(let n=-1;n!==owned.size;){n=owned.size;for(const [pid,parent]of rows)if(owned.has(parent))owned.add(pid)}}
 async function stopped(){for(let i=0;i<200&&[...owned].some(alive);i++)await delay(10);assert.deepEqual([...owned].filter(alive),[],'worker, production and both children must exit')}
 t.after(async()=>{let failure;try{await track();await host.shutdown();await stopped();assert.equal(unexpected,0)}catch(error){failure=error;for(const pid of owned)if(alive(pid))try{process.kill(pid,'SIGKILL')}catch{}}if(![...owned].some(alive)){assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/qicore-mid-start-'));await rm(root,{recursive:true,force:true})}if(failure)throw failure});
 async function startCandidate(){await f.state.switchTo('frm_fixture',slot,randomUUID());await host.start();for(let i=0;i<250&&(!existsSync(join(root,'api.before-handler'))||!existsSync(join(root,'admin.before-handler')));i++)await delay(10);for(const role of ['api','admin']){const pid=Number(await readFile(join(root,role+'.before-handler'),'utf8'));assert.ok(pid>0&&alive(pid));owned.add(pid);assert.equal(existsSync(join(root,role+'.handler-ready')),false,'Child remains in the actual pre-handler startup window')}await track()}
 return{root,f,old,oldSlot,candidate,slot,host,effects,track,stopped,startCandidate,async exits(){return(await readFile(events,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}};
}

test('mid-start cancellation accepts only its own child SIGTERM and restores the actual old runtime',{timeout:20000},async t=>{
 const e=await setup(t);await e.host.start();await e.host.health('frm_fixture','1.0.0',e.old.release.artifact.manifestSha256);await e.track();await e.startCandidate();await e.effects.stop();await e.stopped();
 const exits=await e.exits();for(const role of ['dist/main.js','.output/server/index.mjs']){const row=exits.find(value=>value.args?.[0]===role);assert.ok(row);assert.equal(row.code,null);assert.equal(row.signal,'SIGTERM')}
 const parent=exits.find(value=>value.args?.[0]?.endsWith('/apps/api/dist/lifecycle/production.js'));assert.equal(parent.code,0);assert.equal(parent.signal,null);
 await e.f.state.switchTo('frm_fixture',e.oldSlot,randomUUID());await e.host.start();await e.host.health('frm_fixture','1.0.0',e.old.release.artifact.manifestSha256);await e.track();await e.effects.stop();await e.stopped();
});
test('ordinary mid-start stop remains a drain failure rather than silently becoming startup cancellation',{timeout:15000},async t=>{
 const e=await setup(t);await e.startCandidate();await assert.rejects(e.host.stop(),/RUNTIME_DRAIN_FAILED/);await e.stopped();const row=(await e.exits()).find(value=>value.args?.[0]?.endsWith('/apps/api/dist/lifecycle/production.js'));assert.equal(row.code,1);
});
for(const mode of ['exit17','sigkill'])test('explicit mid-start cancellation never masks a child '+mode,{timeout:15000},async t=>{
 const e=await setup(t,mode);await e.startCandidate();await assert.rejects(e.effects.stop(),/RUNTIME_DRAIN_FAILED/);await e.stopped();const exits=await e.exits(),api=exits.find(value=>value.args?.[0]==='dist/main.js');assert.equal(mode==='exit17'?api.code:api.signal,mode==='exit17'?17:'SIGKILL');assert.equal(exits.find(value=>value.args?.[0]?.endsWith('/apps/api/dist/lifecycle/production.js')).code,1);
});
