import {existsSync,lstatSync,readFileSync,readdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {createServer} from 'node:net';
import {z} from 'zod';
import {canonicalJson} from '../license/contracts.js';
import {normalizeDomain} from '../license/client.js';
import {StateStore} from '../license/store.js';
import {bootstrapConfigSchema,type BootstrapConfig} from './bootstrap-config.js';
import {nativeConfigSchema} from './native-state.js';
import {noLinks,syncDirectory} from './native-files.js';
import {discoverBaoTaDeployment} from './bootstrap-baota.js';

export const deploymentOriginSchema=z.string().url().refine(value=>{
 try{const u=new URL(value);return u.origin===value&&!u.username&&!u.password&&normalizeDomain(u.hostname)===u.hostname
  &&(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))}catch{return false}
});
const port=z.number().int().min(1024).max(65535);
const distinctPorts=(v:{adminPort?:number;apiPort?:number;uiPort?:number;maintenancePort?:number})=>{const values=[v.adminPort,v.apiPort,v.uiPort,v.maintenancePort].filter(value=>value!==undefined);return new Set(values).size===values.length};
export const deploymentSchema=z.object({adminOrigin:deploymentOriginSchema,adminPort:port.default(3500),apiPort:port.default(3501),uiPort:port.default(3502),maintenancePort:port.optional(),challengeRoot:z.string().optional()})
 .strict().refine(distinctPorts,'Ports must differ');
export type Deployment=z.infer<typeof deploymentSchema>;
export const deploymentPath=(bootstrapRoot:string)=>join(dirname(resolve(bootstrapRoot)),'deployment.json');
export const deploymentOverridesSchema=z.object({adminOrigin:deploymentOriginSchema.optional(),adminPort:port.optional(),apiPort:port.optional(),uiPort:port.optional(),maintenancePort:port.optional()}).strict().refine(distinctPorts,'Ports must differ');

