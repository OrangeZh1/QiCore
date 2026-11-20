import {fork,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {get} from 'node:http';
import {NativeState} from './native-state.js';
import {StateStore} from '../license/store.js';
import type {VersionSlot} from './update-engine.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {verifyNativeTree} from './native-files.js';
import {readApplicationDescriptor} from '../applications/native-descriptor-file.js';
import {assertComponentOwner} from '../applications/component-owner.js';

export class NativeHost {
  private child?:ChildProcess;
  private runtimeId?:string;
  private frameworkVersion?:string;
  private ready=new WeakSet<ChildProcess>();
  private closing=false;
  private stopping=new WeakSet<ChildProcess>();
  constructor(readonly state:NativeState,readonly beforeStart?:()=>Promise<void>,readonly onUnexpectedExit=()=>{console.error('RUNTIME_EXITED');process.exit(1)}){}
  running(){return !!this.child&&this.child.exitCode===null&&this.child.signalCode===null}
  assertOpen(){if(this.closing)throw Error('RUNTIME_HOST_CLOSING')}
  async shutdown(){this.closing=true;await this.stop()}
  acceptsHealth(value:{runtimeId?:string;version?:string}){return !!this.runtimeId&&value.runtimeId===this.runtimeId&&value.version===this.frameworkVersion}
  async available(){if(!this.running())return false;try{const response=await fetch(this.state.config.healthUrl,{signal:AbortSignal.timeout(2000),redirect:'error'}),data=await response.json() as any;const ready=response.ok&&data.ready===true&&data.mock!==true&&this.acceptsHealth(data);if(ready&&this.child)this.ready.add(this.child);return ready}catch{return false}}
  async stop(options:{abortStartup?:boolean}={}){
    const child=this.child;if(!child)return;
    if(child.exitCode!==null||child.signalCode!==null){this.child=undefined;return}
    // Local operators may stop a started runtime before explicitly calling health(). Preserve ready old runtimes too.
    if(options.abortStartup&&!this.ready.has(child))await this.available();
    if(this.child!==child){if(this.child)throw Error('RUNTIME_CHANGED');return}
    const abortStartup=options.abortStartup===true&&!this.ready.has(child);
    this.runtimeId=undefined;
    this.frameworkVersion=undefined;
    this.stopping.add(child);
    await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>fail(Error('RUNTIME_STOP_TIMEOUT')),70000);child.once('exit',code=>{clearTimeout(timer);this.child=undefined;if(code===0)ok();else fail(Error('RUNTIME_DRAIN_FAILED'))});child.send(abortStartup?'abort-startup':'stop',error=>{if(error){clearTimeout(timer);fail(Error('RUNTIME_STOP_FAILED'))}})});
  }
  async start(initial?:{key:string;slot:VersionSlot|null}){
    this.assertOpen();
    await this.beforeStart?.();
    await this.stop();this.assertOpen();const {config}=this.state,paths:Record<string,{version:string;manifestSha256:string;path:string;type:string;entrypoint:string}>={};
    const installed=this.state.installed();
    if(initial?.key===config.frameworkKey&&(!initial.slot||installed.length))throw Error('INITIAL_RUNTIME_NOT_EMPTY');
    if(initial&&initial.key!==config.frameworkKey&&!installed.some(c=>c.packageKey===config.frameworkKey))throw Error('FRAMEWORK_INSTALLATION_REQUIRED');
    const selected=initial?[...installed.filter(c=>c.packageKey!==initial.key),...(initial.slot?[{packageKey:initial.key}]:[])]:installed;
    // Pointers, not the pre-commit receipt, determine the version being health checked.
    for(const {packageKey:key} of selected){
      const slot=initial?.key===key?initial.slot:new StateStore(this.state.directory(key)).read<VersionSlot>('current.json');if(!slot)throw Error('ACTIVE_POINTER_MISMATCH');
      const verified=this.state.release(key,slot),path=this.state.path(key,slot);
      await verifyNativeTree(path,nativeArchiveFromCatalog(verified.manifest));
      if(verified.manifest.type!=='framework')assertComponentOwner(this.state,readApplicationDescriptor(path,key,slot.version,nativeArchiveFromCatalog(verified.manifest)),verified);
      paths[key]={version:slot.version,manifestSha256:verified.artifact.manifestSha256,path,type:verified.manifest.type,entrypoint:verified.manifest.entrypoint,...verified.manifest.type==='plugin'?{parentApp:verified.manifest.parentApp}:{}};
    }
    const active=paths[config.frameworkKey];if(!active)throw Error('FRAMEWORK_INSTALLATION_REQUIRED');
    const release=this.state.release(config.frameworkKey,{version:active.version,image:`native/${config.frameworkKey}@sha256:${active.manifestSha256}`});
    this.assertOpen();this.runtimeId=randomUUID();
    this.frameworkVersion=active.version;
    const env={...parseEnv(readFileSync(config.environmentFile,'utf8')),PRISMA_QUERY_ENGINE_LIBRARY:join(active.path,'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node'),BACKUP_PATH:config.backupRoot,BACKUP_KEY_PATH:config.backupKeyRoot,BACKUP_MYSQLDUMP_PATH:config.mysqldump,BACKUP_READ_ONLY_KEY:'true',NODE_ENV:'production',QICORE_RUNTIME_ID:this.runtimeId,QICORE_MAINTENANCE_FILE:join(config.dataRoot,'control','maintenance.json'),QICORE_COMPONENTS:JSON.stringify(paths),QICORE_PRODUCT:JSON.stringify({...config.product,version:active.version})};
    this.child=fork(new URL('./native-worker.js',import.meta.url),[join(active.path,release.manifest.entrypoint),active.path],
      {env,uid:config.runtimeUid,gid:config.runtimeGid,execArgv:[],stdio:['ignore','inherit','inherit','ipc']});
    const child=this.child,runtimeId=this.runtimeId;let handled=false;
    const exited=()=>{
      if(handled)return;handled=true;
      if(this.child===child)this.child=undefined;
      // Installation and update engines own candidate failures and recovery.
      // Outside those operations, fail the stable controller so its supervisor
      // restarts the whole service instead of leaving a healthy-looking dead host.
      const check=()=>{
        if(this.stopping.has(child)||this.runtimeId!==runtimeId)return;
        const tasks=this.state.tasks(),installation=this.state.component(config.frameworkKey).read<{status:string}>('installation.json');
        if(tasks.some(task=>task.status==='recovery_required')||installation?.status==='recovery_required')return;
        if(tasks.some(task=>task.status==='running')||installation?.status==='running'){
          setTimeout(check,1000).unref();return;
        }
        if(this.state.active(config.frameworkKey))this.onUnexpectedExit();
      };
      check();
    };
    child.once('exit',exited);child.once('error',exited);
  }
  async health(key:string,version:string,digest:string){
    // Connect over loopback, but route SSR with the configured public host just like the reverse proxy.
    const configuredOrigin=parseEnv(readFileSync(this.state.config.environmentFile,'utf8')).ADMIN_ORIGIN;
    if(!configuredOrigin)throw Error('NATIVE_HEALTH_ORIGIN_INVALID');
    const origin=new URL(configuredOrigin);
    if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)throw Error('NATIVE_HEALTH_ORIGIN_INVALID');
    for(let i=0;i<30;i++){
      this.assertOpen();
      if(!this.running())throw Error('RUNTIME_EXITED');
      try{
        const response=await fetch(this.state.config.healthUrl,{signal:AbortSignal.timeout(2000),redirect:'error'}),data=await response.json() as any;
        const publicResponse=await fetch(new URL('/api/v1/public/site',this.state.config.healthUrl),{signal:AbortSignal.timeout(2000),redirect:'error'}),site=await publicResponse.json() as any;
        const page=await new Promise<boolean>((ok,fail)=>{
          const request=get(this.state.config.loginUrl,{headers:{host:origin.host},signal:AbortSignal.timeout(2000)},response=>{
            let html='';response.setEncoding('utf8');response.on('data',chunk=>{html+=chunk;if(html.length>2*1024*1024)request.destroy(Error('NATIVE_HEALTH_RESPONSE_INVALID'))});
            response.once('error',fail);response.once('end',()=>ok(response.statusCode===200&&!!response.headers['content-type']?.startsWith('text/html')&&html.includes('<html')));
          });request.once('error',fail);
        });
        if(response.ok&&data.ready===true&&data.mock!==true&&this.acceptsHealth(data)&&data.components?.[key]?.version===version&&data.components[key].manifestSha256===digest
          &&publicResponse.ok&&typeof site?.data?.platform?.name==='string'&&page){if(this.child)this.ready.add(this.child);return;}
      }catch{}
      await new Promise(r=>setTimeout(r,1000));
    }
    throw Error('HEALTH_CHECK_FAILED');
  }
}
