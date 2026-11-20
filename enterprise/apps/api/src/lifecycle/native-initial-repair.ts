import {existsSync,readFileSync,renameSync,statSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJson} from '../license/contracts.js';
import {LicenseClient,normalizeDomain} from '../license/client.js';
import {StateStore} from '../license/store.js';
import {verifyNativeInitialRelease,type NativeInitialRelease} from '../license/native-updates.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {NativeState,nativeConfigSchema} from './native-state.js';
import {NativeHost} from './native-host.js';
import {NativeEffects} from './native-effects.js';
import {UpdateEngine,type UpdateTarget,type VersionSlot} from './update-engine.js';
import {extractNativeArchive,noLinks,syncDirectory,verifyNativeTree} from './native-files.js';

// The runtime user owns durable license files; a root maintenance process renews only in memory.
export class RepairLicenseStore extends StateStore {
 private renewed:unknown;
 override read<T>(name:string):T|null{return name==='receipt.json'&&this.renewed!==undefined?this.renewed as T:super.read<T>(name)}
 override write(name:string,value:unknown){if(name!=='receipt.json')throw Error('REPAIR_LICENSE_STORE_READ_ONLY');this.renewed=value}
}

// Operator-only repair of an initial framework; online update plans remain version-increasing.
// The normal update engine still owns backup, atomic activation, rollback, health and cleanup.
export class NativeInitialRepairEffects extends NativeEffects {
 private repairRelease:NativeInitialRelease;
 constructor(state:NativeState,host:NativeHost,client:LicenseClient,taskId:string,readonly archive:string,release:unknown,readonly expectedCurrentManifest:string){
  super(state,host,client,state.config.frameworkKey,taskId);
  this.repairRelease=verifyNativeInitialRelease(state.config.product,release);
  if(!isAbsolute(archive)||!/^[a-f0-9]{64}$/.test(expectedCurrentManifest))throw Error('INITIAL_REPAIR_INPUT_INVALID');
  noLinks(archive);
 }
 private async verifyRepair(){
  const active=await this.state.verifyCurrent(this.key),before=this.state.release(this.key,active.current),after=this.repairRelease;
  const license=this.client.componentStatus(this.key,'framework');
  if(license.state!=='active'||!license.updatesEligible)throw Error('INITIAL_REPAIR_AUTHORIZATION_REQUIRED');
  if(this.state.installed().length!==1||before.artifact.fromVersion!=='0.0.0'||after.version!==before.version
    ||before.artifact.manifestSha256!==this.expectedCurrentManifest||after.artifact.manifestSha256===this.expectedCurrentManifest
    ||before.migrations.length||after.migrations.length)throw Error('INITIAL_REPAIR_SCOPE_INVALID');
  const schema=(release:typeof before)=>release.manifest.files.filter(file=>file.path.startsWith('apps/api/prisma/')).sort((a,b)=>a.path.localeCompare(b.path));
  if(!schema(before).some(file=>file.path==='apps/api/prisma/schema.prisma')||canonicalJson(schema(before))!==canonicalJson(schema(after)))throw Error('INITIAL_REPAIR_DATABASE_CHANGED');
  if(canonicalJson(before.manifest.runtime)!==canonicalJson(after.manifest.runtime)||before.manifest.entrypoint!==after.manifest.entrypoint)throw Error('INITIAL_REPAIR_RUNTIME_CHANGED');
  const runtime=this.runtime();if(runtime.platform!==after.manifest.runtime.platform||runtime.arch!==after.manifest.runtime.arch||Number(runtime.node.split('.')[0])!==after.manifest.runtime.major)throw Error('INITIAL_REPAIR_RUNTIME_UNSUPPORTED');
  return active;
 }
 override async authorize(){
  const active=await this.verifyRepair(),release=this.repairRelease;
  this.store.write(`release-${release.artifact.manifestSha256}.json`,release);
  return{from:active.current,to:this.state.slot(release),planId:'issuer-repair-'+release.artifact.manifestSha256,rollbackCompatible:true,migrations:[],releaseNotes:release.releaseNotes};
 }
 override async pull(target:VersionSlot){
  const candidate=join(this.state.directory(this.key),'candidate-'+this.taskId),path=this.state.path(this.key,target);
  if(existsSync(candidate)||existsSync(path))throw Error('RELEASE_SLOT_EXISTS');
  if(statSync(this.state.directory(this.key)).dev!==statSync(this.store.root).dev)throw Error('NATIVE_FILESYSTEM_MISMATCH');
  await extractNativeArchive(this.archive,candidate,this.repairRelease);
  this.store.write('managed.json',[...(this.store.read<VersionSlot[]>('managed.json')??[]),target]);
  renameSync(candidate,path);syncDirectory(join(this.state.directory(this.key),'releases'));
 }
 override async compatibility(target:UpdateTarget){
  await this.verifyRepair();await verifyNativeTree(this.state.path(this.key,target.to),nativeArchiveFromCatalog(this.repairRelease.manifest));
 }
 override async migrate(_target:UpdateTarget){/* The complete Prisma tree must be byte-identical; this operation never runs migrations. */}
}

async function main(){
 if(process.platform!=='linux'||process.env.UPDATER_FLOCK!=='1'||!process.argv[2]||!process.argv[3])throw Error('UPDATER_LOCK_REQUIRED');
 const configPath=resolve(process.argv[2]),requestPath=resolve(process.argv[3]);
 for(const path of [configPath,requestPath]){noLinks(path);if(!statSync(path).isFile()||(statSync(path).mode&0o077)!==0)throw Error('PRIVATE_REPAIR_INPUT_REQUIRED')}
 const config=nativeConfigSchema.parse(JSON.parse(readFileSync(configPath,'utf8'))),request=JSON.parse(readFileSync(requestPath,'utf8'));
 if(!/^[A-Za-z0-9_-]{16,64}$/.test(request.requestId)||!request.domain)throw Error('INITIAL_REPAIR_INPUT_INVALID');
 const state=new NativeState(config),host=new NativeHost(state),client=new LicenseClient(new RepairLicenseStore(config.licenseStateRoot),config.product,normalizeDomain(request.domain),fetch,true);
 // A new signed license receipt is required immediately before an operator repair.
 await client.renew();
 const effects=new NativeInitialRepairEffects(state,host,client,request.requestId,request.archive,request.release,request.expectedCurrentManifest);
 const engine=new UpdateEngine(state.component(config.frameworkKey),effects,true);
 try{const result=await engine.execute(request.requestId,{packageKey:config.frameworkKey,targetVersion:request.release.version,manifestSha256:request.release.artifact.manifestSha256});console.log(JSON.stringify(result));if(result.status!=='succeeded')process.exitCode=1}finally{await host.stop()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INITIAL_REPAIR_FAILED');process.exitCode=1});
