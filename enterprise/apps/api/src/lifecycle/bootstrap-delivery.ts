import {createHash} from 'node:crypto';
import {accessSync,constants,existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,chownSync,chmodSync,createReadStream} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {z} from 'zod';
import {StateStore} from '../license/store.js';
import {validateProduct,type Product} from '../license/client.js';
import {verifyNativeStoredRelease} from '../license/native-updates.js';
import {canonicalJson} from '../license/contracts.js';
import {noLinks} from './native-files.js';
import {bootstrapConfigSchema,type BootstrapConfig} from './bootstrap-config.js';
import {deploymentOriginSchema,readDeployment,resolveBootstrapDeployment,type Deployment} from './bootstrap-deployment.js';
import {PrismaClient} from '@prisma/client';
import {assertInitialDatabase} from './native-installation.js';
import {reconcileInitialInstall} from './initial-install-repair.js';
import {installationDatabaseError} from './install-server.js';
import {isDeepStrictEqual} from 'node:util';

const contains=(root:string,path:string)=>{const p=relative(resolve(root),resolve(path));return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)};
const outside=(root:string,path:string)=>!contains(root,path);
const absolute=z.string().refine(isAbsolute,'Absolute directory required');
export const bootstrapDeliverySchema=z.object({
 format:z.literal('qicore-bootstrap-delivery-v1'),product:z.custom<Product>(),
 adminOrigin:deploymentOriginSchema.optional(),
 archive:z.string().regex(/^qicore-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-linux-(x64|arm64)\.zip$/),
 runtimeUser:z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).default('www'),
 privateRoot:absolute.default('/var/lib/qicore'),backupRoot:absolute.default('/var/backups/qicore'),
 adminPort:z.number().int().min(1024).max(65535).default(3500),apiPort:z.number().int().min(1024).max(65535).default(3501),
 uiPort:z.number().int().min(1024).max(65535).optional(),maintenancePort:z.number().int().min(1024).max(65535).optional(),
}).strict().refine(v=>{const ports=[v.adminPort,v.apiPort,v.uiPort,v.maintenancePort].filter(value=>value!==undefined);return new Set(ports).size===ports.length},'Ports must differ');
export type BootstrapDelivery=z.infer<typeof bootstrapDeliverySchema>;

export function runtimeIdentity(user:string,passwd=readFileSync('/etc/passwd','utf8')){
 const row=passwd.split('\n').map(line=>line.split(':')).find(parts=>parts[0]===user);
 const uid=Number(row?.[2]),gid=Number(row?.[3]);
 if(!row||!Number.isSafeInteger(uid)||!Number.isSafeInteger(gid)||uid<=0||gid<=0)throw Error('BOOTSTRAP_RUNTIME_USER_REQUIRED');
 return {uid,gid};
}

export function initialBootstrapConfig(delivery:BootstrapDelivery,bootstrapRoot:string,configPath:string,identity:{uid:number;gid:number},mysqldump='/usr/bin/mysqldump',deployment?:Deployment):BootstrapConfig{
 validateProduct(delivery.product);
 if(delivery.product.product!=='qicore'||delivery.product.componentType!=='framework'||delivery.product.deliveryKind!=='archive')throw Error('BOOTSTRAP_PRODUCT_INVALID');
 const settings=deployment??readDeployment(bootstrapRoot,{adminOrigin:delivery.adminOrigin,adminPort:delivery.adminPort,apiPort:delivery.apiPort,uiPort:delivery.uiPort??(delivery.maintenancePort===3502?3503:3502),maintenancePort:delivery.maintenancePort});
 const bundle=dirname(resolve(bootstrapRoot)),privateRoot=resolve(delivery.privateRoot);
 if(!outside(bootstrapRoot,configPath)||!outside(bootstrapRoot,privateRoot)||!outside(bootstrapRoot,delivery.backupRoot))throw Error('BOOTSTRAP_LAYOUT_INVALID');
 const roots=[bootstrapRoot,join(bundle,'code'),join(bundle,'incoming'),privateRoot,delivery.backupRoot,dirname(configPath)].map(path=>resolve(path));
 if(roots.some((path,i)=>roots.some((other,j)=>i!==j&&contains(path,other))))throw Error('BOOTSTRAP_LAYOUT_INVALID');
 const native={...(settings.maintenancePort!==undefined?{maintenancePort:settings.maintenancePort}:{}),root:join(bundle,'code'),stateRoot:join(privateRoot,'components'),dataRoot:join(privateRoot,'data'),socket:join(privateRoot,'run/updater.sock'),installationSocket:join(privateRoot,'run/install.sock'),frameworkKey:delivery.product.appKey,healthUrl:`http://127.0.0.1:${settings.apiPort}/health`,loginUrl:`http://127.0.0.1:${settings.uiPort}/admin/login`,runtimeUid:identity.uid,runtimeGid:identity.gid,environmentFile:join(dirname(configPath),'runtime.env'),licenseStateRoot:join(privateRoot,'license'),product:delivery.product,backupRoot:resolve(delivery.backupRoot),backupKeyRoot:join(privateRoot,'backup-keys'),mysqldump};
 return bootstrapConfigSchema.parse({native,publicPort:settings.adminPort,...(settings.challengeRoot?{challengeRoot:settings.challengeRoot}:{}),controlRoot:join(privateRoot,'installer'),nativeConfigFile:join(dirname(configPath),'native.json'),archive:join(bundle,'incoming',delivery.archive),releaseFile:join(bundle,'incoming/release.json'),adminOrigin:settings.adminOrigin,redisUrl:'redis://127.0.0.1:6379/0'});
}

