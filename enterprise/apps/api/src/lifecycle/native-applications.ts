import {existsSync,mkdirSync,readdirSync,renameSync,rmSync,statSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {LicenseClient} from '../license/client.js';
import {StateStore} from '../license/store.js';
import {canonicalJson} from '../license/contracts.js';
import {checkNativeOperation,assertNativeCompatibility,type NativeRelease} from '../license/native-updates.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {readApplicationDescriptor} from '../applications/native-descriptor-file.js';
import {componentDescriptorSchema} from '../applications/native-descriptor.js';
import {assertComponentOwner} from '../applications/component-owner.js';
import {NativeState,nativeExecuteSchema} from './native-state.js';
import {NativeHost} from './native-host.js';
import {NativeEffects,backupNativeDatabase} from './native-effects.js';
import {applicationMigrations} from './application-migrations.js';
import {downloadNativeArchive,extractNativeArchive,noLinks,syncDirectory,verifyNativeTree} from './native-files.js';
import type {ActiveReceipt,UpdateTask,VersionSlot} from './update-engine.js';

export const applicationRequestSchema=nativeExecuteSchema.extend({operation:z.enum(['install','repair','uninstall'])}).strict();
export type ApplicationRequest=z.infer<typeof applicationRequestSchema>;
type ApplicationTask=UpdateTask&{operation:ApplicationRequest['operation'];request:ApplicationRequest;before:ActiveReceipt|null;descriptor?:ReturnType<typeof readApplicationDescriptor>;inventoryBefore:string;codeMoved?:boolean};
const failure=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{1,63}$/.test(error.message)?error.message:'APPLICATION_OPERATION_FAILED';

function activeDescriptor(state:NativeState,packageKey:string){
 const active=state.active(packageKey);if(!active)throw Error('NATIVE_INSTALLATION_REQUIRED');
 const digest=state.release(packageKey,active.current).artifact.manifestSha256;
 const descriptor=componentDescriptorSchema.parse(state.component(packageKey).read('application-'+digest+'.json')??state.component(packageKey).read('application.json')??readApplicationDescriptor(state.path(packageKey,active.current),packageKey,active.current.version));
 if(descriptor.packageKey!==packageKey||descriptor.version!==active.current.version)throw Error('APPLICATION_DESCRIPTOR_MISMATCH');
 return descriptor;
}
export async function applicationImpact(state:NativeState,packageKey:string){
 const descriptor=activeDescriptor(state,packageKey),pendingTasks=[...descriptor.pendingTasks];
 if(descriptor.format==='qicore-application-v1')for(const item of state.installed()){
  if(item.packageKey===packageKey)continue;
  const active=state.active(item.packageKey)!;if(state.release(item.packageKey,active.current).manifest.type!=='plugin')continue;
  const extension=activeDescriptor(state,item.packageKey);
  if(extension.format==='qicore-plugin-v1'&&(extension.applicationKey==='*'||extension.applicationKey===descriptor.key))pendingTasks.push(...extension.pendingTasks);
 }
 const scopeKey=descriptor.format==='qicore-plugin-v1'?descriptor.applicationKey:descriptor.key;
 const scope=scopeKey==='*'?{}:{applicationKey:scopeKey};
 const db=new PrismaClient({datasources:{db:{url:state.config.migrationUrl}}});
 try{
  const [tenants,payments,refunds,notices]=await Promise.all([
   db.tenantApplication.count({where:{...scope,activeSlot:1}}),
   db.paymentRecord.count({where:{...scope,OR:[{state:{notIn:['PAID','PARTIAL_REFUND','REFUNDED','CLOSED']}},{leaseUntil:{not:null}}]}}),
   db.paymentRefund.count({where:{payment:scope,state:{notIn:['SUCCESS','CLOSED','REJECTED']}}}),
   db.$queryRaw<{total:bigint}[]>`SELECT COUNT(*) AS total FROM PaymentNotice n INNER JOIN PaymentRecord p ON p.id=n.paymentId WHERE (${scopeKey}='*' OR p.applicationKey=${scopeKey}) AND n.state<>'DONE'`,
  ]);
  let jobs=0;for(const task of pendingTasks){
   const rows=await db.$queryRawUnsafe<{total:bigint}[]>(`SELECT COUNT(*) AS total FROM \`${task.table}\` WHERE \`${task.statusColumn}\` IN (${task.pendingStates.map(()=>'?').join(',')})${task.applicationKeyColumn&&scopeKey!=='*'?` AND \`${task.applicationKeyColumn}\`=?`:''}`,...task.pendingStates,...(task.applicationKeyColumn&&scopeKey!=='*'?[scopeKey]:[]));jobs+=Number(rows[0]?.total??0);
  }
  return {tenants,pending:payments+refunds+Number(notices[0].total)+jobs,descriptor};
 }finally{await db.$disconnect()}
}

export class NativeApplicationLifecycle {
 constructor(readonly state:NativeState,readonly host:NativeHost,readonly client:LicenseClient){}
 protected runtime(){return {platform:process.platform,arch:process.arch,node:process.versions.node}}
 protected impact(key:string){return applicationImpact(this.state,key)}
 protected backup(id:string,version:string|null){return backupNativeDatabase(this.state,id,version)}
 protected migrations(release:NativeRelease,path:string,execute=false){return applicationMigrations(this.state.config.migrationUrl,release,path,execute)}
 private store(key:string){return this.state.component(key)}
 private stage(task:ApplicationTask){return join(this.store(task.request.packageKey).root,task.id)}
 private candidate(task:ApplicationTask){return join(this.state.directory(task.request.packageKey),'candidate-'+task.id)}
 private archive(task:ApplicationTask){return join(this.store(task.request.packageKey).root,(task.operation==='repair'?'repair-evidence-':'uninstalled-code-')+task.id)}
 private save(task:ApplicationTask){task.updatedAt=new Date().toISOString();const store=this.store(task.request.packageKey),tasks=store.read<UpdateTask[]>('tasks.json')??[],index=tasks.findIndex(t=>t.id===task.id);if(index<0)tasks.push(task);else tasks[index]=task;store.write('tasks.json',tasks)}
 private interrupted(task:ApplicationTask,error:unknown){
  let closing=failure(error)==='RUNTIME_HOST_CLOSING';try{this.host.assertOpen?.()}catch(cause){closing=closing||failure(cause)==='RUNTIME_HOST_CLOSING'}
  if(!closing)return false;if(failure(error)!=='RUNTIME_HOST_CLOSING')task.failureCode=failure(error);task.status='running';task.code='UPDATE_INTERRUPTED';this.save(task);return true;
 }
 private committed(task:ApplicationTask){const raw=this.store(task.request.packageKey).read<any>('active.json');return raw?.taskId===task.id&&(raw.schema==='qicore-uninstalled-v1'||raw.health==='passed')}
 private effects(task:ApplicationTask){return new NativeEffects(this.state,this.host,this.client,task.request.packageKey,task.id)}
 private async endMaintenance(task:ApplicationTask){const dir=join(this.state.config.dataRoot,'control');if(existsSync(dir)&&new StateStore(dir).read<any>('maintenance.json')?.taskId===task.id)await this.effects(task).maintenance(false)}
 private async inventory(repairKey?:string){
  const keys=this.state.installed().map(item=>item.packageKey);
  if(readdirSync(this.state.config.root).some(name=>!keys.includes(name)))throw Error('UNEXPLAINED_COMPONENT_DIRECTORY');
  for(const key of keys){
   const active=this.state.active(key)!,dir=this.state.directory(key),managed=this.store(key).read<VersionSlot[]>('managed.json')??[];
   if(readdirSync(dir).some(name=>!['current.json','releases'].includes(name))||managed.length>2)throw Error('UNEXPLAINED_RELEASE_DIRECTORY');
   const current=new StateStore(dir).read<VersionSlot>('current.json');if(current?.image!==active.current.image||current.version!==active.current.version)throw Error('ACTIVE_POINTER_MISMATCH');
   const keep=[active.current,...(active.previous?[active.previous]:[])];if(keep.some(slot=>!managed.some(m=>m.image===slot.image)))throw Error('UNEXPLAINED_RELEASE_VERSION');
   const hashes=managed.map(slot=>this.state.release(key,slot).artifact.manifestSha256);
   if(readdirSync(join(dir,'releases')).some(name=>!hashes.includes(name)))throw Error('UNEXPLAINED_RELEASE_DIRECTORY');
   for(const slot of managed)await verifyNativeTree(this.state.path(key,slot),nativeArchiveFromCatalog(this.state.release(key,slot).manifest),repairKey===key&&slot.image===active.current.image);
  }
 }
 async preview(packageKey:string,operation:ApplicationRequest['operation']){
  if(packageKey===this.state.config.frameworkKey)throw Error('APPLICATION_OPERATION_INVALID');
  const current=this.state.active(packageKey);
  if(operation==='uninstall'){
   if(!current)throw Error('NATIVE_INSTALLATION_REQUIRED');await this.inventory();const impact=await this.impact(packageKey);
   for(const item of this.state.installed().filter(item=>item.packageKey!==packageKey)){const manifest=this.state.release(item.packageKey,this.state.active(item.packageKey)!.current).manifest;if(manifest.dependencies.some(d=>d.packageKey===packageKey))throw Error('COMPONENT_DEPENDENCY_CONFLICT')}
   return {targetVersion:current.current.version,manifestSha256:this.state.release(packageKey,current.current).artifact.manifestSha256,tenants:impact.tenants,pending:impact.pending,integrity:[]};
  }
  const {release}=await checkNativeOperation(this.client,this.state.installed(),packageKey,operation);
  if(operation==='repair'&&release.artifact.manifestSha256!==this.state.release(packageKey,current!.current).artifact.manifestSha256)throw Error('REPAIR_SOURCE_CHANGED');
  const runtime=this.runtime();assertNativeCompatibility(this.state.installed().map(item=>nativeArchiveFromCatalog(this.state.release(item.packageKey,this.state.active(item.packageKey)!.current).manifest)),nativeArchiveFromCatalog(release.manifest),runtime.platform,runtime.arch,runtime.node);
  await this.inventory(operation==='repair'?packageKey:undefined);
  const integrity=operation==='repair'?await verifyNativeTree(this.state.path(packageKey,current!.current),nativeArchiveFromCatalog(release.manifest),true):[];
  return {targetVersion:release.version,manifestSha256:release.artifact.manifestSha256,releaseNotes:release.releaseNotes,tenants:0,pending:0,integrity};
 }
 async execute(id:string,input:unknown){
  const request=applicationRequestSchema.parse(input);if(request.requestId!==id)throw Error('REQUEST_ID_REUSED');
  const old=this.state.tasks().find(t=>t.id===id);if(old){if(canonicalJson(old.request)!==canonicalJson(request))throw Error('REQUEST_ID_REUSED');return old}
  if(this.state.tasks().some(t=>['running','recovery_required'].includes(t.status)))throw Error('UPDATE_ALREADY_ACTIVE');
  const task:ApplicationTask={id,operation:request.operation,request,before:this.state.active(request.packageKey),inventoryBefore:canonicalJson(this.state.installed()),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'running',step:'AUTHORIZE'};
  const step=(value:string)=>{task.step=value;this.save(task)};this.save(task);
  try{
   const preview=await this.preview(request.packageKey,request.operation);if(preview.targetVersion!==request.targetVersion||preview.manifestSha256!==request.manifestSha256)throw Error('UPDATE_VERSION_CHANGED');
   if(preview.pending)throw Error('APPLICATION_TASKS_PENDING');task.integrity=preview.integrity;
   let release:NativeRelease|undefined;
   if(request.operation!=='uninstall'){
    const grant=await checkNativeOperation(this.client,this.state.installed(),request.packageKey,request.operation);release=grant.release;
    if(release.version!==request.targetVersion||release.artifact.manifestSha256!==request.manifestSha256)throw Error('UPDATE_VERSION_CHANGED');
    this.store(request.packageKey).write('release-'+release.artifact.manifestSha256+'.json',release);
    task.componentTarget={from:task.before?.current??null,to:this.state.slot(release),releaseNotes:release.releaseNotes};step('PULL');
    const dir=this.state.directory(request.packageKey);mkdirSync(join(dir,'releases'),{recursive:true});noLinks(dir);noLinks(this.stage(task));
    // The controller's private-state umask must not make immutable application code inaccessible to the runtime user.
    chmodSync(dir,0o755);chmodSync(join(dir,'releases'),0o755);
    if(statSync(dir).dev!==statSync(this.store(request.packageKey).root).dev)throw Error('NATIVE_FILESYSTEM_MISMATCH');
    mkdirSync(this.stage(task),{mode:0o700});await downloadNativeArchive(this.client,release,grant.plan.planId,join(this.stage(task),'release.zip'),this.client.transport);
    await extractNativeArchive(join(this.stage(task),'release.zip'),this.candidate(task),release);task.descriptor=readApplicationDescriptor(this.candidate(task),request.packageKey,release.version,nativeArchiveFromCatalog(release.manifest));
    assertComponentOwner(this.state,task.descriptor,release);
    const previous=this.store(request.packageKey).read<any>('application.json');if(previous&&(previous.key!==task.descriptor.key||previous.format!==task.descriptor.format||previous.applicationKey!==('applicationKey' in task.descriptor?task.descriptor.applicationKey:undefined)||previous.namespace!==('namespace' in task.descriptor?task.descriptor.namespace:undefined)))throw Error('APPLICATION_IDENTITY_CHANGED');
    // Uninstalled components still own their retained tenant bindings, data and files.
    if(this.state.keys().some(key=>key!==request.packageKey&&this.store(key).read<any>('application.json')?.key===task.descriptor!.key))throw Error('APPLICATION_IDENTITY_CONFLICT');
    step('COMPATIBILITY');if(request.operation==='install')await this.migrations(release,this.candidate(task));
   }else{task.descriptor=(await this.impact(request.packageKey)).descriptor;task.componentTarget={from:task.before!.current,to:null,releaseNotes:'卸载程序，保留业务数据、配置与绑定'};this.save(task)}
   if(task.inventoryBefore!==canonicalJson(this.state.installed()))throw Error('INSTALLED_COMPONENTS_CHANGED');
   for(const item of this.state.installed())await verifyNativeTree(this.state.path(item.packageKey,this.state.active(item.packageKey)!.current),nativeArchiveFromCatalog(this.state.release(item.packageKey,this.state.active(item.packageKey)!.current).manifest),request.operation==='repair'&&item.packageKey===request.packageKey);
   if(request.operation!=='uninstall'){const fresh=await checkNativeOperation(this.client,this.state.installed(),request.packageKey,request.operation);if(fresh.release.artifact.manifestSha256!==request.manifestSha256)throw Error('UPDATE_VERSION_CHANGED')}
   step('MAINTENANCE');await this.effects(task).maintenance(true);step('STOP');await this.host.stop();this.host.assertOpen?.();
   if(request.operation==='uninstall'&&(await this.impact(request.packageKey)).pending)throw Error('APPLICATION_TASKS_PENDING');
   if(request.operation==='install'){
    step('BACKUP');const backup=await this.backup(id,null);if(backup.verified!==true||!/^backup-[A-Za-z0-9_-]{16,64}$/.test(backup.id)||!/^[a-f0-9]{64}$/.test(backup.sha256))throw Error('BACKUP_RECEIPT_REQUIRED');task.backup=backup;
    // Reserve identity before any DDL. A failed first health check rolls code back,
    // but must not let another identity take over data left by successful migrations.
    this.store(request.packageKey).write('application.json',task.descriptor);
    this.host.assertOpen?.();step('MIGRATE');await this.migrations(release!,this.candidate(task),true);
   }
   step('SWITCH');this.host.assertOpen?.();await this.switchCode(task);await this.host.start({key:request.packageKey,slot:task.componentTarget!.to});step('HEALTH');
   await this.health(task);step('COMMIT');const store=this.store(request.packageKey);
   if(request.operation==='uninstall')store.write('active.json',{schema:'qicore-uninstalled-v1',taskId:id,committedAt:new Date().toISOString(),previousInstallation:task.before,retainedData:true});
   else{
    store.write('application.json',task.descriptor);store.write('application-'+request.manifestSha256+'.json',task.descriptor);store.write('managed.json',request.operation==='repair'?(store.read('managed.json')??[]):[task.componentTarget!.to]);
    store.write('active.json',{schema:'zjz-xcx-active-v1',current:task.componentTarget!.to,previous:null,health:'passed',taskId:id,committedAt:new Date().toISOString(),recoveryReferences:[...(task.before?.recoveryReferences??[]),...(task.backup?[task.backup.id]:[])]});
   }
   step('CLEANUP');await this.health(task);await this.endMaintenance(task);await this.cleanup(task);task.status='succeeded';task.step='COMPLETE';this.save(task);
  }catch(error){if(this.interrupted(task,error))return task;task.code=failure(error);task.failureCode=task.code;this.save(task);await this.recoverTask(task)}
  return task;
 }
 private async switchCode(task:ApplicationTask){
  const key=task.request.packageKey,archive=this.archive(task);noLinks(archive);if(existsSync(archive))throw Error('RECOVERY_ARCHIVE_EXISTS');
  if(task.operation==='uninstall'){renameSync(this.state.directory(key),archive);task.codeMoved=true;this.save(task);syncDirectory(this.state.config.root);syncDirectory(this.store(key).root);return}
  const path=this.state.path(key,task.componentTarget!.to!);
  if(task.operation==='repair'&&existsSync(path)){renameSync(path,archive);task.codeMoved=true;this.save(task);syncDirectory(this.store(key).root)}
  if(existsSync(path))throw Error('RELEASE_SLOT_EXISTS');renameSync(this.candidate(task),path);syncDirectory(join(this.state.directory(key),'releases'));
  await this.state.switchTo(key,task.componentTarget!.to!,task.id);
 }
 private async health(task:ApplicationTask){const key=task.operation==='uninstall'?this.state.config.frameworkKey:task.request.packageKey,slot=task.operation==='uninstall'?this.state.active(key)!.current:task.componentTarget!.to!;await this.host.health(key,slot.version,this.state.release(key,slot).artifact.manifestSha256)}
 private async cleanup(task:ApplicationTask){
  const stage=this.stage(task);noLinks(stage);if(existsSync(stage)){if(readdirSync(stage).some(name=>name!=='release.zip'))throw Error('UNEXPLAINED_STAGING_FILE');rmSync(stage,{recursive:true});syncDirectory(this.store(task.request.packageKey).root)}
  if(existsSync(this.candidate(task)))throw Error('CANDIDATE_CLEANUP_REQUIRED');
  if(this.committed(task)){
   const key=task.request.packageKey,store=this.store(key),archive=this.archive(task);noLinks(archive);
   if(existsSync(archive)){
    const references=store.read<string[]>('recovery-references.json')??[];
    const slots=task.before?[task.before.current,...(task.before.previous?[task.before.previous]:[])]:[];
    if(references.some(value=>[task.id,archive,'recovery-archive-'+task.id+'.json',...slots.map(slot=>slot.image)].includes(value)))throw Error('RECOVERY_RELEASE_REFERENCED');
    if(task.operation==='uninstall'){
     if(readdirSync(archive).some(name=>!['current.json','releases'].includes(name)))throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
     const expected=slots.map(slot=>this.state.release(key,slot).artifact.manifestSha256);
     if(readdirSync(join(archive,'releases')).some(name=>!expected.includes(name)))throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
     for(const slot of slots)await verifyNativeTree(join(archive,'releases',this.state.release(key,slot).artifact.manifestSha256),nativeArchiveFromCatalog(this.state.release(key,slot).manifest));
    }else await verifyNativeTree(archive,nativeArchiveFromCatalog(this.state.release(key,task.before!.current).manifest),true);
    const receipt={taskId:task.id,operation:task.operation,path:archive,policy:'current-only',integrity:task.integrity??[],status:'planned',at:new Date().toISOString()};
    store.write('recovery-archive-'+task.id+'.json',receipt);rmSync(archive,{recursive:true});syncDirectory(store.root);store.write('recovery-archive-'+task.id+'.json',{...receipt,status:'removed'});
   }
   if(task.operation!=='uninstall')await this.effects(task).cleanup([this.state.active(key)!.current],this.state.active(key)!.recoveryReferences);
   else{const receipt=store.read<any>('active.json');store.write('active.json',{...receipt,codeRecovery:'released'});store.write('managed.json',[]);}
  }

  await this.inventory();
 }
 private async recoverTask(task:ApplicationTask){
  if(this.committed(task)){task.status='recovery_required';task.code='ACTIVE_HEALTHY_CLOSEOUT_BLOCKED';this.save(task);return}
  if(task.step==='MIGRATE'){task.status='recovery_required';task.code='MIGRATION_RECOVERY_REQUIRED';this.save(task);return}
  try{
   const afterStop=['STOP','BACKUP','SWITCH','HEALTH','COMMIT'].includes(task.step),key=task.request.packageKey;
   if(afterStop){await this.host.stop();
    if(task.operation==='uninstall'&&existsSync(this.archive(task))){if(existsSync(this.state.directory(key)))throw Error('DUPLICATE_RECOVERY_ARCHIVE');renameSync(this.archive(task),this.state.directory(key));syncDirectory(this.state.config.root)}
    else if(task.operation==='repair'&&task.componentTarget?.to){
     // A failed repair cannot assume that damaged original code can be restarted.
     task.status='recovery_required';task.code='REPAIR_RECOVERY_REQUIRED';this.save(task);return;
    }
   }
   const candidate=this.candidate(task);noLinks(candidate);if(existsSync(candidate)){const release=this.state.release(key,task.componentTarget!.to!);await verifyNativeTree(candidate,nativeArchiveFromCatalog(release.manifest));rmSync(candidate,{recursive:true})}
   if(task.operation==='install'&&task.componentTarget?.to){const path=this.state.path(key,task.componentTarget.to);if(existsSync(path)){await verifyNativeTree(path,nativeArchiveFromCatalog(this.state.release(key,task.componentTarget.to).manifest));rmSync(path,{recursive:true})}
    const dir=this.state.directory(key);if(existsSync(dir)){if(readdirSync(dir).some(name=>!['current.json','releases'].includes(name))||readdirSync(join(dir,'releases')).length)throw Error('UNEXPLAINED_RELEASE_DIRECTORY');rmSync(dir,{recursive:true});syncDirectory(this.state.config.root)}}
   if(afterStop){await this.host.start();const framework=this.state.active(this.state.config.frameworkKey)!;await this.host.health(this.state.config.frameworkKey,framework.current.version,this.state.release(this.state.config.frameworkKey,framework.current).artifact.manifestSha256)}await this.cleanup(task);await this.endMaintenance(task);task.status=afterStop?'rolled_back':'blocked';this.save(task);
  }catch(error){if(this.interrupted(task,error))return;task.status='recovery_required';task.code='APPLICATION_RECOVERY_REQUIRED';this.save(task)}
 }
 async recover(id:string,resume=false){
  const task=this.state.tasks().find(t=>t.id===id&&t.operation) as ApplicationTask|undefined;if(!task)throw Error('APPLICATION_TASK_MISSING');
  if(this.committed(task)){
   try{if(!this.host.running())await this.host.start();await this.health(task);const active=this.state.active(task.request.packageKey);if(active)this.store(task.request.packageKey).write('active.json',{...active,previous:null});await this.endMaintenance(task);await this.cleanup(task);task.status='succeeded';task.step='COMPLETE';delete task.code;this.save(task)}catch(error){if(this.interrupted(task,error))return task;task.status='recovery_required';task.code='ACTIVE_HEALTHY_CLOSEOUT_BLOCKED';this.save(task)}
  }else if(task.status==='running'&&!resume)await this.recoverTask(task);
  else throw Error('APPLICATION_RECOVERY_REQUIRED');return task;
 }
}
