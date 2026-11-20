import {existsSync,lstatSync,readdirSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {z} from 'zod';
import {StateStore} from '../license/store.js';
import {verifyNativeStoredRelease,type NativeStoredRelease} from '../license/native-updates.js';
import {validateProduct,type Product} from '../license/client.js';
import type {ActiveReceipt,VersionSlot,UpdateTask} from './update-engine.js';
import {noLinks,syncDirectory,verifyNativeTree} from './native-files.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {parseMigrationUrl} from './database-credentials.js';

export const nativeConfigSchema=z.object({root:z.string(),stateRoot:z.string(),dataRoot:z.string(),socket:z.string(),
  installationSocket:z.string().optional(),
  maintenancePort:z.number().int().min(1024).max(65535).optional(),
  frameworkKey:z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),healthUrl:z.url(),loginUrl:z.url(),
  runtimeUid:z.number().int().positive(),runtimeGid:z.number().int().positive(),environmentFile:z.string(),licenseStateRoot:z.string(),
  product:z.custom<Product>(),migrationUrl:z.string(),backupRoot:z.string(),backupKeyRoot:z.string(),mysqldump:z.string(),
}).strict();
export type NativeConfig=z.infer<typeof nativeConfigSchema>;
export const nativeExecuteSchema=z.object({requestId:z.string().uuid(),packageKey:z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),targetVersion:z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),manifestSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export class NativeState {
  readonly store:StateStore;
  constructor(readonly config:NativeConfig){
    for(const path of [config.root,config.stateRoot,config.dataRoot,config.environmentFile,config.licenseStateRoot,config.backupRoot,config.backupKeyRoot]){if(!isAbsolute(path))throw Error('NATIVE_PATH_UNSAFE');noLinks(path)}
    for(const path of [config.stateRoot,config.dataRoot,config.environmentFile,config.licenseStateRoot,config.backupRoot,config.backupKeyRoot]){
      const r=relative(resolve(config.root),resolve(path));if(!r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r))throw Error('PERSISTENT_PATH_IN_RELEASE_ROOT');
    }
    if(config.product.appKey!==config.frameworkKey||config.product.deliveryKind!=='archive')throw Error('NATIVE_PRODUCT_MISMATCH');
    validateProduct(config.product);
    parseMigrationUrl(config.migrationUrl,'existing');
    for(const value of [config.healthUrl,config.loginUrl]){const url=new URL(value);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw Error('NATIVE_HEALTH_URL_INVALID')}
    if(config.maintenancePort&&[config.healthUrl,config.loginUrl].some(value=>Number(new URL(value).port||80)===config.maintenancePort))throw Error('NATIVE_STATUS_PORT_CONFLICT');
    this.store=new StateStore(config.stateRoot);
  }
  component(key:string){if(!/^[a-z][a-z0-9_]{1,63}$/.test(key))throw Error('INVALID_COMPONENT');const path=join(this.config.stateRoot,key);noLinks(path);return new StateStore(path)}
  directory(key:string){this.component(key);const path=join(this.config.root,key);noLinks(path);return path}
  keys(){return readdirSync(this.config.stateRoot).filter(name=>{const p=join(this.config.stateRoot,name);if(lstatSync(p).isSymbolicLink())throw Error('NATIVE_PATH_UNSAFE');return lstatSync(p).isDirectory()}).map(key=>{this.component(key);return key})}
  active(key:string){
    if(!/^[a-z][a-z0-9_]{1,63}$/.test(key))throw Error('INVALID_COMPONENT');
    const path=join(this.config.stateRoot,key);noLinks(path);
    if(!existsSync(path))return null;
    const value=this.component(key).read<ActiveReceipt|{schema:'qicore-uninstalled-v1'}>('active.json');return value?.schema==='qicore-uninstalled-v1'?null:value;
  }
  release(key:string,slot:VersionSlot):NativeStoredRelease {
    const match=new RegExp(`^native/${key}@sha256:([a-f0-9]{64})$`).exec(slot.image);
    if(!match)throw Error('NATIVE_SLOT_INVALID');
    const release=verifyNativeStoredRelease(this.config.product,this.component(key).read(`release-${match[1]}.json`));
    if(release.manifest.packageKey!==key||release.version!==slot.version||release.artifact.manifestSha256!==match[1])throw Error('NATIVE_SLOT_INVALID');
    return release;
  }
  slot(release:NativeStoredRelease):VersionSlot{return {version:release.version,image:`native/${release.manifest.packageKey}@sha256:${release.artifact.manifestSha256}`}}
  path(key:string,slot:VersionSlot){const r=this.release(key,slot);const path=join(this.directory(key),'releases',r.artifact.manifestSha256);noLinks(path);return path}
  installed(){return this.keys().flatMap(packageKey=>{const active=this.active(packageKey);if(!active)return [];this.release(packageKey,active.current);return [{packageKey,version:active.current.version}]})}
  tasks(){return this.keys().flatMap(key=>(this.component(key).read<UpdateTask[]>('tasks.json')??[]).map(t=>({...t,packageKey:key}))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))}
  async verifyCurrent(key:string){
    const active=this.active(key);if(!active||active.schema!=='zjz-xcx-active-v1'||active.health!=='passed')throw Error('NATIVE_INSTALLATION_REQUIRED');
    const path=this.path(key,active.current),pointer=new StateStore(this.directory(key)).read<VersionSlot>('current.json');
    if(pointer?.image!==active.current.image||pointer?.version!==active.current.version)throw Error('ACTIVE_POINTER_MISMATCH');
    await verifyNativeTree(path,nativeArchiveFromCatalog(this.release(key,active.current).manifest));return active;
  }
  async switchTo(key:string,slot:VersionSlot,taskId:string){
    await verifyNativeTree(this.path(key,slot),nativeArchiveFromCatalog(this.release(key,slot).manifest));
    new StateStore(this.directory(key)).write('current.json',slot);
  }
  // Initial installation calls this only after its own authorized migrations and runtime health check.
  // Source development deliberately has no automatic receipt bootstrap.
  async registerHealthyInstallation(release:NativeStoredRelease,taskId:string,health:()=>Promise<void>){
    release=verifyNativeStoredRelease(this.config.product,release);const key=release.manifest.packageKey;
    if(this.active(key))throw Error('ALREADY_INSTALLED');
    const store=this.component(key),slot=this.slot(release);
    store.write(`release-${release.artifact.manifestSha256}.json`,release);
    await verifyNativeTree(this.path(key,slot),nativeArchiveFromCatalog(release.manifest));
    await health();
    await this.switchTo(key,slot,taskId);
    store.write('managed.json',[slot]);
    store.write('active.json',{schema:'zjz-xcx-active-v1',current:slot,previous:null,health:'passed',taskId,committedAt:new Date().toISOString(),recoveryReferences:[]} satisfies ActiveReceipt);
  }
}
