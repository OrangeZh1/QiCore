import { spawn,type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Preserve Nuxt SSR: route-specific titles are rendered in the first HTML response.
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const apiPort=process.env.API_PORT||'3501',adminPort=process.env.ADMIN_PORT||process.env.PORT||'3500';
const children:ChildProcess[]=[],startupSignals=new WeakSet<ChildProcess>();
let stopping=false,abortingStartup=false;
function stop(code=0,startup=false){
 if(code)process.exitCode=code;if(stopping)return;stopping=true;abortingStartup=startup;
 // Cancellation is distinct from a ready drain: only the SIGTERM we actually sent may end an unready child by signal.
 for(const child of children)if(child.kill('SIGTERM')&&startup)startupSignals.add(child);
 const timer=setTimeout(()=>{process.exitCode=1;for(const child of children)child.kill('SIGKILL')},65000);timer.unref();
}
// Register before spawning: a cancellation must never strand children in the supervisor's own startup window.
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
if(process.env.QICORE_STARTUP_CANCEL_SIGNAL==='SIGUSR2')process.on('SIGUSR2',()=>stop(0,true));
function track(child:ChildProcess){children.push(child);child.on('error',()=>stop(1));child.on('exit',(code,signal)=>{if(!stopping)stop(1);else if((code!==0||signal)&&!(abortingStartup&&startupSignals.has(child)&&signal==='SIGTERM'))process.exitCode=1});return child}
track(spawn(process.execPath,['dist/main.js'],{cwd:root+'apps/api',env:{...process.env,NODE_ENV:'production',API_HOST:'127.0.0.1',API_PORT:apiPort},stdio:'inherit'}));
track(spawn(process.execPath,['.output/server/index.mjs'],{cwd:root+'apps/admin',env:{...process.env,NODE_ENV:'production',HOST:process.env.ADMIN_HOST||'0.0.0.0',PORT:adminPort,NITRO_SHUTDOWN_TIMEOUT:'70000',NUXT_PUBLIC_API_BASE:'/api/v1',NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+apiPort+'/api/v1'},stdio:'inherit'}));