function readText(path:string):string|null{
 noLinks(path);
 try{const stat=lstatSync(path);if(!stat.isFile()||stat.nlink!==1)throw Error('DEPLOYMENT_FILE_UNSAFE');return readFileSync(path,'utf8')}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
}
function readJson(path:string){const raw=readText(path);return raw===null?null:JSON.parse(raw)}
function recovering(config:BootstrapConfig){
 const installation=readJson(join(config.native.stateRoot,config.native.frameworkKey,'installation.json')),request=readJson(join(config.controlRoot,'request.json'));
 if([installation?.status,request?.status].some(status=>['running','recovery_required'].includes(status)))return true;
 if(existsSync(config.native.stateRoot))for(const name of readdirSync(config.native.stateRoot)){
  const path=join(config.native.stateRoot,name);noLinks(path);if(!lstatSync(path).isDirectory())continue;
  const tasks=readJson(join(path,'tasks.json'))??[];if(tasks.some((task:{status:string})=>['running','recovery_required'].includes(task.status)))return true;
 }
 return false;
}
export function readDeployment(bootstrapRoot:string,fallback?:unknown):Deployment{
 const raw=readText(deploymentPath(bootstrapRoot));
 const result=deploymentSchema.safeParse(raw===null?fallback:deploymentOverridesSchema.parse(JSON.parse(raw)));
 if(!result.success)throw Error('CUSTOMER_DEPLOYMENT_REQUIRED');
 return result.data;
}
async function availablePort(preferred:number,excluded:Set<number>):Promise<number>{
 const listen=(candidate:number)=>new Promise<number>((ok,fail)=>{
  const server=createServer();server.once('error',fail);server.listen(candidate,'127.0.0.1',()=>{const value=(server.address() as {port:number}).port;server.close(error=>error?fail(error):ok(value))});
 });
 if(excluded.has(preferred))throw Error('DEPLOYMENT_PORT_CONFLICT');
 try{return await listen(preferred)}catch{throw Error('DEPLOYMENT_INTERNAL_PORT_UNAVAILABLE')}
}
export async function resolveBootstrapDeployment(bootstrapRoot:string,existing?:BootstrapConfig,fallback?:unknown,panelRoot?:string):Promise<Deployment|null>{
 const text=readText(deploymentPath(bootstrapRoot));
 const overrides=deploymentOverridesSchema.parse(text===null?{}:JSON.parse(text));
 const panel=await discoverBaoTaDeployment(bootstrapRoot,panelRoot);
 if(!panel&&text===null&&existing)return null;
 const defaults=deploymentOverridesSchema.parse(fallback??{});
 const old=existing?deploymentFromConfig(existing):undefined;
 let adminOrigin=overrides.adminOrigin;
 if(panel){
  if(panel.webRoot!==dirname(resolve(bootstrapRoot)))throw Error('BAOTA_PROJECT_DIRECTORY_REQUIRED');
  if(overrides.adminPort!==undefined&&overrides.adminPort!==panel.adminPort)throw Error('BAOTA_PROJECT_PORT_MISMATCH');
  if(adminOrigin&&!panel.domains.includes(new URL(adminOrigin).hostname))throw Error('BAOTA_PROJECT_DOMAIN_MISMATCH');
  if(!adminOrigin){
   const previous=old&&panel.domains.includes(new URL(old.adminOrigin).hostname)?old.adminOrigin:undefined;
   if(!previous&&panel.domains.length!==1)throw Error('BAOTA_PROJECT_DOMAIN_AMBIGUOUS');
   adminOrigin=previous??'https://'+panel.domains[0];
  }
 }
 if(!adminOrigin)adminOrigin=old?.adminOrigin??defaults.adminOrigin;
 if(!adminOrigin)throw Error('CUSTOMER_DEPLOYMENT_REQUIRED');
 const adminPort=panel?.adminPort??overrides.adminPort??old?.adminPort??defaults.adminPort??3500,used=new Set([adminPort]);
 const maintenancePort=overrides.maintenancePort??old?.maintenancePort??defaults.maintenancePort;
 if(maintenancePort!==undefined){if(used.has(maintenancePort))throw Error('DEPLOYMENT_PORT_CONFLICT');used.add(maintenancePort)}
 // Reuse saved ports; if another process takes one, report the conflict instead of silently moving a live proxy target.
 const apiPort=await availablePort(overrides.apiPort??old?.apiPort??defaults.apiPort??3501,used);used.add(apiPort);
 const uiPort=await availablePort(overrides.uiPort??old?.uiPort??defaults.uiPort??(maintenancePort===3502?3503:3502),used);
 const challengeRoot=panel?.webRoot??existing?.challengeRoot;
 return deploymentSchema.parse({adminOrigin,adminPort,apiPort,uiPort,...(maintenancePort!==undefined?{maintenancePort}:{}),...(challengeRoot?{challengeRoot}:{})});
}
export function deploymentFromConfig(config:BootstrapConfig){
 return {adminOrigin:config.adminOrigin,adminPort:config.publicPort??Number(new URL(config.native.loginUrl).port||80),apiPort:Number(new URL(config.native.healthUrl).port||80),uiPort:config.publicPort?Number(new URL(config.native.loginUrl).port||80):undefined,maintenancePort:config.native.maintenancePort};
}
export function applyDeployment(config:BootstrapConfig,settings:Deployment):BootstrapConfig{
 const native={...config.native,loginUrl:`http://127.0.0.1:${settings.uiPort}/admin/login`,healthUrl:`http://127.0.0.1:${settings.apiPort}/health`};
 if(settings.maintenancePort===undefined)delete native.maintenancePort;else native.maintenancePort=settings.maintenancePort;
 const next={...config,adminOrigin:settings.adminOrigin,publicPort:settings.adminPort,native};
 if(settings.challengeRoot===undefined)delete next.challengeRoot;else next.challengeRoot=settings.challengeRoot;
 return bootstrapConfigSchema.parse(next);
}
function atomicText(path:string,content:string,temporary:string){
 noLinks(path);readText(temporary);const fd=openSync(temporary,'w',0o600);
 try{writeFileSync(fd,content);fsyncSync(fd)}finally{closeSync(fd)}
 renameSync(temporary,path);syncDirectory(dirname(path));
}
const changeSchema=z.object({path:z.string(),before:z.string().nullable(),after:z.string(),temporary:z.string()}).strict();
const pendingSchema=z.object({status:z.literal('pending'),settings:deploymentSchema,changes:z.array(changeSchema)}).strict();

