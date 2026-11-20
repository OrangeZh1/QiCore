// Explicit server-operator entry point for signed internal acceptance packages; no HTTP route or License publication.
import {readFileSync,existsSync,renameSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {LicenseClient} from '../license/client.js';
import {StateStore} from '../license/store.js';
import {verifyNativeLocalRelease,type NativeLocalRelease} from '../license/native-updates.js';
import {NativeState,nativeConfigSchema} from './native-state.js';
import {NativeEffects} from './native-effects.js';
import {NativeHost} from './native-host.js';
import {UpdateEngine,type UpdateTarget,type VersionSlot} from './update-engine.js';
import {extractNativeArchive,noLinks,syncDirectory,fileHash} from './native-files.js';
import {createMaintenanceServer} from './maintenance-server.js';
import {canonicalJson} from '../license/contracts.js';

export function localUpdateReplay(state:Pick<NativeState,'tasks'>,id:string,request:{packageKey:string;targetVersion:string;manifestSha256:string}){
 const old=state.tasks().find(task=>task.id===id);
 if(old&&(old.packageKey!==request.packageKey||canonicalJson(old.request??null)!==canonicalJson(request)))throw Error('REQUEST_ID_REUSED');
 return old;
}

export class NativeLocalEffects extends NativeEffects {
 private installed='';
 readonly localRelease:NativeLocalRelease;
 constructor(state:NativeState,host:NativeHost,client:LicenseClient,key:string,id:string,release:unknown,readonly archive:string){
  super(state,host,client,key,id);this.localRelease=verifyNativeLocalRelease(state.config.product,release);
  if(this.localRelease.manifest.packageKey!==key)throw Error('RELEASE_IDENTITY_MISMATCH');
 }
 protected assertGrant(){
  const component=this.client.componentStatus(this.key,this.key===this.state.config.frameworkKey?'framework':'app');
  if(component.state!=='active'||!component.updatesEligible)throw Error('UPDATE_NOT_ELIGIBLE');
 }
 async authorize(){
  this.assertGrant();const active=await this.state.verifyCurrent(this.key),release=this.localRelease;
  if(active.current.version!==release.artifact.fromVersion)throw Error('LOCAL_UPDATE_BASE_CHANGED');
  noLinks(this.archive);const info=statSync(this.archive);
  if(!info.isFile()||info.nlink!==1||String(info.size)!==release.artifact.size||await fileHash(this.archive)!==release.artifact.sha256)throw Error('LOCAL_ARCHIVE_CHANGED');
  this.installed=JSON.stringify(this.state.installed());this.store.write(`release-${release.artifact.manifestSha256}.json`,release);
  return{from:active.current,to:this.state.slot(release),planId:'local-'+this.taskId,rollbackCompatible:true,migrations:release.migrations.map(m=>({id:m.id,sha256:m.sha256,reversible:m.reversible})),releaseNotes:release.releaseNotes};
 }
 async pull(target:VersionSlot){
  this.assertGrant();if(target.image!==this.state.slot(this.localRelease).image)throw Error('RELEASE_IDENTITY_MISMATCH');
  const candidate=join(this.state.directory(this.key),'candidate-'+this.taskId),destination=this.state.path(this.key,target);
  if(existsSync(destination))throw Error('RELEASE_SLOT_EXISTS');
  await extractNativeArchive(this.archive,candidate,this.localRelease);
  this.store.write('managed.json',[...(this.store.read<VersionSlot[]>('managed.json')??[]),target]);
  renameSync(candidate,destination);syncDirectory(dirname(destination));syncDirectory(this.state.directory(this.key));
 }
 async compatibility(target:UpdateTarget){
  this.assertGrant();if(this.installed!==JSON.stringify(this.state.installed()))throw Error('INSTALLED_COMPONENTS_CHANGED');
  await this.validateCandidate(target);
 }
}

async function main(){
 throw Error('STANDALONE_WHOLE_PRODUCT_UPDATER_REQUIRED');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_UPDATE_FAILED');process.exitCode=1});
