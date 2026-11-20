import {readFile,writeFile,mkdir,readdir,appendFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {assertStandaloneComposition,assertComponentFlag} from '../../apps/api/src/applications/standalone-composition.mjs';
import {command,start,stop,waitHttp,available,watchSources,rebuildQueue} from './processes.mjs';
import {developmentDatabase,migrateDevelopmentApplications} from './database.mjs';
import {developmentLicense} from './license.mjs';
import {developmentGateway} from './gateway.mjs';
import {reserveDevelopmentApplications,assertDevelopmentApplicationIdentity} from '../../apps/api/src/applications/development-workspace.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2).filter(value=>value!=='--'),appPaths=[];
let state=join(root,'.local/development'),port=3500,sdkMode='source';
for(let i=0;i<args.length;i++){if(args[i]==='--app'||args[i]==='--plugin'){const flag=args[i],directory=args[++i];if(!directory||directory.startsWith('--'))throw Error('Missing directory for '+flag);appPaths.push({flag,directory:resolve(directory)})}else if(args[i]==='--state')state=resolve(args[++i]);else if(args[i]==='--port')port=Number(args[++i]);else if(args[i]==='--sdk-mode')sdkMode=args[++i];else if(args[i]==='--help'){console.log('pnpm dev --app <application> [--plugin <plugin>] [--sdk-mode source|installed] [--state <dedicated-directory>] [--port 3500]');process.exit(0)}else throw Error('Unknown development argument: '+args[i])}
if(!['source','installed'].includes(sdkMode))throw Error('Invalid development SDK mode');
if(!Number.isInteger(port)||port<1024||port>30000)throw Error('Invalid development port');
process.env.NODE_ENV='development';
await mkdir(state,{recursive:true});
const markerFile=join(state,'workspace-owner.json');let owner;
try{owner=JSON.parse(await readFile(markerFile,'utf8'));if(owner.format!=='qicore-development-state-v1'||owner.framework!==root)throw Error('State belongs to another workspace')}
catch(error){if(error.code!=='ENOENT')throw error;if((await readdir(state)).length)throw Error('Development state directory is not empty and has no ownership record');owner={format:'qicore-development-state-v1',framework:root,id:randomUUID()};await writeFile(markerFile,JSON.stringify(owner),{flag:'wx'})}
await available(port);await available(port+1);await available(port+2);
await mkdir(join(state,'logs'),{recursive:true});const logFile=join(state,'logs/development.log');
function log(label,message){const line='['+label+'] '+message.trim();console.log(line);void appendFile(logFile,line+'\n')}
const adminRequire=createRequire(join(root,'apps/admin/package.json')),apiRequire=createRequire(join(root,'apps/api/package.json'));
const applications=[];
for(const [index,{flag,directory}] of appPaths.entries()){
 const source=await realpath(directory),descriptor=JSON.parse(await readFile(join(source,'application.json'),'utf8')),pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8')),contract=pkg.qicore?.development;
 assertComponentFlag(flag,descriptor);
 if(!contract||typeof contract.entry!=='string'||isAbsolute(contract.entry)||contract.entry.split(/[\\/]/).includes('..')||!Array.isArray(contract.serverWatch)||contract.serverWatch.some(path=>typeof path!=='string'||isAbsolute(path)||path.split(/[\\/]/).includes('..')))throw Error('Application needs an explicit local development contract: '+source);
 if(!/^[a-z][a-z0-9-]{1,63}$/.test(descriptor.key)||!/^(?:app|plugin|plg)_[a-z0-9_]+$/.test(descriptor.packageKey)||applications.some(app=>app.key===descriptor.key||app.packageKey===descriptor.packageKey))throw Error('Duplicate or invalid development application identity');
 const adminPort=port+100+index*10,h5Port=adminPort+2;for(const value of [adminPort,h5Port])await available(value);
 applications.push({...descriptor,web:descriptor.web??{},source,contract,path:join(state,'applications',descriptor.key),adminPort,h5Port,adminOrigin:'http://127.0.0.1:'+adminPort,h5Origin:'http://127.0.0.1:'+h5Port});
}
assertStandaloneComposition(applications);
const token=randomBytes(32).toString('hex'),workspaceFile=join(state,'workspace.json'),emptyEnv=join(state,'empty.env');await writeFile(emptyEnv,'');
const env={...process.env,NODE_ENV:'development',QICORE_STANDALONE_BOOTSTRAP:'development',API_HOST:'127.0.0.1',API_PORT:String(port+1),ADMIN_ORIGIN:'http://127.0.0.1:'+port,PUBLIC_ADMIN_ORIGIN:'http://127.0.0.1:'+port,ADMIN_DEMO_LOGIN:'false',ADMIN_BOOTSTRAP_USERNAME:'devadmin',ADMIN_STATE_PATH:join(state,'admin'),STORAGE_PATH:join(state,'files'),STORAGE_STATE_PATH:join(state,'storage'),LICENSE_STATE_PATH:join(state,'license'),LICENSE_DOMAIN:'127.0.0.1',BACKUP_PATH:join(state,'backups'),BACKUP_KEY_PATH:join(state,'backup-keys'),PAYMENT_EXECUTION_ENABLED:'false',WECHAT_SUBSCRIPTION_SEND_ENABLED:'false',QICORE_DEV_WORKSPACE:workspaceFile,QICORE_DEV_EMPTY_ENV:emptyEnv,QICORE_DEV_SDK_PATH:join(root,'packages/application-sdk'),QICORE_DEV_CONSOLE_UI_PATH:join(root,'packages/qisvc-console-ui'),QICORE_DEV_PUBLIC_PORT:String(port),NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+(port+1)+'/api/v1',NUXT_PUBLIC_API_BASE:'/api/v1',NUXT_TELEMETRY_DISABLED:'1'};
for(const key of ['QICORE_COMPONENTS','QICORE_STANDALONE_BUNDLE_ROOT','QICORE_STANDALONE_RELEASE_FILE','QICORE_STANDALONE_PRODUCT_FILE','QICORE_STANDALONE_UPDATER_SOCKET','UPDATER_SOCKET','NATIVE_STATE_PATH','QICORE_PRODUCT','QICORE_DEV_APP_OUTPUT'])delete env[key];
function applicationEnv(app){
 const require=createRequire(join(app.source,'package.json'));
 const installed=(name,from='.')=>{try{return resolve(dirname(require.resolve(name)),from)}catch(error){if(error.code==='MODULE_NOT_FOUND')return undefined;throw error}};
 return {...env,QICORE_DEV_APP_OUTPUT:app.path,QICORE_DEV_APPLICATION_KEY:app.key,QICORE_DEV_ADMIN_PORT:String(app.adminPort),QICORE_DEV_H5_PORT:String(app.h5Port),
  ...(sdkMode==='installed'?{QICORE_DEV_SDK_PATH:installed('@qicore/application-sdk/package.json'),QICORE_DEV_CONSOLE_UI_PATH:installed('@orangezh1/qisvc-console-ui/styles.css','..')}:{}),QICORE_DEV_SDK_MODE:sdkMode};
}
let api,database,license,gateway,schedule,closing=false,starting=true,stopRequested=false,ready=false,generation=0;const children=[],watchers=[];
const stateView=()=>({format:'qicore-development-status-v1',workspaceId:owner.id,ready:ready&&!starting,building:!!schedule?.busy(),generation,applications:applications.map(app=>({key:app.key,name:app.name,version:app.version}))});
async function writeState(name,value){const {StateStore}=await import(pathToFileURL(join(root,'apps/api/dist/license/store.js')).href);new StateStore(state).write(name,value)}
async function saveWorkspace(){const {StateStore}=await import(pathToFileURL(join(root,'apps/api/dist/license/store.js')).href);reserveDevelopmentApplications(new StateStore(state),applications);await writeState('workspace.json',{format:'qicore-development-workspace-v1',licenseReceipt:license?.receiptPath||join(state,'development-receipt.json'),applications:applications.map(({key,packageKey,format,applicationKey,namespace,version,path,web,adminOrigin,h5Origin})=>({key,packageKey,format,applicationKey,namespace,version,path,...web?.admin?{adminOrigin}:{},...web?.h5?{h5Origin}:{}}))})}
function checkCancellation(){if(stopRequested)throw Error('Development startup cancelled; data retained')}
async function compileApi(){
 try {await command(process.execPath,[apiRequire.resolve('typescript/bin/tsc'),'--noEmitOnError'],{cwd:join(root,'apps/api')})}
 catch(error){throw new Error('API compilation failed: '+String(error.stdout||error.message),{cause:error})}
 await writeFile(join(root,'apps/api/dist/package.json'),await readFile(join(root,'apps/api/src/package.json')))}
async function buildApp(app){const descriptor=JSON.parse(await readFile(join(app.source,'application.json'),'utf8'));assertDevelopmentApplicationIdentity({...app,version:descriptor.version},descriptor);app.version=descriptor.version;await command(process.execPath,[join(app.source,app.contract.entry),'server'],{cwd:app.source,env:applicationEnv(app)});const output=JSON.parse(await readFile(join(app.path,'application.json'),'utf8'));assertDevelopmentApplicationIdentity(app,output);app.web=output.web||{};log(app.key,'server compiled')}
async function restartApi(){ready=false;await stop(api);api=start(process.execPath,['--import',pathToFileURL(join(root,'scripts/development/api-preload.mjs')).href,join(root,'apps/api/dist/main.js')],{cwd:join(root,'apps/api'),env,label:'api',log});await waitHttp('http://127.0.0.1:'+(port+1)+'/health',api,async response=>response.ok&&(await response.json()).ready===true);generation++;ready=true}
async function shutdown(){if(closing)return;closing=true;ready=false;for(const watcher of watchers)watcher.close();license?.close();try{await schedule?.close();await stop(api);for(const child of children.reverse())await stop(child);if(database)await database.close();if(gateway)await gateway.close();await writeFile(join(state,'run.json'),JSON.stringify({workspaceId:owner.id,pid:process.pid,port,stopped:true}));log('workspace','stopped; development data retained')}catch(error){log('shutdown',error.message);process.exitCode=1}finally{process.exit(process.exitCode||0)}}
const requestStop=()=>{if(starting){stopRequested=true;log('workspace','stopping after the current preparation step')}else void shutdown()};
process.once('SIGINT',requestStop);process.once('SIGTERM',requestStop);
process.on('message',message=>{if(message==='qicore-development-stop')requestStop()});
try{
 log('workspace','preparing independent development environment');
 await command(process.execPath,[apiRequire.resolve('prisma/build/index.js'),'generate','--schema',join(root,'apps/api/prisma/schema.prisma')],{cwd:root,env:{...env,DATABASE_URL:'mysql://unused:unused@127.0.0.1/qicore_development'}});
 await compileApi();checkCancellation();await command(process.execPath,[join(root,'packages/application-sdk/build.mjs'),'--incremental'],{cwd:root});
 await command(process.execPath,[join(root,'apps/client/build.mjs')],{cwd:root});
 await saveWorkspace();for(const app of applications){checkCancellation();await buildApp(app)}await saveWorkspace();checkCancellation();
 database=await developmentDatabase({root,state,mysqlPort:port+30000,redisPort:port+30001,log});env.DATABASE_URL=database.databaseUrl;env.REDIS_URL=database.redisUrl;env.BACKUP_DATABASE_URL=database.databaseUrl;
 checkCancellation();await migrateDevelopmentApplications(root,{applications},database.databaseUrl);
 license=await developmentLicense(root,state,applications);env.QICORE_PRODUCT=JSON.stringify(license.product);await saveWorkspace();
 checkCancellation();await restartApi();checkCancellation();
 gateway=developmentGateway({port,corePort:port+2,applications,token,status:stateView,shutdown:requestStop});await gateway.listen();
 const core=start(process.execPath,['--import',pathToFileURL(join(root,'scripts/development/ui-preload.mjs')).href,join(dirname(adminRequire.resolve('nuxt/package.json')),'bin/nuxt.mjs'),'dev','--host','127.0.0.1','--port',String(port+2),'--dotenv',emptyEnv],{cwd:join(root,'apps/admin'),env,label:'console',log});children.push(core);
 for(const app of applications){const appEnv=applicationEnv(app);for(const mode of ['admin','h5'].filter(mode=>app.web[mode]))children.push(start(process.execPath,[join(app.source,app.contract.entry),mode],{cwd:app.source,env:appEnv,label:app.key+':'+mode,log}))}
 await waitHttp('http://127.0.0.1:'+port+'/admin/login',core);
 for(const app of applications){if(app.web.admin)await waitHttp(app.adminOrigin+'/application-assets/'+app.key+'/'+app.version+'/admin/_nuxt/@vite/client',null,response=>response.status<500);if(app.web.h5)await waitHttp(app.h5Origin+'/__qicore_dev/'+app.key+'/h5/',null)}
 checkCancellation();starting=false;await writeState('run.json',{workspaceId:owner.id,pid:process.pid,port,token,stopped:false});
 const pending=new Set();schedule=rebuildQueue(async()=>{if(closing)return;const work=[...pending];pending.clear();if(work.includes('api'))await compileApi();if(work.includes('sdk'))await command(process.execPath,[join(root,'packages/application-sdk/build.mjs'),'--incremental'],{cwd:root});if(work.includes('framework-client'))await command(process.execPath,[join(root,'apps/client/build.mjs')],{cwd:root});for(const app of applications)if(work.includes(app.key))await buildApp(app);await saveWorkspace();if(work.includes('api')||applications.some(app=>work.includes(app.key))){await migrateDevelopmentApplications(root,{applications},database.databaseUrl);await restartApi()}log('workspace','changes applied: '+work.join(', '))},error=>log('build',error.message));
 watchers.push(watchSources(root,['apps/api/src','apps/api/prisma'],file=>{if(file.startsWith('apps/api/prisma/')){log('schema','schema or migration changed; restart the workspace to validate and migrate its development database');return}pending.add('api');pending.add('sdk');schedule()}));
 watchers.push(watchSources(root,['packages/application-sdk/client','packages/application-sdk/build.mjs','apps/admin/app/assets','apps/admin/app/config','apps/admin/app/components','apps/admin/app/composables','apps/admin/app/utils','apps/admin/app/layouts','apps/admin/app/middleware','apps/admin/app/app.config.ts'],()=>{pending.add('sdk');schedule()}));
 watchers.push(watchSources(root,['apps/client/src','apps/client/vite.config.ts','apps/client/build.mjs','packages/application-sdk/client'],()=>{pending.add('sdk');pending.add('framework-client');schedule()}));
 for(const app of applications)watchers.push(watchSources(app.source,app.contract.serverWatch,()=>{pending.add(app.key);schedule()}));
 log('workspace','ready at http://127.0.0.1:'+port+'; administrator credentials: '+join(state,'admin/admin-bootstrap.json'));
 log('workspace','Ctrl+C stops this workspace and keeps its data.');
}catch(error){log('startup',error.stack||error.message);process.exitCode=1;await shutdown()}
