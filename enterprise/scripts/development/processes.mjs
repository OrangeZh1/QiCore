import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {watch} from 'node:fs';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function available(port){await new Promise((ok,fail)=>{const s=createServer();s.once('error',()=>fail(Error('Development port '+port+' is occupied; existing services were not changed')));s.listen(port,'127.0.0.1',()=>s.close(ok))})}
export async function command(file,args,options={}){const result=await execute(file,args,{windowsHide:true,maxBuffer:16*1024*1024,...options});return result.stdout}
export function start(file,args,{cwd,env,label,log}){
 const child=spawn(file,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',data=>log(label,data.toString()));
 child.on('error',error=>log(label,error.message));return child;
}
export async function stop(child){
 if(!child||child.exitCode!==null)return;
 if(child.connected)child.send('qicore-development-stop');else child.kill('SIGTERM');
 for(let i=0;i<100&&child.exitCode===null;i++)await delay(100);
 if(child.exitCode===null){if(process.platform==='win32')await command('taskkill.exe',['/PID',String(child.pid),'/T','/F']);else child.kill('SIGKILL')}
 for(let i=0;i<30&&child.exitCode===null;i++)await delay(100);
 if(child.exitCode===null)throw Error('Development child did not stop: '+child.pid);
}
export async function waitHttp(url,child,accept=response=>response.ok){
 let detail='';for(let i=0;i<120;i++){if(child?.exitCode!==null&&child?.exitCode!==undefined)throw Error('Development child exited before '+url);try{const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(await accept(response))return;detail='HTTP '+response.status;if(response.headers.get('content-type')?.includes('application/json'))detail+=' '+String((await response.json()).message||'')}catch(error){detail=error.message}await delay(250)}throw Error('Development service did not become ready: '+url+' ('+detail+')');
}
export function watchSources(root,paths,changed){return watch(root,{recursive:true},(_event,name)=>{const file=String(name||'').replaceAll('\\','/');if(file.split('/').some(part=>part.startsWith('.')||part==='node_modules'))return;if(paths.some(path=>file===path||file.startsWith(path+'/')))changed(file)})}
export function rebuildQueue(task,onError){let timer,running=false,again=false,closed=false;async function run(){timer=undefined;if(closed)return;if(running){again=true;return}running=true;do{again=false;try{await task()}catch(error){onError(error)}}while(again&&!closed);running=false}const schedule=()=>{if(closed)return;clearTimeout(timer);timer=setTimeout(run,200)};schedule.busy=()=>running||!!timer;schedule.close=async()=>{closed=true;clearTimeout(timer);timer=undefined;while(running)await delay(50)};return schedule}
