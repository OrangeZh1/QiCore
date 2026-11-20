// Linux-only three-process signal fixture. Uses the actual worker/launcher and
// the API's current signal registration style; does not start a production DB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
assert.equal(process.platform,'linux','This acceptance must run on isolated Linux; Windows cannot validate POSIX process-group signals.');
const apiRoot=fileURLToPath(new URL('../',import.meta.url));
const registrationFor=root=>readFileSync(join(root,'src/main.ts'),'utf8').match(/process\.(once|on)\('SIGTERM',\s*stop\)/)?.[1];
async function fixture(t,mode='slow',source=apiRoot){
 const registration=registrationFor(source);assert.ok(registration);
 const root=mkdtempSync(join(tmpdir(),'qicore-native-drain-'));
 mkdirSync(join(root,'apps/api/dist/lifecycle'),{recursive:true});mkdirSync(join(root,'apps/admin/.output/server'),{recursive:true});
 copyFileSync(join(source,'dist/lifecycle/production.js'),join(root,'apps/api/dist/lifecycle/production.mjs'));
 const marker=join(root,'drained'),ready=join(root,'ready');
 writeFileSync(join(root,'apps/admin/.output/server/index.mjs'),"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)");
 // The hung job keeps a referenced handle: an unresolved Promise alone lets Node exit successfully.
 writeFileSync(join(root,'apps/api/dist/main.js'),`const fs=require('node:fs');const http=require('node:http');let inflight=0,stopping=false;const server=http.createServer((req,res)=>{if(req.url==='/slow'){inflight++;setTimeout(()=>{res.end('finished');inflight--},400)}else res.end(String(process.pid))});server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(ready)},String(server.address().port)));const job=setInterval(()=>{},1000);async function stop(){if(stopping)return;stopping=true;server.close();${mode==='timeout'?'await new Promise(()=>{});':'clearInterval(job);while(inflight)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,400));'}fs.writeFileSync(${JSON.stringify(marker)},'drained');process.exit(0)}process.${registration}('SIGTERM',stop);process.${registration}('SIGINT',stop);`);
 const worker=fork(join(source,'dist/lifecycle/native-worker.js'),[join(root,'apps/api/dist/lifecycle/production.mjs'),root],{execArgv:[],stdio:['ignore','pipe','pipe','ipc']});let output='',group=0;worker.stdout.on('data',x=>output+=x);worker.stderr.on('data',x=>output+=x);
 t.after(async()=>{
  if(group)try{const command=readFileSync('/proc/'+group+'/cmdline','utf8');if(command.includes(join(root,'apps/api/dist/lifecycle/production.mjs')))process.kill(-group,'SIGKILL')}catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error}
  if(worker.exitCode===null&&worker.signalCode===null){const exited=once(worker,'exit');worker.kill('SIGKILL');await exited}rmSync(root,{recursive:true,force:true});
 });
 for(let i=0;i<100&&!existsSync(ready);i++){try{const children=readFileSync(`/proc/${worker.pid}/task/${worker.pid}/children`,'utf8').trim().split(/\s+/);if(children[0])group=Number(children[0])}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(existsSync(ready),output);
 const url='http://127.0.0.1:'+readFileSync(ready,'utf8');return {worker,marker,url,output:()=>output};
}
for(const repeated of [false,true])test('slow request and background drain survive '+(repeated?'repeated':'normal')+' stop',async t=>{
 const f=await fixture(t),pid=Number(await (await fetch(f.url)).text()),pending=fetch(f.url+'/slow').then(r=>r.text());pending.catch(()=>{});await new Promise(r=>setTimeout(r,100));const exited=once(f.worker,'exit');f.worker.send('stop');
 if(repeated){await new Promise(r=>setTimeout(r,100));try{process.kill(pid,'SIGTERM')}catch{}}
 const [code,signal]=await exited;assert.equal(code,0,JSON.stringify({code,signal,output:f.output()}));assert.equal(await pending,'finished');assert.ok(existsSync(f.marker));
});
test('unexpected API death fails the launcher instead of reporting a normal stop',async t=>{const f=await fixture(t),pid=Number(await (await fetch(f.url)).text()),exited=once(f.worker,'exit');process.kill(pid,'SIGKILL');const [code]=await exited;assert.notEqual(code,0);assert.equal(existsSync(f.marker),false)});
test('drain timeout is a failure and never leaves a false completed marker',{timeout:80000},async t=>{
 const f=await fixture(t,'timeout'),exited=once(f.worker,'exit'),started=performance.now();f.worker.send('stop');const [code,signal]=await exited,elapsedMs=Math.round(performance.now()-started);
 assert.equal(code,1,JSON.stringify({code,signal,elapsedMs,output:f.output()}));assert.equal(existsSync(f.marker),false);assert.ok(elapsedMs>=64000&&elapsedMs<75000,'actual launcher deadline should take about 65 seconds: '+elapsedMs);console.log(JSON.stringify({timeout:true,elapsedMs,code,signal,drained:false}));
});

if(process.env.QICORE_DRAIN_BASELINE_API)test('the pinned 0.1.0 Linux implementation reproduces interrupted draining under repeated SIGTERM',async t=>{
 const source=process.env.QICORE_DRAIN_BASELINE_API;assert.equal(registrationFor(source),'once');const f=await fixture(t,'slow',source),pid=Number(await(await fetch(f.url)).text()),pending=fetch(f.url+'/slow').then(r=>r.text()).catch(()=> 'interrupted');await new Promise(r=>setTimeout(r,100));const exited=once(f.worker,'exit');f.worker.send('stop');await new Promise(r=>setTimeout(r,100));try{process.kill(pid,'SIGTERM')}catch{}const [code,signal]=await exited;assert.equal(existsSync(f.marker),false,'negative control must reproduce missing drain completion');const response=await pending;console.log(JSON.stringify({baseline:true,code,signal,response,drained:false}));
});
