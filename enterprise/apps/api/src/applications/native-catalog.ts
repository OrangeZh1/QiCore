import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativePathSchema} from '../license/native-release.js';
import {noLinks} from '../lifecycle/native-files.js';
import {applicationKeySchema as applicationKey} from './native-descriptor.js';
import {readApplicationDescriptor} from './native-descriptor-file.js';
import {canonicalApplicationPage,canonicalConsoleRoutes} from './console-pages.mjs';
import {assertStandaloneComposition} from './standalone-composition.mjs';
import {attachPlugins,composePluginRuntime} from './plugins.mjs';
import {bindPluginAccess} from './plugin-access.mjs';
import {assertDevelopmentApplicationIdentity} from './development-workspace.mjs';
export {applicationDescriptorSchema} from './native-descriptor.js';
export {readApplicationDescriptor} from './native-descriptor-file.js';

const key=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const componentSchema=z.object({version:z.string().regex(/^\d+\.\d+\.\d+$/),manifestSha256:z.string().regex(/^[a-f0-9]{64}$/),path:z.string().refine(isAbsolute),type:z.enum(['framework','app','plugin']),parentApp:key.nullable().optional(),entrypoint:nativePathSchema}).strict();
const definitionSchema=z.object({key:applicationKey,name:z.string().min(1).max(100),licensePackageKey:key,permissions:z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/)).max(200),legacyGrants:z.literal(false).optional()}).passthrough();
export type NativeComponents=Record<string,z.infer<typeof componentSchema>>;
export type NativeApplication={definition:any;createRuntime:(resources:any)=>any;database?:any;component:z.infer<typeof componentSchema>;descriptor?:any;plugins?:any[]};

function consoleRoutes(definition:any,descriptor:ReturnType<typeof readApplicationDescriptor>){
 const routes=canonicalConsoleRoutes(descriptor.web?.admin?.routes||[]);
 for(const route of routes)if(!definition.permissions.includes(route.permission))throw Error('APPLICATION_CONSOLE_ROUTE_CONFLICT');
 const afterSalesPage=definition.afterSalesPage===undefined?undefined:canonicalApplicationPage(definition.afterSalesPage);
 if(afterSalesPage!==undefined&&!routes.some((route:any)=>route.path===afterSalesPage&&route.group==='transactions'&&route.permission==='orders.read'))throw Error('APPLICATION_AFTER_SALES_ROUTE_INVALID');
 // Runtime capabilities remain compatible with older strict archive descriptors.
 // The tenant entry still filters these declared routes by the application's grants.
 return routes.map((route:any)=>route.path===afterSalesPage?{...route,afterSales:true}:route);
}

// Only the stable host supplies this inventory, after signature and full-tree verification.
// Applications are trusted server code, not a sandbox; requests never choose an import path.
export async function loadNativeApplications(raw:string,frameworkKey:string){
 const components=z.record(key,componentSchema).parse(JSON.parse(raw));
 if(components[frameworkKey]?.type!=='framework'||Object.values(components).filter(c=>c.type==='framework').length!==1)throw Error('APPLICATION_FRAMEWORK_INVALID');
 return loadVerifiedCatalog(components, Object.entries(components).filter(([key])=>key!==frameworkKey));
}

// The caller has verified the whole product release and its complete tree.
export async function loadBundledApplications(raw:NativeComponents){
 const components=z.record(key,componentSchema).parse(raw);
 if(Object.values(components).some(c=>c.type==='framework'))throw Error('BUNDLE_COMPONENT_TYPE_INVALID');
 return loadVerifiedCatalog(components,Object.entries(components));
}

