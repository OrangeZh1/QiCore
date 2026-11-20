import {createServer} from 'node:http';
import {readFileSync,chownSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {LicenseClient,normalizeDomain} from '../license/client.js';
import {StateStore} from '../license/store.js';
import {checkNativePlan,nativeFileChanges} from '../license/native-updates.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {NativeState,nativeConfigSchema,nativeExecuteSchema} from './native-state.js';
import {NativeEffects,nativeBackups} from './native-effects.js';
import {backupFailure} from '../backups/service.mjs';
import {NativeHost} from './native-host.js';
import {UpdateEngine,type UpdateTask} from './update-engine.js';
import {clearOwnedSocket,restrictSocket} from './updater-server.js';
import {NativeApplicationLifecycle,applicationRequestSchema} from './native-applications.js';
import {canonicalJson} from '../license/contracts.js';
import {createMaintenanceServer} from './maintenance-server.js';
import {nativeMaintenance} from './native-maintenance.mjs';
import {join} from 'node:path';

const key=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const checkInput=z.object({packageKey:key}).strict();
export {nativeExecuteSchema} from './native-state.js';
export function createNativeUpdaterServer(state:NativeState,client:LicenseClient,host:NativeHost,
  make=(packageKey:string,id:string,expected?:UpdateTask['request'])=>new NativeEffects(state,host,client,packageKey,id,expected)){
  const checking=new Map<string,Promise<any>>();
  const applications=new NativeApplicationLifecycle(state,host,client);
  const pending=new Set<Promise<unknown>>();const track=(work:Promise<unknown>)=>{pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{})};
  const backupCapability=()=>{try{nativeBackups(state).checkCapability();return {ready:true,code:null}}catch(error){return {ready:false,code:backupFailure(error)}}};
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    try{
      if(req.method!=='GET'&&(process.env.NODE_ENV==='production'||process.env.QICORE_STANDALONE_PRODUCT_FILE||process.env.QICORE_STANDALONE_BUNDLE_ROOT)){
        res.statusCode=409;res.end(JSON.stringify({code:'STANDALONE_WHOLE_PRODUCT_UPDATER_REQUIRED'}));return;
      }
      if(req.method==='GET'&&req.url==='/status'){
        const available=!nativeMaintenance(join(state.config.dataRoot,'control','maintenance.json'))&&await host.available?.()===true&&!nativeMaintenance(join(state.config.dataRoot,'control','maintenance.json'));
        const tasks=state.tasks().map(task=>({...task,businessAvailable:available}));
        const applicationIdentities=state.keys().filter(key=>key!==state.config.frameworkKey).flatMap(packageKey=>{const descriptor=state.component(packageKey).read<{key:string}>('application.json');return descriptor?[{packageKey,key:descriptor.key}]:[]});
        const components=state.installed().map(c=>{const update=state.component(c.packageKey).read<any>('update-check.json');return {...c,update:update?.currentVersion===c.version?update:{state:'not_checked',label:'尚未检查',description:'可检查当前组件可用更新',currentVersion:c.version,latestVersion:null,checkedAt:null,canCheck:true}}});
        res.end(JSON.stringify({kind:'native',backups:backupCapability(),applicationLifecycle:true,applicationIdentities,code:tasks.some(t=>t.status==='recovery_required')?'RECOVERY_REQUIRED':tasks.some(t=>t.status==='running')?'RUNNING':components.some(c=>c.packageKey===state.config.frameworkKey)?'READY':'INSTALLATION_REQUIRED',tasks,components}));return;
      }
      if(req.method==='GET'&&req.url==='/backup-capability'){res.end(JSON.stringify(backupCapability()));return;}
      if(req.method!=='POST'||!['/check','/execute','/resume-closeout','/applications/check','/applications/execute'].includes(req.url??'')){res.statusCode=404;res.end('{}');return}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)throw Error('BODY_TOO_LARGE')}
      const body=JSON.parse(raw);
      if(req.url==='/applications/check'){
        const {packageKey,operation}=z.object({packageKey:key,operation:z.enum(['install','repair','uninstall'])}).strict().parse(body);
        if(state.tasks().some(t=>['running','recovery_required'].includes(t.status)))throw Error('UPDATE_ALREADY_ACTIVE');
        res.end(JSON.stringify(await applications.preview(packageKey,operation)));return;
      }
      if(req.url==='/applications/execute'){
        const request=applicationRequestSchema.parse(body),old=state.tasks().find(t=>t.id===request.requestId);
        if(old&&canonicalJson(old.request)!==canonicalJson(request))throw Error('REQUEST_ID_REUSED');
        if(!old&&state.tasks().some(t=>['running','recovery_required'].includes(t.status)))throw Error('UPDATE_ALREADY_ACTIVE');
        track(applications.execute(request.requestId,request));res.statusCode=202;res.end(JSON.stringify({accepted:true,taskId:request.requestId}));return;
      }
      if(req.url==='/check'){
        const {packageKey}=checkInput.parse(body);if(!state.active(packageKey))throw Error('NATIVE_INSTALLATION_REQUIRED');
        let pending=checking.get(packageKey);
        if(!pending){pending=(async()=>{
          const checkedAt=new Date().toISOString();
          try{
            const result=await checkNativePlan(client,state.installed(),packageKey),current=state.release(packageKey,state.active(packageKey)!.current);
            const release=result.release;
            const update={state:release?'available':'current',label:release?'发现新版本':'暂无可用更新',description:release?'已核验完整发行清单；执行时将扫描本地文件':'授权服务已确认当前没有更高的可用版本',
              currentVersion:current.version,latestVersion:release?.version??null,checkedAt,releaseNotes:release?.releaseNotes??'',manifestSha256:release?.artifact.manifestSha256??null,
              files:release?nativeFileChanges(nativeArchiveFromCatalog(current.manifest),nativeArchiveFromCatalog(release.manifest)):[],canCheck:true};
            state.component(packageKey).write('update-check.json',update);return update;
          }catch(e){const code=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'UPDATE_CHECK_FAILED';const update={state:'unavailable',label:'检查未完成',description:code==='SCOPED_UPDATE_DEPENDENCY_CONFLICT'?'已安装应用与目标版本存在依赖冲突，请先更新相关应用到兼容版本，再检查更新。':code==='RELEASE_TRUST_REQUIRED'?'尚未配置发行签名公钥':code==='UPDATE_NOT_ELIGIBLE'?'当前组件更新授权不可用':'无法完成可信版本检查',currentVersion:state.active(packageKey)!.current.version,latestVersion:null,checkedAt,code,canCheck:true};state.component(packageKey).write('update-check.json',update);return update}
        })().finally(()=>checking.delete(packageKey));checking.set(packageKey,pending)}
        res.end(JSON.stringify(await pending));return;
      }
      if(req.url==='/execute'){
        const {requestId,...request}=nativeExecuteSchema.parse(body),old=state.tasks().find(t=>t.id===requestId);
        if(old){if(JSON.stringify(old.request)!==JSON.stringify(request))throw Error('REQUEST_ID_REUSED');res.end(JSON.stringify({accepted:true,taskId:requestId}));return}
        if(!state.active(request.packageKey))throw Error('NATIVE_INSTALLATION_REQUIRED');
        if(state.tasks().some(t=>['running','recovery_required'].includes(t.status)))throw Error('UPDATE_ALREADY_ACTIVE');
        const engine=new UpdateEngine(state.component(request.packageKey),make(request.packageKey,requestId,request));
        track(engine.execute(requestId,request));res.statusCode=202;res.end(JSON.stringify({accepted:true,taskId:requestId}));return;
      }
      const {taskId}=z.object({taskId:z.string().uuid()}).strict().parse(body),task=state.tasks().find(t=>t.id===taskId);
      if(!task||state.tasks().some(t=>t.status==='running')||task.status!=='recovery_required'||!['ACTIVE_HEALTHY_CLOSEOUT_BLOCKED','ROLLBACK_CLOSEOUT_BLOCKED'].includes(task.code??''))throw Error('CLOSEOUT_NOT_RETRYABLE');
      if(task.operation)track(applications.recover(taskId,true));
      else track(new UpdateEngine(state.component(task.packageKey),make(task.packageKey,taskId)).resumeCloseout(taskId));
      res.statusCode=202;res.end(JSON.stringify({accepted:true,taskId}));
    }catch(e){res.statusCode=409;res.end(JSON.stringify({code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'UPDATE_REQUEST_REJECTED'}))}
  });
  return Object.assign(server,{waitForUpdates:async()=>{await Promise.allSettled([...pending])}});
}
export async function resumeNativeRuntime(state:NativeState,client:LicenseClient,host:NativeHost){
  const pending=state.tasks().filter(t=>t.status==='running'||t.status==='recovery_required');
  if(pending.length>1)throw Error('MULTIPLE_UPDATE_RECOVERY_REQUIRED');
  if(pending[0]?.operation){await new NativeApplicationLifecycle(state,host,client).recover(pending[0].id);}
  else if(pending[0]){const task=pending[0];const active=state.active(task.packageKey);
    if(active?.taskId===task.id||active?.taskId===task.id+'.rollback')await host.start();
    await new UpdateEngine(state.component(task.packageKey),new NativeEffects(state,host,client,task.packageKey,task.id,task.request)).recover()}
  if(!state.tasks().some(t=>t.status==='recovery_required')&&!host.running())await host.start();
}
async function main(){
  // Legacy split-component controller cannot be started as an enterprise deployment.
  throw Error('STANDALONE_WHOLE_PRODUCT_UPDATER_REQUIRED');
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/native-updater.js')&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('NATIVE_UPDATER_START_FAILED');process.exitCode=1});
