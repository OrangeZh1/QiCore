#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

// The host is an official checkout/distribution selected by the developer, never
// inferred from a neighbouring application's directory or an HTTP request.
export async function developmentCommand(args,{cwd=process.cwd(),env=process.env}={}){
 const values=args.filter(value=>value!=='--'),action=values.shift();
 if(!['dev','dev:stop'].includes(action))throw Error('Use qicore dev|dev:stop --host <official-host> [--state <directory>] [--port <port>]');
 const index=values.indexOf('--host'),selected=index<0?env.QICORE_DEV_HOST:values.splice(index,2)[1];
 if(!selected)throw Error('QICORE_DEV_HOST_REQUIRED: set QICORE_DEV_HOST or pass --host <official-host>');
 const host=await realpath(resolve(cwd,selected)),pkg=JSON.parse(await readFile(join(host,'package.json'),'utf8'));
 if(pkg.name!=='qicore'||!pkg.version)throw Error('QICORE_DEV_HOST_INVALID');
 const script=join(host,'scripts/development',action==='dev'?'run.mjs':'stop.mjs');
 await readFile(script);
 if(action==='dev:stop'){
  if(values.length&&!(values.length===2&&values[0]==='--state'))throw Error('Use qicore dev:stop --host <official-host> [--state <directory>]');
  return {file:process.execPath,args:[script,...values.length?[resolve(cwd,values[1])]:[]],cwd,env};
 }
 return {file:process.execPath,args:[script,'--app',cwd,'--sdk-mode','installed',...values],cwd,env};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const command=await developmentCommand(process.argv.slice(2));
  const child=spawn(command.file,command.args,{cwd:command.cwd,env:command.env,stdio:'inherit',windowsHide:true});
  child.once('error',error=>{console.error(error.message);process.exitCode=1});
  child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0)});
 }catch(error){console.error(error.message);process.exitCode=1}
}
