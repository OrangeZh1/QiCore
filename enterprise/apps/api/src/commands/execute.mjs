import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function executeCommand(command,params,actor,{url=new URL('./runner.mjs',import.meta.url),env=process.env,timeoutMs=30000}={}){
  return new Promise((resolve,reject)=>{
    const child=fork(fileURLToPath(url),[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});let result=null,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},timeoutMs);
    child.once('error',()=>{clearTimeout(timer);reject(Error('COMMAND_START_FAILED'))});
    child.on('message',value=>{if(value&&typeof value==='object'&&typeof value.ok==='boolean')result=value});
    child.once('exit',code=>{clearTimeout(timer);if(timedOut)reject(Error('COMMAND_TIMEOUT'));else if(code===0&&result?.ok)resolve({cleared:Number.isSafeInteger(result.cleared)?result.cleared:0});else reject(Error('COMMAND_FAILED'))});
    child.send({command,params,actor},error=>{if(error)child.kill('SIGKILL')});
  });
}
