// Stable host wrapper, installed outside component versions. IPC loss drains the entire runtime group.
import {spawn} from 'node:child_process';
const [entry,cwd]=process.argv.slice(2);
if(!process.send||!entry||!cwd||process.platform!=='linux')throw Error('NATIVE_SUPERVISOR_REQUIRED');
const child=spawn(process.execPath,[entry],{cwd,env:{...process.env,QICORE_STARTUP_CANCEL_SIGNAL:'SIGUSR2'},detached:true,stdio:'inherit'});
let stopping=false,abortingStartup=false;
function stop(){if(stopping)return;stopping=true;if(!child.kill(abortingStartup?'SIGUSR2':'SIGTERM'))abortingStartup=false;const timeout=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL')}catch{}process.exit(1)},65000);timeout.unref()}
process.on('disconnect',stop);process.on('message',message=>{if(message==='abort-startup'&&!stopping)abortingStartup=true;if(message==='stop'||message==='abort-startup')stop()});process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('error',(error:NodeJS.ErrnoException)=>{console.error('QiCore runtime spawn failed:',error.code||'UNKNOWN');process.exit(1)});child.on('exit',(code,signal)=>{
 let groupRemaining=false;try{process.kill(-child.pid!,0);groupRemaining=true}catch(error){groupRemaining=(error as NodeJS.ErrnoException).code!=='ESRCH'}
 if(groupRemaining)try{process.kill(-child.pid!,'SIGKILL')}catch{}
 // Only an explicitly cancelled, unready startup terminated by our dedicated signal is a clean abort.
 // Nonzero exits, SIGKILL, timeouts and leftover descendants keep the drain-failure contract.
 process.exit(groupRemaining?1:code??(abortingStartup&&signal==='SIGUSR2'?0:1));
});