export async function verifyBootstrapDelivery(bootstrapRoot:string,configPath:string,identity:{uid:number;gid:number}){
 const deliveryPath=join(bootstrapRoot,'delivery.json');noLinks(deliveryPath);
 const delivery=bootstrapDeliverySchema.parse(JSON.parse(readFileSync(deliveryPath,'utf8')));
 const deployment=await resolveBootstrapDeployment(bootstrapRoot,undefined,{adminOrigin:delivery.adminOrigin,adminPort:delivery.adminPort,apiPort:delivery.apiPort,uiPort:delivery.uiPort,maintenancePort:delivery.maintenancePort});
 const mysqldump=['/www/server/mysql/bin/mysqldump','/usr/bin/mysqldump'].find(path=>{try{accessSync(path,constants.X_OK);return true}catch{return false}})||'/usr/bin/mysqldump';
 const config=initialBootstrapConfig(delivery,bootstrapRoot,configPath,identity,mysqldump,deployment??undefined);
 noLinks(config.releaseFile);noLinks(config.archive);
 const release=verifyNativeStoredRelease(config.native.product,JSON.parse(readFileSync(config.releaseFile,'utf8')));
 if(release.artifact.fromVersion!=='0.0.0'||release.manifest.packageKey!==config.native.frameworkKey||release.version!==delivery.product.version||release.migrations.length)throw Error('INITIAL_RELEASE_REQUIRED');
 if(!existsSync(config.archive))throw Error('INSTALL_ARCHIVE_MISSING');
 if(!lstatSync(config.archive).isFile()||String(lstatSync(config.archive).size)!==release.artifact.size)throw Error('BOOTSTRAP_ARCHIVE_INVALID');
 const hash=createHash('sha256');for await(const chunk of createReadStream(config.archive))hash.update(chunk);
 if(hash.digest('hex')!==release.artifact.sha256)throw Error('BOOTSTRAP_ARCHIVE_INVALID');
 return {config,delivery,release};
}

export async function prepareBootstrapConfig(bootstrapRoot:string,configPath:string){
 if(process.platform!=='linux')throw Error('LINUX_NODE24_REQUIRED');
 const deliveryPath=join(bootstrapRoot,'delivery.json');noLinks(deliveryPath);
 const delivery=bootstrapDeliverySchema.parse(JSON.parse(readFileSync(deliveryPath,'utf8'))),identity=runtimeIdentity(delivery.runtimeUser),uid=process.getuid!();
 if(uid!==0&&uid!==identity.uid)throw Error('BOOTSTRAP_RUNTIME_USER_REQUIRED');
 const result=await verifyBootstrapDelivery(bootstrapRoot,configPath,identity);
 if(result.release.manifest.runtime.arch!==process.arch||process.versions.node.split('.')[0]!=='24')throw Error('NATIVE_RUNTIME_INCOMPATIBLE');
 return result;
}

