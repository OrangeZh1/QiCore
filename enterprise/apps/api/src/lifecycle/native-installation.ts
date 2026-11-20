import {createHmac,createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,renameSync,chmodSync,chownSync,lstatSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {parseEnv} from 'node:util';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {z} from 'zod';
import {PrismaClient} from '@prisma/client';
import Redis from 'ioredis';
import {LicenseClient} from '../license/client.js';
import {canonicalJson} from '../license/contracts.js';
import {nativeArchiveFromCatalog} from '../license/native-release.js';
import {verifyNativeStoredRelease,assertNativeCompatibility} from '../license/native-updates.js';
import {provisionEnterprise} from '../core/standalone-edition.mjs';
import {passwordHash,foundationTenantPermissions as tenantPermissions} from '../core/admin-identity.mjs';
import {NativeState} from './native-state.js';
import {NativeHost} from './native-host.js';
import {Installation} from './installation.js';
import {assertRuntimeCodeAccess} from './native-runtime-access.js';
import {extractNativeArchive,noLinks,syncDirectory,verifyNativeTree} from './native-files.js';
import {BackupArchive} from '../backups/archive.mjs';

// Only the privileged, empty-target installation phase may provision a key.
// A missing key in any previously initialized backup store is a recovery error.
export function initializeNativeBackups(config:NativeState['config']){
 for(const path of [config.backupRoot,config.backupKeyRoot])noLinks(path);
 const key=join(config.backupKeyRoot,'backup.key');
 if(!existsSync(key)&&[config.backupRoot,config.backupKeyRoot].some(path=>existsSync(path)&&readdirSync(path).length))throw Error('BACKUP_KEY_MISSING');
 const backups=new BackupArchive({root:config.backupRoot,keyRoot:config.backupKeyRoot,binary:config.mysqldump,owner:process.getuid?.()===0?{uid:config.runtimeUid,gid:config.runtimeGid}:null});
 backups.init();
 const file='key-initialization.json',keyId=createHash('sha256').update(backups.key()).digest('hex').slice(0,16),prior=backups.store!.read<{keyId:string}>(file);
 if(prior&&prior.keyId!==keyId)throw Error('BACKUP_KEY_INVALID');
 if(!prior){backups.store!.write(file,{schema:'qicore-backup-key-v1',keyId,initializedAt:new Date().toISOString()});backups.protect(backups.store!.path(file));}
 return backups;
}

export const initialInstallInputSchema=z.object({requestId:z.string().uuid(),archive:z.string(),release:z.unknown(),
 administrator:z.object({username:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/),password:z.string().min(6).max(128),nickname:z.string().trim().min(1).max(40).default('总管理员')}).strict(),
 redisUrl:z.string().url(),adminOrigin:z.string().url(),acceptTerms:z.literal(true),
}).strict();

