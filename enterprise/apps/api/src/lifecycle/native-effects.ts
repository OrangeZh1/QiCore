import {existsSync,lstatSync,mkdirSync,readdirSync,renameSync,rmSync,readFileSync,statSync,chmodSync,chownSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {LicenseClient} from '../license/client.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {checkNativePlan,assertNativeCompatibility,type NativeRelease} from '../license/native-updates.js';
import {StateStore} from '../license/store.js';
import {BackupArchive} from '../backups/archive.mjs';
import {type UpdateEffects,type UpdateTarget,type VersionSlot,type UpdateTask,type ActiveReceipt} from './update-engine.js';
import {assertSafeMigrationSql} from './migration-safety.js';
import {frameworkMigrationSources,deployFrameworkMigrations} from './framework-migrations.js';
import {downloadNativeArchive,extractNativeArchive,noLinks,syncDirectory,verifyNativeTree,fileHash} from './native-files.js';
import {NativeState} from './native-state.js';
import type {NativeHost} from './native-host.js';
import {readApplicationDescriptor} from '../applications/native-descriptor-file.js';
import {assertComponentOwner} from '../applications/component-owner.js';

export function protectedUpdateBackups(state:Pick<NativeState,'tasks'|'keys'|'active'>,prior:string[]){
 const tasks=state.tasks(),known=new Set(tasks.flatMap(task=>task.backup?[task.backup.id]:[]));
 // Unknown references remain protected; terminal task history alone is not an active recovery dependency.
 const ids=prior.filter(id=>!known.has(id));
 for(const key of state.keys())ids.push(...(state.active(key)?.recoveryReferences??[]));
 for(const task of tasks)if(task.backup&&['running','recovery_required'].includes(task.status))ids.push(task.backup.id);
 return [...new Set(ids)];
}

export async function backupNativeDatabase(state:NativeState,id:string,version:string|null){
 const c=state.config,b=nativeBackups(state);b.init();
 const result=await b.start({id:'backup-'+id,source:'update',actorId:'system-updater',actorName:'系统更新',version,taskId:id,url:c.migrationUrl,accountMode:'existing'}).completion;
 if(result.status!=='completed'||result.verification!=='passed'||!result.sha256)throw Error('BACKUP_FAILED');return {id:result.id,sha256:result.sha256,verified:true};
}

export function nativeBackups(state:NativeState){
 const c=state.config;
 return new BackupArchive({root:c.backupRoot,keyRoot:c.backupKeyRoot,instanceDirectory:join(c.dataRoot,'admin'),binary:c.mysqldump,readOnlyKey:true,
  owner:process.getuid?.()===0?{uid:c.runtimeUid,gid:c.runtimeGid}:null});
}

export class NativeEffects implements UpdateEffects {
  private grant?:Awaited<ReturnType<typeof checkNativePlan>>;
  private release?:NativeRelease;
  private installedBefore?:string;
  readonly store:StateStore;
  constructor(readonly state:NativeState,readonly host:Pick<NativeHost,'stop'|'start'|'health'>&Partial<Pick<NativeHost,'assertOpen'>>,readonly client:LicenseClient,readonly key:string,readonly taskId:string,readonly expected?:UpdateTask['request']){
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(taskId))throw Error('INVALID_TASK_ID');this.store=state.component(key);
  }
  private stage(){const path=join(this.store.root,this.taskId);noLinks(path);return path}
  private candidate(){return join(this.state.directory(this.key),`candidate-${this.taskId}`)}
  private backups(){const b=nativeBackups(this.state);b.init();return b}
  assertOpen(){this.host.assertOpen?.()}
  async authorize(){
    const active=await this.state.verifyCurrent(this.key);
    const installed=this.state.installed();this.installedBefore=JSON.stringify(installed);
    this.grant=await checkNativePlan(this.client,installed,this.key);const release=this.grant.release;
    if(!release)throw Error('NO_UPDATE');
    if(!this.expected||release.version!==this.expected.targetVersion||release.artifact.manifestSha256!==this.expected.manifestSha256)throw Error('UPDATE_VERSION_CHANGED');
    this.release=release;
    this.store.write(`release-${release.artifact.manifestSha256}.json`,release);
    return {from:active.current,to:this.state.slot(release),planId:this.grant.plan.planId,rollbackCompatible:true,
      migrations:release.migrations.map(m=>({id:m.id,sha256:m.sha256,reversible:m.reversible})),releaseNotes:release.releaseNotes};
  }
  async inventory(){
    const allowedKeys=this.state.installed().map(c=>c.packageKey);
    const receipt=this.state.active(this.key),currentOnly=receipt?.previous===null&&[this.taskId,this.taskId+'.rollback'].includes(receipt.taskId);
    if(currentOnly)for(const key of this.state.keys())if(readdirSync(this.state.component(key).root).some(name=>/^(historical-code|repair-evidence-|uninstalled-code-)/.test(name)&&lstatSync(join(this.state.component(key).root,name)).isDirectory()))throw Error('LEGACY_CODE_CLEANUP_REQUIRED');
    if(readdirSync(this.state.config.root).some(key=>!allowedKeys.includes(key)))throw Error('UNEXPLAINED_COMPONENT_DIRECTORY');
    for(const key of allowedKeys){
      await this.state.verifyCurrent(key);const dir=this.state.directory(key),store=this.state.component(key);
      if(readdirSync(dir).some(name=>!['current.json','releases'].includes(name)))throw Error('UNEXPLAINED_RELEASE_DIRECTORY');
      const managed=store.read<VersionSlot[]>('managed.json')??[],active=this.state.active(key)!;
      const keep=[active.current,...(active.previous?[active.previous]:[])];
      const allowed=new Set(managed.map(s=>this.state.release(key,s).artifact.manifestSha256));
      if(readdirSync(join(dir,'releases')).some(name=>!allowed.has(name)))throw Error('UNEXPLAINED_RELEASE_DIRECTORY');
      if(managed.length>2||keep.some(s=>!managed.some(m=>m.image===s.image)))throw Error('UNEXPLAINED_RELEASE_VERSION');
      if(currentOnly&&(managed.length!==1||active.previous||readdirSync(store.root).some(name=>/^(historical-code|repair-evidence-|uninstalled-code-)/.test(name)&&lstatSync(join(store.root,name)).isDirectory())))throw Error('LEGACY_CODE_CLEANUP_REQUIRED');
      // Existing previous code is also protected from silent deletion after local edits.
      for(const slot of managed)await verifyNativeTree(this.state.path(key,slot),nativeArchiveFromCatalog(this.state.release(key,slot).manifest));
    }
  }
  async prepareRecoveryImages(_keep:VersionSlot[]){/* ZIP versions already reside in isolated immutable slots. */}
  async pull(target:VersionSlot){
    if(!this.release||!this.grant||this.state.slot(this.release).image!==target.image)throw Error('DOWNLOAD_GRANT_REQUIRED');
    const releases=join(this.state.directory(this.key),'releases');noLinks(releases);
    if(statSync(releases).dev!==statSync(this.store.root).dev)throw Error('NATIVE_FILESYSTEM_MISMATCH');
    mkdirSync(this.stage(),{mode:0o700});
    const archive=join(this.stage(),'release.zip');
    await downloadNativeArchive(this.client,this.release,this.grant.plan.planId,archive,this.client.transport);
    await extractNativeArchive(archive,this.candidate(),this.release);
    const path=this.state.path(this.key,target);if(existsSync(path))throw Error('RELEASE_SLOT_EXISTS');
    // Journal ownership before promotion: interrupted promotion remains recoverable, never unexplained cleanup.
    this.store.write('managed.json',[...(this.store.read<VersionSlot[]>('managed.json')??[]),target]);
    renameSync(this.candidate(),path);syncDirectory(releases);syncDirectory(this.state.directory(this.key));
  }
  private database(){return new PrismaClient({datasources:{db:{url:this.state.config.migrationUrl}}})}
  private async completedMigrations(db:PrismaClient,target:UpdateTarget){
    const current=this.state.release(this.key,target.from),release=this.state.release(this.key,target.to);
    const tables=await db.$queryRawUnsafe<any[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='_qicore_migrations'");
    const rows=tables.length?await db.$queryRawUnsafe<any[]>('SELECT migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=?',this.key):[];
    if(new Set(rows.map(r=>r.migration_id)).size!==rows.length||rows.some(r=>!r.finished)||current.migrations.some(m=>!rows.some(r=>r.migration_id===m.id&&r.sha256===m.sha256)))throw Error('MIGRATION_HISTORY_MISMATCH');
    const extra=rows.filter(r=>!current.migrations.some(m=>m.id===r.migration_id&&m.sha256===r.sha256));
    if(extra.length){
      // A failed candidate may have synchronized native aliases for SQL already executed by a
      // full Prisma installation. Code-only rollback keeps those rows; it must not erase them.
      if(current.manifest.type!=='framework'||release.manifest.type!=='framework')throw Error('MIGRATION_HISTORY_MISMATCH');
      const added=release.migrations.filter(m=>!current.migrations.some(old=>old.id===m.id));
      if(extra.some(r=>!added.some(m=>m.id===r.migration_id&&m.sha256===r.sha256)))throw Error('MIGRATION_HISTORY_MISMATCH');
      const sources=frameworkMigrationSources(current.manifest.files,release.manifest.files,added);
      for(const row of extra){
        const source=sources.find(s=>s.id===row.migration_id)!;
        const before=current.manifest.files.find(file=>file.path===source.path),after=release.manifest.files.find(file=>file.path===source.path)!;
        if(!before||before.sha256!==source.sha256||before.size!==after.size)throw Error('MIGRATION_HISTORY_MISMATCH');
        const history=await db.$queryRawUnsafe<any[]>('SELECT checksum,finished_at,rolled_back_at FROM _prisma_migrations WHERE migration_name=?',source.name);
        const active=history.filter(item=>!item.rolled_back_at);
        if(active.length!==1||active[0].checksum!==source.sha256||!active[0].finished_at)throw Error('FRAMEWORK_MIGRATION_HISTORY_MISMATCH');
      }
    }
    return new Set<string>(rows.map(r=>r.migration_id));
  }
  protected runtime(){return {platform:process.platform,arch:process.arch,node:process.versions.node}}
  protected assertGrant(){if(!this.grant||Date.parse(this.grant.plan.validUntil)<=Date.now())throw Error('UPDATE_PLAN_EXPIRED')}
  async compatibility(target:UpdateTarget){
    this.assertGrant();
    if(this.installedBefore!==JSON.stringify(this.state.installed()))throw Error('INSTALLED_COMPONENTS_CHANGED');
    const fresh=await checkNativePlan(this.client,this.state.installed(),this.key);
    if(!fresh.release||fresh.release.artifact.manifestSha256!==this.state.release(this.key,target.to).artifact.manifestSha256)throw Error('UPDATE_VERSION_CHANGED');
    this.grant=fresh;
    await this.validateCandidate(target);
  }
  protected async validateCandidate(target:UpdateTarget){
    const release=this.state.release(this.key,target.to),current=this.state.release(this.key,target.from);
    const runtime=this.runtime();
    assertNativeCompatibility(this.state.installed().map(c=>nativeArchiveFromCatalog(this.state.release(c.packageKey,this.state.active(c.packageKey)!.current).manifest)),nativeArchiveFromCatalog(release.manifest),runtime.platform,runtime.arch,runtime.node);
    await verifyNativeTree(this.state.path(this.key,target.to),nativeArchiveFromCatalog(release.manifest));
    if(release.manifest.type!=='framework'){
      const before=readApplicationDescriptor(this.state.path(this.key,target.from),this.key,target.from.version),after=readApplicationDescriptor(this.state.path(this.key,target.to),this.key,target.to.version,nativeArchiveFromCatalog(release.manifest));
      if(before.key!==after.key||before.format!==after.format||('applicationKey' in before?before.applicationKey:undefined)!==('applicationKey' in after?after.applicationKey:undefined)||('namespace' in before?before.namespace:undefined)!==('namespace' in after?after.namespace:undefined))throw Error('APPLICATION_IDENTITY_CHANGED');
      assertComponentOwner(this.state,after,release);
    }
    for(const c of this.state.installed())await this.state.verifyCurrent(c.packageKey);
    for(const old of current.migrations)if(!release.migrations.some(m=>m.id===old.id&&m.sha256===old.sha256&&m.order===old.order))throw Error('MIGRATION_HISTORY_CHANGED');
    for(const m of release.migrations)assertSafeMigrationSql(readFileSync(join(this.state.path(this.key,target.to),m.path),'utf8'));
    const added=release.migrations.filter(m=>!current.migrations.some(old=>old.id===m.id));
    if(added.length&&release.manifest.type==='framework'&&release.manifest.files.some(file=>file.path==='apps/api/prisma/schema.prisma'))frameworkMigrationSources(current.manifest.files,release.manifest.files,added);
    const db=this.database();try{await this.completedMigrations(db,target)}finally{await db.$disconnect()}
  }
  async maintenance(enabled:boolean){
    this.host.assertOpen?.();
    const backups=nativeBackups(this.state),control=new StateStore(join(this.state.config.dataRoot,'control'));
    if(enabled){const prior=control.read<{taskId:string;at:string}>('maintenance.json');if(prior?.taskId!==this.taskId)backups.init();else backups.store=new StateStore(this.state.config.backupRoot);backups.acquireOperation('update',this.taskId);control.write('maintenance.json',{taskId:this.taskId,packageKey:this.key,at:prior?.taskId===this.taskId?prior.at:new Date().toISOString()});if(process.getuid?.()===0){chownSync(control.root,0,this.state.config.runtimeGid);chmodSync(control.root,0o750);chownSync(control.path('maintenance.json'),0,this.state.config.runtimeGid);chmodSync(control.path('maintenance.json'),0o640)}}
    else{
      // Releasing maintenance must not require the failed dump tool or encryption key.
      backups.store=new StateStore(this.state.config.backupRoot);
      const ids=protectedUpdateBackups(this.state,backups.store!.read<{ids:string[]}>('update-references.json')?.ids??[]);
      backups.store!.write('update-references.json',{ids,updatedAt:new Date().toISOString()});
      backups.protect(backups.store!.path('update-references.json'));
      const maintenance=control.read<{taskId:string;at:string}>('maintenance.json');
      if(maintenance&&maintenance.taskId!==this.taskId)throw Error('MAINTENANCE_OWNER_MISMATCH');
      if(maintenance){const durationMs=Date.now()-Date.parse(maintenance.at),history=control.read<{taskId:string;durationMs:number;finishedAt:string}[]>('maintenance-history.json')??[];
        if(Number.isFinite(durationMs)&&durationMs>0&&!history.some(item=>item.taskId===this.taskId))control.write('maintenance-history.json',[...history,{taskId:this.taskId,durationMs,finishedAt:new Date().toISOString(),outcome:this.state.active(this.key)?.taskId===this.taskId?'updated':'restored'}].slice(-10));}
      backups.releaseOperation('update',this.taskId);control.remove('maintenance.json');syncDirectory(control.root);
    }
  }
  async stop(){await this.host.stop({abortStartup:true})}
  async backup(id:string){
    this.host.assertOpen?.();
    for(const c of this.state.installed())await this.state.verifyCurrent(c.packageKey);
    return backupNativeDatabase(this.state,id,this.state.active(this.key)?.current.version??null);
  }
  async migrate(target:UpdateTarget){
    this.host.assertOpen?.();
    this.assertGrant();
    const current=this.state.release(this.key,target.from),release=this.state.release(this.key,target.to),declared=release.migrations.filter(m=>!current.migrations.some(c=>c.id===m.id));
    if(!declared.length)return;
    const db=this.database();try{
      const completed=await this.completedMigrations(db,target),pending=declared.filter(m=>!completed.has(m.id));
      if(!pending.length)return;
      await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS _qicore_migrations (package_key VARCHAR(64) NOT NULL, migration_id VARCHAR(128) NOT NULL, sha256 CHAR(64) NOT NULL, finished BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(package_key,migration_id))');
      if(release.manifest.type==='framework'&&release.manifest.files.some(file=>file.path==='apps/api/prisma/schema.prisma')){
        const sources=frameworkMigrationSources(current.manifest.files,release.manifest.files,declared);
        for(const m of pending)await db.$executeRawUnsafe('INSERT INTO _qicore_migrations(package_key,migration_id,sha256,finished) VALUES(?,?,?,FALSE)',this.key,m.id,m.sha256);
        deployFrameworkMigrations(this.state.path(this.key,target.to),this.state.config.migrationUrl);
        for(const source of sources){
          const rows=await db.$queryRawUnsafe<any[]>('SELECT checksum,finished_at,rolled_back_at FROM _prisma_migrations WHERE migration_name=?',source.name);
          if(!rows.some(row=>row.checksum===source.sha256&&row.finished_at&&!row.rolled_back_at))throw Error('FRAMEWORK_MIGRATION_HISTORY_MISMATCH');
        }
        for(const m of pending)await db.$executeRawUnsafe('UPDATE _qicore_migrations SET finished=TRUE WHERE package_key=? AND migration_id=?',this.key,m.id);
        return;
      }
      for(const m of [...pending].sort((a,b)=>a.order-b.order)){
        const statements=assertSafeMigrationSql(readFileSync(join(this.state.path(this.key,target.to),m.path),'utf8'));
        await db.$executeRawUnsafe('INSERT INTO _qicore_migrations(package_key,migration_id,sha256,finished) VALUES(?,?,?,FALSE)',this.key,m.id,m.sha256);
        for(const statement of statements)await db.$executeRawUnsafe(statement);
        await db.$executeRawUnsafe('UPDATE _qicore_migrations SET finished=TRUE WHERE package_key=? AND migration_id=?',this.key,m.id);
      }
    }finally{await db.$disconnect()}
  }
  async switchTo(target:VersionSlot){this.host.assertOpen?.();await this.state.switchTo(this.key,target,this.taskId);await this.host.start()}
  async health(target:VersionSlot){const release=this.state.release(this.key,target);await this.host.health(this.key,target.version,release.artifact.manifestSha256);if(release.manifest.type!=='framework')this.store.write('application-'+release.artifact.manifestSha256+'.json',readApplicationDescriptor(this.state.path(this.key,target),this.key,target.version))}
  async retireApplicationArchives(){
    const tasks=this.store.read<(UpdateTask&{before?:ActiveReceipt|null})[]>('tasks.json')??[],external=this.store.read<string[]>('recovery-references.json')??[];
    const pending=this.state.tasks().filter(task=>task.id!==this.taskId&&['running','recovery_required'].includes(task.status)).flatMap(task=>[task.target?.from.image,task.target?.to.image,task.componentTarget?.from?.image,task.componentTarget?.to?.image,task.previousBefore?.image]);
    for(const name of readdirSync(this.store.root).filter(name=>/^(repair-evidence-|uninstalled-code-)/.test(name))){
      const path=join(this.store.root,name);noLinks(path);if(!lstatSync(path).isDirectory())throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
      const id=name.replace(/^(repair-evidence-|uninstalled-code-)/,''),task=tasks.find(task=>task.id===id),file='recovery-archive-'+id+'.json';
      const record=this.store.read<{path:string;taskId:string;operation:string;status?:string}>(file);
      if(!task?.before||!['succeeded','rolled_back','blocked'].includes(task.status)||task.request?.packageKey!==this.key||!['repair','uninstall'].includes(task.operation??'')||!record||record.taskId!==id||record.operation!==task.operation||resolve(record.path)!==resolve(path)||record.status==='removed'||name!==(task.operation==='repair'?'repair-evidence-':'uninstalled-code-')+id)throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
      const slots=[task.before.current,...(task.before.previous?[task.before.previous]:[])];
      if(external.some(value=>[id,path,file,...slots.map(slot=>slot.image)].includes(value))||slots.some(slot=>pending.includes(slot.image)))throw Error('RECOVERY_RELEASE_REFERENCED');
      let integrity:({path:string;kind:string;actualSha256?:string})[]=[];
      if(task.operation==='repair'){
        integrity=await verifyNativeTree(path,nativeArchiveFromCatalog(this.state.release(this.key,task.before.current).manifest),true);
        for(const issue of integrity)if(issue.kind==='modified')issue.actualSha256=await fileHash(join(path,issue.path));
      }else{
        if(readdirSync(path).some(name=>!['current.json','releases'].includes(name)))throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
        const pointer=new StateStore(path).read<VersionSlot>('current.json');if(pointer?.image!==task.before.current.image||pointer.version!==task.before.current.version)throw Error('RECOVERY_ARCHIVE_INVALID');
        const expected=slots.map(slot=>this.state.release(this.key,slot).artifact.manifestSha256);
        if(readdirSync(join(path,'releases')).some(name=>!expected.includes(name)))throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
        for(const slot of slots)await verifyNativeTree(join(path,'releases',this.state.release(this.key,slot).artifact.manifestSha256),nativeArchiveFromCatalog(this.state.release(this.key,slot).manifest));
      }
      const receipt={...record,policy:'current-only',retiredBy:this.taskId,retiredAt:new Date().toISOString(),integrity,status:'retiring'};
      this.store.write(file,receipt);rmSync(path,{recursive:true});syncDirectory(this.store.root);this.store.write(file,{...receipt,status:'removed'});
    }
    const active=this.store.read<any>('active.json');
    if(active?.schema==='qicore-uninstalled-v1'){
      if(external.length||tasks.some(task=>task.id!==this.taskId&&['running','recovery_required'].includes(task.status)))throw Error('RECOVERY_RELEASE_REFERENCED');
      if(existsSync(this.state.directory(this.key)))throw Error('UNEXPLAINED_RELEASE_DIRECTORY');
      this.store.write('active.json',{...active,codeRecovery:'released'});this.store.write('managed.json',[]);
    }
  }
  async cleanup(keep:VersionSlot[],references:string[],sweep=true){
    if(keep.length<1||keep.length>2||references.some(id=>!/^backup-[A-Za-z0-9_-]{16,64}$/.test(id)))throw Error('CLEANUP_ALLOWLIST_INVALID');
    const active=this.state.active(this.key),committed=!sweep||[this.taskId,this.taskId+'.rollback'].includes(active?.taskId??'');
    if(active&&!keep.some(slot=>slot.image===active.current.image&&slot.version===active.current.version))throw Error('CLEANUP_ACTIVE_VERSION_REQUIRED');
    const managed=this.store.read<VersionSlot[]>('managed.json')??[],retained=new Set(keep.map(s=>s.image));
    const external=this.store.read<string[]>('recovery-references.json')??[];
    const otherTasks=this.state.tasks().filter(t=>t.id!==this.taskId);
    const journal=otherTasks.filter(t=>['running','recovery_required'].includes(t.status)).flatMap(t=>[t.target?.from.image,t.target?.to.image,t.componentTarget?.from?.image,t.componentTarget?.to?.image,t.previousBefore?.image]);
    const remove=managed.filter(s=>!retained.has(s.image));
    const archives=committed?(this.store.read<Record<string,{path:string;taskId:string;status:string;version?:string}>>('archived-releases.json')??{}):{};
    const removals=remove.map(slot=>({slot,path:this.state.path(this.key,slot)}));
    for(const [image,record] of Object.entries(archives)){
      const digest=image.split('@sha256:')[1],release=this.store.read<any>(`release-${digest}.json`);
      const slot={image,version:release?.version};if(!slot.version)throw Error('RECOVERY_ARCHIVE_INVALID');
      const path=join(this.store.root,'historical-code',this.state.release(this.key,slot).artifact.manifestSha256);
      if(resolve(record.path)!==resolve(path))throw Error('RECOVERY_ARCHIVE_INVALID');
      if(existsSync(path))removals.push({slot,path});
    }
    const history=join(this.store.root,'historical-code');noLinks(history);
    if(committed&&existsSync(history)&&readdirSync(history).some(name=>!removals.some(item=>item.path===join(history,name))))throw Error('UNEXPLAINED_RECOVERY_ARCHIVE');
    if(removals.some(({slot})=>external.includes(slot.image)||journal.includes(slot.image)))throw Error('RECOVERY_RELEASE_REFERENCED');
    for(const {slot,path} of removals){noLinks(path);if(existsSync(path))await verifyNativeTree(path,nativeArchiveFromCatalog(this.state.release(this.key,slot).manifest))}
    // Terminal task manifests are audit evidence. This durable record explicitly
    // releases their code references without erasing journals or database backups.
    const receiptFile='code-cleanup-'+Buffer.from(this.taskId).toString('hex')+'.json',prior=this.store.read<{removed:{slot:VersionSlot;path:string}[];releasedTasks:string[]}>(receiptFile);
    const removed=[...new Map([...(prior?.removed??[]),...removals].map(item=>[item.path,item])).values()];
    const receipt={policy:committed?'current-only':'preparation-only',taskId:this.taskId,keep,removed,releasedTasks:committed?[...new Set([...(prior?.releasedTasks??[]),...otherTasks.filter(t=>!['running','recovery_required'].includes(t.status)).map(t=>t.id)])]:[],status:'planned',at:new Date().toISOString()};
    this.store.write(receiptFile,receipt);
    for(const {path} of removals)if(existsSync(path)){rmSync(path,{recursive:true});syncDirectory(resolve(path,'..'))}
    if(committed&&existsSync(history)&&readdirSync(history).length===0)rmSync(history,{recursive:true});
    for(const record of Object.values(archives))record.status='removed';
    if(Object.keys(archives).length)this.store.write('archived-releases.json',archives);
    this.store.write('managed.json',keep);
    // This task owns only its downloaded archive. Unknown entries are recovery evidence, never erased.
    const stage=this.stage();if(existsSync(stage)){if(!lstatSync(stage).isDirectory()||readdirSync(stage).some(name=>name!=='release.zip')||existsSync(join(stage,'release.zip'))&&!lstatSync(join(stage,'release.zip')).isFile())throw Error('UNEXPLAINED_STAGING');rmSync(stage,{recursive:true})}
    syncDirectory(join(this.state.directory(this.key),'releases'));
    this.store.write(receiptFile,{...receipt,status:'completed'});
    if(committed)await this.retireApplicationArchives();
    if(sweep&&keep.length===1&&[this.taskId,this.taskId+'.rollback'].includes(this.state.active(this.key)?.taskId??'')){
      for(const {packageKey:key} of this.state.installed().filter(item=>item.packageKey!==this.key)){
        const active=await this.state.verifyCurrent(key),release=this.state.release(key,active.current);
        await this.host.health(key,active.current.version,release.artifact.manifestSha256);
        this.state.component(key).write('active.json',{...active,previous:null});
        await new NativeEffects(this.state,this.host,this.client,key,this.taskId).cleanup([active.current],active.recoveryReferences,false);
      }
      for(const key of this.state.keys().filter(key=>!this.state.active(key)))await new NativeEffects(this.state,this.host,this.client,key,this.taskId).retireApplicationArchives();
    }
  }
  async abortPreparation(){
    const active=this.state.active(this.key);if(!active)return;
    const task=(this.store.read<UpdateTask[]>('tasks.json')??[]).find(t=>t.id===this.taskId);
    const target=task?.target?.to;
    if(!target)return;
    const allowed=new Set([active.current.image,active.previous?.image,target.image]);
    if((this.store.read<VersionSlot[]>('managed.json')??[]).some(slot=>!allowed.has(slot.image)))throw Error('UNEXPLAINED_RELEASE_VERSION');
    const candidate=this.candidate();noLinks(candidate);
    if(existsSync(candidate)){
      if(!target)throw Error('CANDIDATE_OWNER_UNKNOWN');
      const manifest=nativeArchiveFromCatalog(this.state.release(this.key,target).manifest),allowed=new Set(manifest.files.map(f=>f.path));
      const walk=(dir:string,prefix='')=>{for(const name of readdirSync(dir)){const path=join(dir,name),r=prefix+name,s=lstatSync(path);if(s.isSymbolicLink())throw Error('NATIVE_PATH_UNSAFE');if(s.isDirectory()){if(![...allowed].some(p=>p.startsWith(r+'/')))throw Error('UNEXPLAINED_STAGING');walk(path,r+'/')}else if(!s.isFile()||s.nlink!==1||!allowed.has(r))throw Error('UNEXPLAINED_STAGING')}};
      walk(candidate);rmSync(candidate,{recursive:true});
    }
    await this.cleanup([active.current,...(active.previous?[active.previous]:[])],active.recoveryReferences);
    const control=new StateStore(join(this.state.config.dataRoot,'control'));
    if(control.read<{taskId:string}>('maintenance.json')?.taskId===this.taskId)await this.maintenance(false);
  }
}
