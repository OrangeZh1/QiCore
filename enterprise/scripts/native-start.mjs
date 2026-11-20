import {spawn} from 'node:child_process';
import {readFileSync,lstatSync,mkdirSync,existsSync,chmodSync,chownSync} from 'node:fs';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyBootstrapInventory} from './bootstrap-inventory.mjs';
export {verifyBootstrapInventory} from './bootstrap-inventory.mjs';

export function resolveBootstrapConfigPath(root,argument){
 const configPath=resolve(argument??'/www/server/nodejs-env/qicore/bootstrap.json');
 if(!relative(root,configPath).startsWith('..'+sep))throw Error('PRIVATE_CONFIG_OUTSIDE_BOOTSTRAP_REQUIRED');
 return configPath;
}


async function start(){
if(process.platform!=='linux'||process.versions.node.split('.')[0]!=='24')throw Error('LINUX_NODE24_REQUIRED');
const root=dirname(fileURLToPath(import.meta.url)),configPath=resolveBootstrapConfigPath(root,process.argv[2]);
const expected=await verifyBootstrapInventory(root);
// The verified Linux bundle ships its OpenSSL 3 engine; host library discovery may select an unrelated compatibility library.
const queryEngine='node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node';
if(!expected.has(queryEngine))throw Error('BOOTSTRAP_PRISMA_ENGINE_REQUIRED');
const initializing=!existsSync(configPath);
const config=initializing?(await(await import('./controller.mjs')).prepareBootstrapConfig(root,configPath)).config:JSON.parse(readFileSync(configPath,'utf8')),control=resolve(config.controlRoot);
if(!relative(root,control).startsWith('..'+sep))throw Error('CONTROL_OUTSIDE_BOOTSTRAP_REQUIRED');
for(let path=control;;path=dirname(path)){try{if(lstatSync(path).isSymbolicLink())throw Error('CONTROL_LINK_REJECTED')}catch(error){if(error.code!=='ENOENT')throw error}if(path===dirname(path))break}
process.umask(0o077);
if(initializing&&!existsSync(dirname(control))){
 if(!existsSync(dirname(dirname(control))))throw Error('BOOTSTRAP_PARENT_DIRECTORY_REQUIRED');
 mkdirSync(dirname(control),{mode:0o750});chmodSync(dirname(control),0o750);if(process.getuid?.()===0)chownSync(dirname(control),0,config.native.runtimeGid);
}
mkdirSync(control,{recursive:true,mode:0o700});
// Exec the controller while holding flock: a separate flock waiter must not be killed before drain finishes.
const child=spawn('flock',['--no-fork','--exclusive','--nonblock','--conflict-exit-code','73',join(control,'controller.lock'),process.execPath,join(root,'controller.mjs'),configPath],{cwd:root,env:{...process.env,PRISMA_QUERY_ENGINE_LIBRARY:join(root,queryEngine),QICORE_NATIVE_CONFIG:config.nativeConfigFile,UPDATER_FLOCK:'1'},detached:true,stdio:'inherit'});
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;try{child.kill('SIGTERM')}catch{}};
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
process.on('exit',stop);child.on('error',()=>{console.error('QICORE_CONTROLLER_START_FAILED');process.exitCode=1});child.on('exit',code=>{stopping=true;process.exitCode=code??1});
}

if([process.argv[1],process.env.pm_exec_path].some(entry=>entry&&resolve(entry)===fileURLToPath(import.meta.url)))await start().catch(error=>{
 if(error.message==='CUSTOMER_DEPLOYMENT_REQUIRED')console.error('CUSTOMER_DEPLOYMENT_REQUIRED: 未能自动识别客户访问地址，请在宝塔为当前 Node 项目绑定域名并配置页面端口；非宝塔环境可使用安装目录的 deployment.json。');
 else if(error.message==='BAOTA_PROJECT_DIRECTORY_REQUIRED')console.error('BAOTA_PROJECT_DIRECTORY_REQUIRED: 宝塔项目目录请选择安装包总目录，启动文件选择其中的 bootstrap/start.mjs；不要把 bootstrap 子目录设为项目目录。');
 else throw error;
 process.exitCode=1;
});