export async function assertInitialDatabase(db:PrismaClient){
 const version=await db.$queryRawUnsafe<any[]>('SELECT VERSION() AS version');
 if(!/^8\./.test(String(version[0]?.version))||/mariadb/i.test(String(version[0]?.version)))throw Error('INSTALL_DATABASE_VERSION');
 const rows=await db.$queryRawUnsafe<any[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
 if(rows.length)throw Error('INSTALL_DATABASE_NOT_EMPTY');
}

// Local privileged installer boundary. No caller-supplied success, runtime entry or database SQL is accepted.
export async function installNative(state:NativeState,client:LicenseClient,host:NativeHost,raw:unknown){
 const input=initialInstallInputSchema.parse(raw),config=state.config,release=verifyNativeStoredRelease(config.product,input.release),key=config.frameworkKey;
 if(release.manifest.packageKey!==key||release.manifest.type!=='framework'||release.artifact.fromVersion!=='0.0.0'||release.migrations.length)throw Error('INITIAL_RELEASE_REQUIRED');
 assertNativeCompatibility([],nativeArchiveFromCatalog(release.manifest));
 const identity=client.identity();if(!identity||client.product.appKey!==key||client.store.root!==config.licenseStateRoot)throw Error('INSTALL_LICENSE_IDENTITY_MISMATCH');
 const origin=new URL(input.adminOrigin),redisUrl=new URL(input.redisUrl),api=new URL(config.healthUrl),admin=new URL(config.loginUrl);
 if(!['http:','https:'].includes(origin.protocol)||origin.origin!==input.adminOrigin||origin.username||origin.password||origin.hostname!==client.domain
  ||!['redis:','rediss:'].includes(redisUrl.protocol)||api.port===admin.port)throw Error('INSTALL_ENDPOINT_INVALID');
 const directories=[config.root,config.stateRoot,config.dataRoot,config.licenseStateRoot,config.backupRoot,config.backupKeyRoot];
 const contains=(parent:string,child:string)=>{const path=relative(resolve(parent),resolve(child));return !path||path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path)};
 if(directories.some((path,i)=>directories.some((other,j)=>i!==j&&contains(path,other))))throw Error('INSTALL_DIRECTORIES_OVERLAP');
 const slot=state.slot(release),store=state.component(key),archive=resolve(input.archive),candidate=join(state.directory(key),'candidate-'+input.requestId);
 const requestHash=createHmac('sha256',identity.privateKey).update(canonicalJson({...input,release,config})).digest('hex');
 const db=new PrismaClient({datasources:{db:{url:config.migrationUrl}}});
 const emptyDatabase=()=>assertInitialDatabase(db);
 const privateDirectory=(path:string)=>{noLinks(path);mkdirSync(path,{recursive:true,mode:0o700});if(process.getuid?.()===0)chownSync(path,config.runtimeUid,config.runtimeGid)};
 const authorize=async()=>{const status=client.status(),component=client.componentStatus(key,'framework');if(status.state!=='active'||component.state!=='active'||!component.updatesEligible)throw Error('INSTALL_AUTHORIZATION_REQUIRED')};
 const engine=new Installation(store,{
  async preflight(){
   if(process.platform!=='linux')throw Error('NATIVE_RUNTIME_INCOMPATIBLE');
   assertRuntimeCodeAccess(config);
   noLinks(archive);if(!existsSync(archive))throw Error('INSTALL_ARCHIVE_MISSING');if(!lstatSync(archive).isFile())throw Error('INSTALL_ARCHIVE_INVALID');
   if(state.installed().length||existsSync(config.environmentFile)||[config.root,config.dataRoot,config.backupRoot,config.backupKeyRoot].some(path=>existsSync(path)&&readdirSync(path).length))throw Error('INSTALL_TARGET_NOT_EMPTY');
   const dump=spawnSync(config.mysqldump,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true,shell:false});
   if(dump.status!==0||!/mysqldump|mariadb-dump/i.test(dump.stdout||''))throw Error('BACKUP_TOOL_UNAVAILABLE');
   // The runtime owns its previously activated identity; installation never relaxes existing private-key permissions.
   if(lstatSync(config.licenseStateRoot).uid!==config.runtimeUid||readdirSync(config.licenseStateRoot).some(name=>{const file=join(config.licenseStateRoot,name);noLinks(file);const info=lstatSync(file);return !info.isFile()||info.nlink!==1||info.uid!==config.runtimeUid}))throw Error('INSTALL_LICENSE_OWNER_REQUIRED');
   await emptyDatabase();
   const redis=new Redis.default(input.redisUrl,{lazyConnect:true,connectTimeout:3000,maxRetriesPerRequest:0});
   redis.on('error',()=>{});try{await redis.connect();await redis.ping()}finally{redis.disconnect()}
  },authorize,
  async database(){
   await authorize();await emptyDatabase();mkdirSync(state.directory(key),{recursive:true,mode:0o755});chmodSync(state.directory(key),0o755);
   await extractNativeArchive(archive,candidate,release);
   store.write('release-'+release.artifact.manifestSha256+'.json',release);
   const target=state.path(key,slot);mkdirSync(dirname(target),{recursive:true,mode:0o755});chmodSync(dirname(target),0o755);renameSync(candidate,target);syncDirectory(dirname(target));
   store.write('managed.json',[slot]);
  },
  async migrate(){
   await authorize();await emptyDatabase();const target=state.path(key,slot);await verifyNativeTree(target,nativeArchiveFromCatalog(release.manifest));
   const engine=join(target,'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x');
   const queryEnginePath='node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node';
   // This signed Linux package ships one known migration executable; ZIP extraction defaults all files to 0644.
   if(!release.manifest.files.some(file=>file.path==='node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x'))throw Error('INITIAL_MIGRATION_ENGINE_REQUIRED');
   if(!release.manifest.files.some(file=>file.path===queryEnginePath))throw Error('INITIAL_QUERY_ENGINE_REQUIRED');
   chmodSync(engine,0o755);
   const cache=mkdtempSync(join(tmpdir(),'qicore-migration-'));
   try{
    // Prisma CLI also checks for a query engine during migrate deploy. Reuse the signed client engine without downloading another copy.
    const result=spawnSync(process.execPath,[join(target,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',join(target,'apps/api/prisma/schema.prisma')],{cwd:target,env:{...process.env,DATABASE_URL:config.migrationUrl,PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_QUERY_ENGINE_LIBRARY:join(target,queryEnginePath),XDG_CACHE_HOME:cache,CACHE_DIR:cache,JITI_FS_CACHE:'0',CHECKPOINT_DISABLE:'1'},timeout:120000,stdio:'pipe'});
    if(result.status!==0)throw Error('INITIAL_MIGRATION_FAILED');
   }finally{if(!resolve(cache).startsWith(resolve(tmpdir())+'/qicore-migration-'))throw Error('INSTALL_CACHE_PATH_INVALID');rmSync(cache,{recursive:true,force:true})}
   await db.$transaction(async tx=>{
    if(await tx.adminAccount.count())throw Error('INSTALL_ADMIN_ALREADY_EXISTS');
    await provisionEnterprise(tx,{username:input.administrator.username.toLowerCase(),nickname:input.administrator.nickname,passwordHash:await passwordHash(input.administrator.password,6),permissions:tenantPermissions,requestId:input.requestId});
   });
  },
  async configure(){
   privateDirectory(config.dataRoot);for(const name of ['admin','files','storage','control'])privateDirectory(join(config.dataRoot,name));
   privateDirectory(config.backupRoot);privateDirectory(config.backupKeyRoot);
   initializeNativeBackups(config);
   noLinks(dirname(config.environmentFile));mkdirSync(dirname(config.environmentFile),{recursive:true,mode:0o700});
   const env={NODE_ENV:'production',DATABASE_URL:config.migrationUrl,REDIS_URL:input.redisUrl,API_HOST:'127.0.0.1',API_PORT:api.port||'80',ADMIN_HOST:'127.0.0.1',ADMIN_PORT:admin.port||'80',ADMIN_ORIGIN:input.adminOrigin,ADMIN_DEMO_LOGIN:'false',UPDATER_SOCKET:config.socket,NUXT_INSTALL_SOCKET:config.installationSocket||'',ADMIN_STATE_PATH:join(config.dataRoot,'admin'),STORAGE_PATH:join(config.dataRoot,'files'),STORAGE_STATE_PATH:join(config.dataRoot,'storage'),CONTROL_STATE_PATH:join(config.dataRoot,'control'),LICENSE_DOMAIN:client.domain,LICENSE_STATE_PATH:config.licenseStateRoot,BACKUP_PATH:config.backupRoot,BACKUP_KEY_PATH:config.backupKeyRoot,BACKUP_MYSQLDUMP_PATH:config.mysqldump,PAYMENT_EXECUTION_ENABLED:'false',QICORE_NATIVE_CONFIG:process.env.QICORE_NATIVE_CONFIG||'/etc/qicore/native.json'};
   // JSON string quoting is accepted by Node parseEnv; newline-bearing values are rejected.
   for(const value of Object.values(env))if(/[\r\n\0]/.test(value))throw Error('INSTALL_ENV_INVALID');
   const content=Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n';
   if(canonicalJson(parseEnv(content))!==canonicalJson(env))throw Error('INSTALL_ENV_INVALID');
   writeFileSync(config.environmentFile,content,{flag:'wx',mode:0o600});
   chmodSync(config.environmentFile,0o600);await state.switchTo(key,slot,input.requestId);
  },
  async start(){await host.start({key,slot})},
  async health(){await authorize();await host.health(key,slot.version,release.artifact.manifestSha256)},
  async finalize(){await state.verifyCurrent(key);if(readdirSync(state.directory(key)).some(name=>!['current.json','releases'].includes(name)))throw Error('UNEXPLAINED_RELEASE_DIRECTORY')},
 });
 try{return await engine.execute(input.requestId,{productId:key,domain:client.domain,instanceId:identity.instanceId,target:slot,requestHash,environment:{runtime:'nodejs',runtimeVersion:process.versions.node,deployment:'native',platform:process.arch==='arm64'?'linux/arm64':'linux/amd64'}})}
 finally{await db.$disconnect()}
}
