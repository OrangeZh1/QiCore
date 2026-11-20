import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {StateStore} from '../license/store.js';
import {canonicalJson} from '../license/contracts.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {Installation,type InstallationAttempt} from './installation.js';
import {noLinks,verifyNativeTree} from './native-files.js';
import {assertRuntimeCodeAccess} from './native-runtime-access.js';
import type {NativeState} from './native-state.js';
import type {NativeHost} from './native-host.js';
import type {LicenseClient} from '../license/client.js';

// Trusted controller boundary under its OS flock. Callers authenticate the operator; browser configuration is never accepted here.
export async function resumeNativeInstallationHealth(state:NativeState,client:LicenseClient,host:NativeHost,id:string){
 const {config}=state,key=config.frameworkKey,store=state.component(key),attempt=store.read<InstallationAttempt>('installation.json');
 if(!attempt||attempt.id!==id||attempt.status!=='recovery_required'||attempt.phase!=='health')throw Error('INSTALL_HEALTH_RECOVERY_NOT_ALLOWED');
 const slot=attempt.context.target,release=state.release(key,slot),identity=client.identity();
 const rejected=async()=>{throw Error('INSTALL_RECOVERY_ONLY')};
 const authorize=async()=>{if(client.status().state!=='active'||!client.componentStatus(key,'framework').updatesEligible)throw Error('INSTALL_AUTHORIZATION_REQUIRED')};
 return new Installation(store,{
  async preflight(){
   assertRuntimeCodeAccess(config);
   if(!identity||identity.instanceId!==attempt.context.instanceId||attempt.context.productId!==key||attempt.context.domain!==client.domain||client.product.appKey!==key||client.store.root!==config.licenseStateRoot)throw Error('INSTALL_LICENSE_IDENTITY_MISMATCH');
   if(state.tasks().some(task=>['running','recovery_required'].includes(task.status))||state.installed().some(component=>component.packageKey!==key))throw Error('INSTALL_RECOVERY_CONFLICT');
   const pointer=new StateStore(state.directory(key)).read('current.json');
   if(canonicalJson(pointer)!==canonicalJson(slot))throw Error('ACTIVE_POINTER_MISMATCH');
   noLinks(config.environmentFile);const info=lstatSync(config.environmentFile);
   if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0)throw Error('PRIVATE_INSTALL_CONFIG_REQUIRED');
   const env=parseEnv(readFileSync(config.environmentFile,'utf8'));
   if(env.DATABASE_URL!==config.migrationUrl||env.LICENSE_DOMAIN!==client.domain||env.LICENSE_STATE_PATH!==config.licenseStateRoot)throw Error('INSTALL_CONFIG_CHANGED');
   await verifyNativeTree(state.path(key,slot),nativeArchiveFromCatalog(release.manifest));
  },authorize,database:rejected,migrate:rejected,configure:rejected,
  async start(){await host.start(state.active(key)?undefined:{key,slot})},
  async health(){await authorize();await host.health(key,slot.version,release.artifact.manifestSha256)},
  async finalize(){await state.verifyCurrent(key);if(readdirSync(state.directory(key)).some(name=>!['current.json','releases'].includes(name)))throw Error('UNEXPLAINED_RELEASE_DIRECTORY')},
 }).resumeHealth(id);
}
