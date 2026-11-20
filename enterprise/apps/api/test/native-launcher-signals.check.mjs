import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';

assert.equal(process.platform,'linux');assert.ok(process.env.NATIVE_BASELINE_PACKAGE_DIR);
const delay=ms=>new Promise(ok=>setTimeout(ok,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,legacy,exitCode=0){
 const root=await mkdtemp(join(tmpdir(),'qicore-launcher-signals-')),boot=join(root,'bootstrap'),control=join(root,'control');await mkdir(boot);await mkdir(control);
 const config=join(root,'config.json'),drained=join(root,'drained.json'),finish=join(root,'finish');await writeFile(config,JSON.stringify({controlRoot:control,nativeConfigFile:join(root,'native.json'),drained,finish,exitCode}));
 const files={
  'start.mjs':await readFile(legacy?join(process.env.NATIVE_BASELINE_PACKAGE_DIR,'bootstrap/start.mjs'):new URL('../../../scripts/native-start.mjs',import.meta.url)),
  'bootstrap-inventory.mjs':await readFile(new URL('../../../scripts/bootstrap-inventory.mjs',import.meta.url)),
  'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node':Buffer.alloc(0),
  'controller.mjs':Buffer.from(`import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));const interval=setInterval(()=>{},1000);let stopping=false;
process.on('SIGTERM',()=>{if(stopping)return;stopping=true;process.stdout.write('draining\\n');const draining=setInterval(()=>{if(!existsSync(config.finish))return;clearInterval(draining);writeFileSync(config.drained,JSON.stringify({pid:process.pid,exitCode:config.exitCode}));clearInterval(interval);process.exitCode=config.exitCode},10)});
process.stdout.write('controller-ready:'+process.pid+'\\n');`),
 };
 for(const [name,bytes] of Object.entries(files)){await mkdir(dirname(join(boot,name)),{recursive:true});await writeFile(join(boot,name),bytes)}
 await writeFile(join(boot,'bootstrap-manifest.json'),JSON.stringify({files:Object.entries(files).map(([path,bytes])=>({path,size:bytes.length,sha256:hash(bytes)}))}));
 const child=spawn(process.execPath,[join(boot,'start.mjs'),config],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
 const done=new Promise((ok,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>ok({code,signal}))});done.catch(()=>{});
 let controllerPid;
 t.after(async()=>{await writeFile(finish,'finish');if(controllerPid)try{process.kill(controllerPid,'SIGTERM')}catch{}if(child.exitCode===null)child.kill('SIGTERM');await done;assert.equal(dirname(root),resolve(tmpdir()));await rm(root,{recursive:true,force:true})});
 for(let i=0;i<100&&!output.includes('controller-ready:');i++){assert.equal(child.exitCode,null,output);await delay(20)}
 assert.match(output,/controller-ready:\d+/);controllerPid=Number(/controller-ready:(\d+)/.exec(output)[1]);
 const lock=()=>spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73',join(control,'controller.lock'),'true'],{encoding:'utf8'}).status;
 return {child,controllerPid,done,lock,output:()=>output,drained,finish:()=>writeFile(finish,'finish'),entry:join(boot,'start.mjs'),config};
}

test('immutable legacy launcher reproduces group-signal exit 1 despite a drained controller',{timeout:10000},async t=>{
 const f=await fixture(t,true);assert.equal(f.lock(),73);f.child.kill('SIGTERM');await f.finish();
 assert.equal((await f.done).code,1,'the historical failure must be reproduced rather than silently accepted');
 assert.equal(JSON.parse(await readFile(f.drained,'utf8')).exitCode,0);assert.equal(f.lock(),0);
});
test('legacy controller-targeted stop returns its real zero exit and releases the lock',{timeout:10000},async t=>{
 const f=await fixture(t,true);process.kill(f.controllerPid,'SIGTERM');await f.finish();assert.equal((await f.done).code,0);assert.equal(f.lock(),0);
});
for(const exitCode of [0,17])test('new launcher holds the lock while draining and propagates exit '+exitCode,{timeout:10000},async t=>{
 const f=await fixture(t,false,exitCode);
 const duplicate=spawnSync(process.execPath,[f.entry,f.config],{encoding:'utf8'});assert.equal(duplicate.status,73,duplicate.stderr);
 f.child.kill('SIGTERM');for(let i=0;i<100&&!f.output().includes('draining');i++)await delay(10);
 assert.match(f.output(),/draining/);assert.equal(f.lock(),73,'drain must retain exclusivity');await f.finish();
 assert.equal((await f.done).code,exitCode);assert.equal(JSON.parse(await readFile(f.drained,'utf8')).exitCode,exitCode);assert.equal(f.lock(),0);
});