async function loadVerifiedCatalog(components:NativeComponents, members:[string,z.infer<typeof componentSchema>][]) {
 const applications:NativeApplication[]=[],identities=new Set<string>();
 const selected = members.map(([packageKey,component]) => {
   const descriptor=readApplicationDescriptor(component.path,packageKey,component.version);
   if ((component.type === 'plugin') !== (descriptor.format === 'qicore-plugin-v1')) throw Error('APPLICATION_CONTRACT_INVALID');
   return {packageKey,component,descriptor};
 });
 const main = assertStandaloneComposition(selected.map(item => item.descriptor));
 for(const {component,descriptor} of selected){
   if (descriptor.format === 'qicore-plugin-v1' && (descriptor.applicationKey === '*' ? !!component.parentApp : component.parentApp !== main?.packageKey)) throw Error('PLUGIN_OWNER_MISMATCH');
 }
 for(const {packageKey,component,descriptor} of selected){
  const entry=join(component.path,component.entrypoint);noLinks(entry);
  const entryModule=await import(pathToFileURL(entry).href);
  const module=typeof entryModule.createApplication==='function'?await entryModule.createApplication((await import('./server-sdk.mjs')).serverSdk):entryModule;
  const definition=definitionSchema.parse(module.definition);
  if(module.format!==descriptor.format||(component.type==='plugin')!==(descriptor.format==='qicore-plugin-v1')||module.version!==component.version||definition.licensePackageKey!==packageKey||definition.key!==descriptor.key||definition.name!==descriptor.name||typeof module.createRuntime!=='function'
   ||typeof definition.defaultConfig!=='function'||typeof definition.validateConfig!=='function'||identities.has(definition.key)
   ||new Set(definition.permissions).size!==definition.permissions.length)throw Error('APPLICATION_CONTRACT_INVALID');
  const routes=consoleRoutes(definition,descriptor);
  identities.add(definition.key);applications.push({definition:Object.freeze({...definition,...(definition.afterSalesPage?{afterSalesPage:canonicalApplicationPage(definition.afterSalesPage)}:{}),consoleRoutes:routes,pendingTasks:descriptor.pendingTasks,version:component.version,source:'native'}),createRuntime:module.createRuntime,database:module.database,component,descriptor});
 }
 const plugins=applications.filter(app=>app.descriptor.format==='qicore-plugin-v1');
 for(const plugin of plugins)if(plugin.descriptor.applicationKey!=='*'&&!plugin.component.parentApp)throw Error('PLUGIN_OWNER_MISMATCH');
 return {components,applications:attachPlugins(applications.filter(app=>app.descriptor.format!=='qicore-plugin-v1'),plugins),plugins};
}

export async function loadDevelopmentApplications(workspace:any){
 if(process.env.NODE_ENV!=='development')throw Error('DEVELOPMENT_WORKSPACE_FORBIDDEN');
 const applications:NativeApplication[]=[];
 const selected=workspace.applications.map((app:any)=>{
  const descriptor=readApplicationDescriptor(app.path,app.packageKey,app.version);
  assertDevelopmentApplicationIdentity(app,descriptor);
  return {app,descriptor};
 });
 assertStandaloneComposition(selected.map((item:any)=>item.descriptor));
 for(const {app,descriptor} of selected){
  const file=join(app.path,'entry.mjs'),revision=createHash('sha256').update(readFileSync(file)).digest('hex');
  const module=await (await import(pathToFileURL(file).href+'?development='+revision)).createApplication((await import('./server-sdk.mjs')).serverSdk);
  const definition=definitionSchema.parse(module.definition);
  if(module.format!==descriptor.format||module.version!==descriptor.version||definition.key!==app.key||definition.key!==descriptor.key||definition.licensePackageKey!==app.packageKey||definition.name!==descriptor.name||typeof definition.defaultConfig!=='function'||typeof definition.validateConfig!=='function'||typeof module.createRuntime!=='function'||new Set(definition.permissions).size!==definition.permissions.length)throw Error('APPLICATION_CONTRACT_INVALID');
  const routes=consoleRoutes(definition,descriptor);
  applications.push({definition:Object.freeze({...definition,...(definition.afterSalesPage?{afterSalesPage:canonicalApplicationPage(definition.afterSalesPage)}:{}),legacyGrants:false,consoleRoutes:routes,pendingTasks:descriptor.pendingTasks,version:app.version,source:'development'}),createRuntime:module.createRuntime,database:module.database,component:undefined as any,descriptor});
 }
 const plugins=applications.filter(app=>app.descriptor.format==='qicore-plugin-v1');
 return {components:null,applications:attachPlugins(applications.filter(app=>app.descriptor.format!=='qicore-plugin-v1'),plugins),plugins};
}

export function createNativeRuntimes(applications:NativeApplication[],resources:any){
 bindPluginAccess(resources.pluginAllowed??(()=>false));
 return applications.map(app=>{
  if(resources.storage&&typeof resources.storage.forApplication!=='function')throw Error('APPLICATION_STORAGE_CONTRACT_INVALID');
  const storage=resources.storage?.forApplication(app.definition.key);
  const runtime=app.createRuntime({...resources,storage});
  if(!runtime||runtime.key!==app.definition.key||runtime.legacyRoutes||!Array.isArray(runtime.consumerPaths)
   ||runtime.consumerPaths.some((path:unknown)=>typeof path!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(path)||path==='dev')
   ||['connect','initialize','tick','admin','consumer','health','close'].some(method=>typeof runtime[method]!=='function'))throw Error('APPLICATION_RUNTIME_INVALID');
  return composePluginRuntime(runtime,app.plugins||[],{...resources,storage});
 });
}