// After deployment-journal recovery, reconcile only an empty preinstallation with the verified delivery.
export async function synchronizeInitialDelivery(bootstrapRoot:string,configPath:string){
 noLinks(configPath);
  if(!lstatSync(configPath).isFile()||(lstatSync(configPath).mode&0o077)!==0)throw Error('PRIVATE_INSTALL_CONFIG_REQUIRED');
  const existing=bootstrapConfigSchema.parse(JSON.parse(readFileSync(configPath,'utf8'))),component=join(existing.native.stateRoot,existing.native.frameworkKey);
  // Installed and interrupted installations keep their original source, identity and recovery references.
  if(!existsSync(join(bootstrapRoot,'delivery.json'))||existsSync(existing.native.environmentFile)||['installation.json','active.json','installed-receipt.json'].some(name=>existsSync(join(component,name))))return;
  const delivery=bootstrapDeliverySchema.parse(JSON.parse(readFileSync(join(bootstrapRoot,'delivery.json'),'utf8'))),journal=join(dirname(configPath),'initial-source-repair.json');noLinks(journal);noLinks(existing.nativeConfigFile);
  const pending=existsSync(journal)&&JSON.parse(readFileSync(journal,'utf8')).status==='pending';
  const saved=existsSync(existing.nativeConfigFile)?JSON.parse(readFileSync(existing.nativeConfigFile,'utf8')):null;
  // A normal retry must still be able to open the UI and edit stale database credentials.
  if(!pending&&existsSync(existing.native.root)&&existing.archive===join(dirname(bootstrapRoot),'incoming',delivery.archive)&&existing.releaseFile===join(dirname(bootstrapRoot),'incoming/release.json')&&isDeepStrictEqual(existing.native.product,delivery.product)&&(!saved||saved.product?.version===delivery.product.version))return;
  const {config}=await prepareBootstrapConfig(bootstrapRoot,configPath);
  try{await reconcileInitialInstall(configPath,config,async url=>{
   const db=new PrismaClient({datasources:{db:{url:url+(url.includes('?')?'&':'?')+'connect_timeout=5&pool_timeout=5'}}});
   let failed=false;try{await db.$connect();await assertInitialDatabase(db)}catch(error){failed=true;throw Error(installationDatabaseError(error))}finally{try{await db.$disconnect()}catch(error){if(!failed)throw Error(installationDatabaseError(error))}}
  })}catch(error){if(!(error instanceof Error)||error.message!=='INSTALL_REPAIR_RECOVERY_REQUIRED')throw error;}
}

// Invoked only by the controller while its normal flock is held. It creates a
// private host configuration, never an installation receipt or a database.
export async function initializeBootstrapConfig(bootstrapRoot:string,configPath:string){
 noLinks(configPath);
 if(existsSync(configPath))return {created:false};
 const {config,delivery,release}=await prepareBootstrapConfig(bootstrapRoot,configPath),identity={uid:config.native.runtimeUid,gid:config.native.runtimeGid},uid=process.getuid!();
 const empty=[config.native.root,config.native.stateRoot,config.native.dataRoot,config.native.licenseStateRoot,config.native.backupRoot,config.native.backupKeyRoot,dirname(config.native.socket)];
 for(const path of [...empty,dirname(configPath),config.controlRoot])noLinks(path);
 if(empty.some(path=>existsSync(path)&&(!lstatSync(path).isDirectory()||readdirSync(path).length))||[config.nativeConfigFile,config.native.environmentFile].some(existsSync))throw Error('BOOTSTRAP_RECOVERY_REQUIRED');
 if(existsSync(config.controlRoot)&&readdirSync(config.controlRoot).some(name=>!['controller.lock','bootstrap-init.json'].includes(name)))throw Error('BOOTSTRAP_RECOVERY_REQUIRED');
 const fingerprint=createHash('sha256').update(canonicalJson({config,archiveSha256:release.artifact.sha256})).digest('hex');
 const ensure=(path:string,mode:number,owner=uid,group=process.getgid!())=>{
  noLinks(path);if(existsSync(path)){if(!lstatSync(path).isDirectory())throw Error('BOOTSTRAP_LAYOUT_INVALID');accessSync(path,constants.W_OK|constants.X_OK);return}
  mkdirSync(path,{recursive:true,mode});chmodSync(path,mode);if(uid===0)chownSync(path,owner,group);
 };
 ensure(delivery.privateRoot,0o750,uid,identity.gid);ensure(config.controlRoot,0o700);
 const store=new StateStore(config.controlRoot),old=store.read<{schema:string;fingerprint:string;status:string}>('bootstrap-init.json');
 if(old&&(old.schema!=='qicore-bootstrap-init-v1'||old.fingerprint!==fingerprint||old.status==='complete'))throw Error('BOOTSTRAP_RECOVERY_REQUIRED');
 store.write('bootstrap-init.json',{schema:'qicore-bootstrap-init-v1',fingerprint,status:'preparing',configPath});
 ensure(config.native.root,0o755,uid,identity.gid);ensure(config.native.stateRoot,0o700);
 // BaoTa may reset ownership to the controller user on every start. Immutable code needs runtime traversal independent of its group.
 chmodSync(config.native.root,0o755);
 for(const path of [config.native.dataRoot,config.native.licenseStateRoot,config.native.backupRoot,config.native.backupKeyRoot])ensure(path,0o700,identity.uid,identity.gid);
 ensure(dirname(config.native.socket),0o750,uid,identity.gid);ensure(dirname(configPath),0o700);
 if(existsSync(configPath))throw Error('BOOTSTRAP_CONFIG_CHANGED');
 new StateStore(dirname(configPath)).write(basename(configPath),config);
 store.write('bootstrap-init.json',{schema:'qicore-bootstrap-init-v1',fingerprint,status:'complete',configPath});
 return {created:true};
}
