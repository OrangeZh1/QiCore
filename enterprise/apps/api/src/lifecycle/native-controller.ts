import {createHash} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync,lstatSync,chmodSync,chownSync} from 'node:fs';
import {dirname,basename,resolve,isAbsolute,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {canonicalJson} from '../license/contracts.js';
import {LicenseClient,normalizeDomain} from '../license/client.js';
import {StateStore} from '../license/store.js';
import {NativeState,nativeConfigSchema} from './native-state.js';
import {NativeHost} from './native-host.js';
import {InstallServer,installCodeMessage} from './install-server.js';
import {createNativeUpdaterServer,resumeNativeRuntime} from './native-updater.js';
import {verifyNativeStoredRelease} from '../license/native-updates.js';
import {noLinks} from './native-files.js';
import {clearOwnedSocket} from './updater-server.js';
import {bootstrapConfigSchema} from './bootstrap-config.js';
import {initializeBootstrapConfig,synchronizeInitialDelivery} from './bootstrap-delivery.js';
import {createMaintenanceServer} from './maintenance-server.js';
import {synchronizeDeployment} from './bootstrap-deployment.js';
import {startBootstrapGateway} from './bootstrap-gateway.js';
import {bootstrapChallengePublisher} from './bootstrap-challenge.js';
export {bootstrapConfigSchema} from './bootstrap-config.js';
export {prepareBootstrapConfig} from './bootstrap-delivery.js';

export async function startController(configPath:string,uiRoot=resolve(dirname(fileURLToPath(import.meta.url)),'ui'),transport:typeof fetch=fetch){
 if(transport===globalThis.fetch||process.env.NODE_ENV==='production'||process.env.QICORE_STANDALONE_PRODUCT_FILE||process.env.QICORE_STANDALONE_BUNDLE_ROOT)throw Error('STANDALONE_WHOLE_PRODUCT_UPDATER_REQUIRED');
 noLinks(configPath);if(!lstatSync(configPath).isFile()||(lstatSync(configPath).mode&0o077)!==0)throw Error('PRIVATE_INSTALL_CONFIG_REQUIRED');
 let input=bootstrapConfigSchema.parse(JSON.parse(readFileSync(configPath,'utf8')));
 if(!input.native.installationSocket||[input.controlRoot,input.nativeConfigFile,input.archive,input.releaseFile,input.native.installationSocket].some(path=>!isAbsolute(path)))throw Error('INSTALL_CONTROLLER_CONFIG_INVALID');
 if(input.native.installationSocket===input.native.socket)throw Error('INSTALL_CONTROLLER_CONFIG_INVALID');
 if(process.getuid?.()!==0&&process.getuid?.()!==input.native.runtimeUid)throw Error('INSTALL_RUNTIME_USER_INVALID');
 const sourceJournal=join(dirname(configPath),'initial-source-repair.json');noLinks(sourceJournal);
 if(existsSync(sourceJournal)&&JSON.parse(readFileSync(sourceJournal,'utf8')).status==='pending')await synchronizeInitialDelivery(dirname(uiRoot),configPath);
 input=await synchronizeDeployment(dirname(uiRoot),configPath);
 await synchronizeInitialDelivery(dirname(uiRoot),configPath);
 input=bootstrapConfigSchema.parse(JSON.parse(readFileSync(configPath,'utf8')));
 noLinks(input.nativeConfigFile);
 const base={...input.native,migrationUrl:'mysql://unconfigured:unconfigured@127.0.0.1/qicore'},saved=existsSync(input.nativeConfigFile)?nativeConfigSchema.parse(JSON.parse(readFileSync(input.nativeConfigFile,'utf8'))):null;
 if(saved&&canonicalJson({...saved,migrationUrl:''})!==canonicalJson({...base,migrationUrl:''}))throw Error('INSTALL_CONFIG_CHANGED');
 if(saved&&!existsSync(join(input.controlRoot,'request.json'))&&!existsSync(join(input.native.stateRoot,input.native.frameworkKey,'installation.json')))throw Error('INSTALL_CONFIG_UNEXPLAINED');
 const state=new NativeState(saved??base),publishChallenge=input.challengeRoot?bootstrapChallengePublisher(input.challengeRoot,dirname(uiRoot),input.controlRoot):undefined;
 const client=new LicenseClient(new StateStore(state.config.licenseStateRoot),state.config.product,normalizeDomain(new URL(input.adminOrigin).hostname),transport,true,publishChallenge);
 const installed=state.component(state.config.frameworkKey).read<any>('installation.json'),active=state.active(state.config.frameworkKey);
 if(!active||installed?.status!=='succeeded')noLinks(input.releaseFile);
 const release=active&&installed?.status==='succeeded'?state.release(state.config.frameworkKey,active.current):verifyNativeStoredRelease(state.config.product,JSON.parse(readFileSync(input.releaseFile,'utf8')));
 let ui:ChildProcess|undefined,closing=false;
 const stopUi=async()=>{const process=ui;if(!process||process.exitCode!==null||process.signalCode!==null){ui=undefined;return}await new Promise<void>((ok,fail)=>{const timeout=setTimeout(()=>{process.kill('SIGKILL');fail(Error('INSTALL_UI_STOP_TIMEOUT'))},15000);process.once('exit',()=>{clearTimeout(timeout);ui=undefined;ok()});process.kill('SIGTERM')})};
 const startUi=async()=>{
  if(closing)throw Error('RUNTIME_HOST_CLOSING');
  if(ui&&ui.exitCode===null&&ui.signalCode===null)return;
  const port=new URL(state.config.loginUrl).port||'3500';
  ui=spawn(process.execPath,[join(uiRoot,'server/index.mjs')],{cwd:uiRoot,uid:state.config.runtimeUid,gid:state.config.runtimeGid,env:{NODE_ENV:'production',NITRO_HOST:input.publicPort?'127.0.0.1':'0.0.0.0',NITRO_PORT:port,NUXT_PUBLIC_INSTALLATION_MODE:'true',NUXT_INSTALL_SOCKET:state.config.installationSocket!,NUXT_API_INTERNAL_BASE:'http://127.0.0.1:'+new URL(state.config.healthUrl).port+'/api/v1'},stdio:'inherit'});
  ui.on('error',()=>{});
  for(let i=0;i<50;i++){if(ui.exitCode!==null)throw Error('INSTALL_UI_START_FAILED');try{const result=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1000)});if(result.ok&&(await result.json()).stage==='installation')return}catch{}await new Promise(ok=>setTimeout(ok,300))}throw Error('INSTALL_UI_START_FAILED');
 };
 const host=new NativeHost(state,stopUi),installation=new InstallServer({state,client,host,controlRoot:input.controlRoot,nativeConfigFile:input.nativeConfigFile,archive:input.archive,release,adminOrigin:input.adminOrigin,redisUrl:input.redisUrl,onRedisUrl:url=>{noLinks(configPath);const updated=bootstrapConfigSchema.parse({...input,redisUrl:url});new StateStore(dirname(configPath)).write(basename(configPath),updated);input.redisUrl=url},onResult:async()=>{if(!installation.completed()){await host.stop();await startUi()}}});
 const updater=createNativeUpdaterServer(state,client,host);
 const maintenance=input.publicPort||state.config.maintenancePort?createMaintenanceServer(state,host):undefined;
 let gateway:Awaited<ReturnType<typeof startBootstrapGateway>>|undefined;
 const listen=async(server:import('node:http').Server,socket:string)=>{
  noLinks(dirname(socket));if(!existsSync(dirname(socket))){mkdirSync(dirname(socket),{recursive:true,mode:0o750});if(process.getuid?.()===0)chownSync(dirname(socket),0,state.config.runtimeGid)}
  clearOwnedSocket(socket);await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(socket,()=>{chmodSync(socket,0o660);if(process.getuid?.()===0)chownSync(socket,0,state.config.runtimeGid);ok()})});
 };
 const close=async()=>{closing=true;await Promise.all([gateway?.close(),host.shutdown(),stopUi()]);await installation.close();await new Promise<void>(ok=>updater.close(()=>ok()));await updater.waitForUpdates();if(maintenance?.listening)await new Promise<void>(ok=>maintenance.close(()=>ok()))};
 try{
  await listen(installation.server,state.config.installationSocket!);await listen(updater,state.config.socket);
  if(maintenance&&state.config.maintenancePort)await new Promise<void>((ok,fail)=>{maintenance.once('error',fail);maintenance.listen(state.config.maintenancePort,'127.0.0.1',ok)});
  if(input.publicPort){
   const address=state.config.maintenancePort?{port:state.config.maintenancePort}:{socketPath:state.config.installationSocket!+'.maintenance'};
   if('socketPath' in address)await listen(maintenance!,address.socketPath!);
   gateway=await startBootstrapGateway({publicPort:input.publicPort,uiPort:Number(new URL(state.config.loginUrl).port||80),maintenance:address},state.config.runtimeUid,state.config.runtimeGid,()=>{
    if(closing)return;console.error('QICORE_GATEWAY_EXITED');void close().finally(()=>process.exit(1));
   });
  }
  if(installation.completed())await resumeNativeRuntime(state,client,host);
  else await startUi();
  installation.startReports();return {state,host,installation,close};
 }catch(error){await close();throw error}
}
async function main(){
 throw Error('STANDALONE_WHOLE_PRODUCT_UPDATER_REQUIRED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(error=>{const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'NATIVE_CONTROLLER_START_FAILED';console.error(code+(installCodeMessage[code]?': '+installCodeMessage[code]:''));process.exitCode=1});