// Called under the controller's OS flock, before any UI, updater or runtime starts.
// The durable journal resumes interrupted file replacements without accepting unrelated edits.
export async function synchronizeDeployment(bootstrapRoot:string,configPath:string,panelRoot?:string){
 configPath=resolve(configPath);
 const original=bootstrapConfigSchema.parse(readJson(configPath));
 if([original.nativeConfigFile,original.native.environmentFile,original.controlRoot].some(path=>!isAbsolute(path)))throw Error('DEPLOYMENT_PATH_UNSAFE');
 const allowed=[configPath,original.nativeConfigFile,original.native.environmentFile,join(original.controlRoot,'access.json')].map(resolvePath=>resolve(resolvePath));
 if(new Set(allowed).size!==allowed.length)throw Error('DEPLOYMENT_PATH_CONFLICT');
 for(const path of allowed){const rel=relative(resolve(bootstrapRoot),path);if(!rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('DEPLOYMENT_PATH_UNSAFE');readText(path)}
 const journalPath=join(dirname(configPath),'deployment-sync.json');readText(journalPath);
 const store=new StateStore(dirname(configPath));
 const finish=(pending:z.infer<typeof pendingSchema>)=>{
  const seen=new Set<string>();
  for(const change of pending.changes){
   if(!allowed.includes(change.path)||seen.has(change.path))throw Error('DEPLOYMENT_JOURNAL_INVALID');seen.add(change.path);
   if(!change.temporary.startsWith(change.path+'.')||!/^\.[a-f0-9-]{36}\.deployment-tmp$/.test(change.temporary.slice(change.path.length)))throw Error('DEPLOYMENT_JOURNAL_INVALID');
   readText(change.temporary);
   const current=readText(change.path);if(current!==change.before&&current!==change.after)throw Error('DEPLOYMENT_SYNC_CONFLICT');
  }
  for(const change of pending.changes)if(readText(change.path)!==change.after)atomicText(change.path,change.after,change.temporary);
  store.write('deployment-sync.json',{status:'complete',settings:pending.settings});
 };
 const pending=store.read<{status:string}>('deployment-sync.json');
 if(pending?.status==='pending')finish(pendingSchema.parse(pending));
 const config=bootstrapConfigSchema.parse(readJson(configPath));
 // Finish an existing recovery on its old listeners before adopting the shared entry.
 if(!config.publicPort&&readText(deploymentPath(bootstrapRoot))===null&&recovering(config)){
  const panel=await discoverBaoTaDeployment(bootstrapRoot,panelRoot);
  if(!panel||panel.adminPort===Number(new URL(config.native.loginUrl).port||80)&&panel.domains.includes(new URL(config.adminOrigin).hostname))return config;
  throw Error('DEPLOYMENT_RECOVERY_PENDING');
 }
 const settings=await resolveBootstrapDeployment(bootstrapRoot,config,undefined,panelRoot);
 if(!settings)return config;
 const next=applyDeployment(config,settings),changed=canonicalJson(next)!==canonicalJson(config);
 const saved=readJson(config.nativeConfigFile),runtime=readText(config.native.environmentFile);
 if(saved){
  const {migrationUrl,...native}=nativeConfigSchema.parse(saved);
  if(canonicalJson(native)!==canonicalJson(config.native))throw Error('INSTALL_CONFIG_CHANGED');
 }
 if(changed){
  const component=join(config.native.stateRoot,config.native.frameworkKey),installation=readJson(join(component,'installation.json'));
  if(recovering(config))throw Error('DEPLOYMENT_RECOVERY_PENDING');
  if(next.adminOrigin!==config.adminOrigin&&(installation||runtime!==null||readJson(join(component,'active.json'))))throw Error('INSTALLED_DOMAIN_CHANGE_REQUIRES_MIGRATION');
 }
 const outputs:Array<[string,string]>=[[configPath,JSON.stringify(next)]];
 if(saved)outputs.push([config.nativeConfigFile,JSON.stringify({...saved,...next.native})]);
 if(runtime!==null){
  const env=parseEnv(runtime);Object.assign(env,{ADMIN_ORIGIN:settings.adminOrigin,LICENSE_DOMAIN:normalizeDomain(new URL(settings.adminOrigin).hostname),ADMIN_HOST:'127.0.0.1',ADMIN_PORT:String(settings.uiPort),API_PORT:String(settings.apiPort)});
  if(Object.values(env).some(value=>typeof value!=='string'||/[\r\n\0]/.test(value)))throw Error('INSTALL_ENV_INVALID');
  const content=Object.entries(env).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n';
  if(canonicalJson(parseEnv(content))!==canonicalJson(env))throw Error('INSTALL_ENV_INVALID');
  outputs.push([config.native.environmentFile,content]);
 }
 if(next.adminOrigin!==config.adminOrigin&&readText(allowed[3])!==null)outputs.push([allowed[3],JSON.stringify({secret:randomBytes(32).toString('base64url')})]);
 const changes=outputs.map(([path,after])=>({path:resolve(path),before:readText(path),after,temporary:resolve(path)+'.'+randomUUID()+'.deployment-tmp'})).filter(change=>change.before!==change.after);
 if(changes.length){const record={status:'pending' as const,settings,changes};store.write('deployment-sync.json',record);finish(record)}
 return next;
}
