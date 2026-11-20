import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attachPlugins,composePluginRuntime} from '../src/applications/plugins.mjs';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';
import {applicationCatalog,hasApplicationPermission} from '../src/applications/registry.mjs';
import {bindPluginAccess} from '../src/applications/plugin-access.mjs';
import {loadNativeApplications,createNativeRuntimes} from '../dist/applications/native-catalog.js';
import {pluginDescriptorSchema,assertApplicationReleaseLayout} from '../dist/applications/native-descriptor.js';

const descriptor={format:'qicore-plugin-v1',key:'photo-export',packageKey:'plugin_photo_export',version:'1.0.0',name:'导出扩展',applicationKey:'id-photo',namespace:'photoExport',pendingTasks:[],routes:{admin:[{path:'reports/:id',method:'GET',permission:'reports.read'}],consumer:[{path:'status',method:'GET'}]}};
function setup(){
 const calls=[],base={key:'id-photo',consumerPaths:['photos'],connect(){calls.push('base-connect')},initialize(){},tick(){},admin(){return'base-admin'},consumer(){return'base-consumer'},health(){return true},close(){calls.push('base-close')}};
 const plugin={descriptor,definition:{key:descriptor.key,name:descriptor.name,licensePackageKey:descriptor.packageKey,permissions:['reports.read'],consoleRoutes:[]},createRuntime:({applicationKey})=>({key:descriptor.key,connect(){calls.push(applicationKey)},initialize(){},tick(enabled){calls.push(enabled?'plugin-tick':'plugin-disabled')},admin(context){return context},consumer(context){return context},health(){return true},close(){calls.push('plugin-close')}})};
 const owner={definition:{key:'id-photo',name:'证件照',licensePackageKey:'app_photo',permissions:['orders.read'],consoleRoutes:[]},createRuntime:()=>base};
 return{base,plugin,owner,calls};
}

test('plugin capabilities compose into the photo application without replacing identity, handlers or tenant slots',async()=>{
 const {base,owner,plugin,calls}=setup(),[composed]=attachPlugins([owner],[plugin]);
 setApplicationDefinitions([composed.definition]);let allowed=true;bindPluginAccess(()=>allowed);
 assert.deepEqual(applicationCatalog().map(item=>item.key),['id-photo']);
 assert.equal(hasApplicationPermission(['id-photo:plugins.photoExport.reports.read'],'id-photo','plugins.photoExport.reports.read'),true);
 const queried=[],db={tenant:{findUnique:async({where})=>{queried.push(where.id);return{id:where.id,enabled:true}}},tenantApplication:{findUnique:async()=>({enabled:true,activeSlot:1})}};
 const runtime=composePluginRuntime(base,[plugin],{db,pluginAllowed:()=>allowed,applicationKey:'id-photo'});
 await runtime.connect({});assert.deepEqual(calls,['base-connect','id-photo']);
 assert.equal(await runtime.consumer({applicationKey:'id-photo'},['photos'],'GET',{}),'base-consumer');
 const session={tenantId:'tenant-a',applicationKey:'id-photo',userId:'consumer-a'};
 const value=await runtime.consumer(session,['plugins','photo-export','status'],'GET',{});assert.equal(value.tenantId,'tenant-a');assert.equal(value.applicationKey,'id-photo');assert.ok(queried.length>0&&queried.every(tenantId=>tenantId==='tenant-a'));
 await assert.rejects(runtime.consumer({...session,applicationKey:'other-app'},['plugins','photo-export','status'],'GET',{}),error=>error.code==='FORBIDDEN');
 await assert.rejects(runtime.consumer(session,['plugins','photo-export','missing'],'GET',{}),error=>error.code==='NOT_FOUND');
 await assert.rejects(runtime.admin({},['admin','tenants','tenant-a','apps','id-photo','plugins','photo-export','reports','one'],'GET',{}),error=>error.code==='FORBIDDEN');
 await runtime.tick(true);assert.ok(calls.includes('plugin-tick'));allowed=false;calls.length=0;await runtime.tick(true);assert.deepEqual(calls,['plugin-disabled']);calls.length=0;
 assert.equal(hasApplicationPermission(['id-photo:plugins.photoExport.reports.read'],'id-photo','plugins.photoExport.reports.read'),false);
 await assert.rejects(runtime.consumer(session,['plugins','photo-export','status'],'GET',{}),error=>error.code==='PLUGIN_UNAVAILABLE');
 await runtime.close();assert.deepEqual(calls,['plugin-close','base-close']);
});

test('plugin schema, ownership and collisions fail before runtime creation',()=>{
 const {owner,plugin}=setup();assert.doesNotThrow(()=>pluginDescriptorSchema.parse(descriptor));
 assert.throws(()=>pluginDescriptorSchema.parse({...descriptor,applicationKey:'system'}));
 assert.throws(()=>attachPlugins([],[plugin]),/PLUGIN_OWNER_MISMATCH/);
 assert.throws(()=>attachPlugins([owner],[plugin,plugin]),/PLUGIN_NAMESPACE_CONFLICT/);
 assert.throws(()=>attachPlugins([owner],[{...plugin,component:{parentApp:'app_other'}}]),/PLUGIN_OWNER_MISMATCH/);
 const duplicate={...plugin,descriptor:{...descriptor,routes:{...descriptor.routes,admin:[...descriptor.routes.admin,{...descriptor.routes.admin[0],path:'reports/:anotherId'}]}}};
 assert.throws(()=>attachPlugins([owner],[duplicate]),/PLUGIN_ROUTE_CONFLICT/);
 assert.throws(()=>assertApplicationReleaseLayout(descriptor,{package_type:'app_update',package_key:descriptor.packageKey,version:'1.0.0',entrypoint:'entry.mjs',files:[]}),/DESCRIPTOR_MISMATCH/);
});

test('a general plugin requires a primary and extends both the primary and framework without consuming an application slot',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-plugin-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'plugin');await mkdir(directory);
 const global={...descriptor,applicationKey:'*'};await writeFile(join(directory,'application.json'),JSON.stringify(global));
 await writeFile(join(directory,'entry.mjs'),`export function createApplication(){return{format:'qicore-plugin-v1',version:'1.0.0',definition:{key:'photo-export',name:'导出扩展',licensePackageKey:'plugin_photo_export',permissions:['reports.read'],defaultConfig:()=>({}),validateConfig:v=>v},createRuntime:()=>({key:'photo-export',connect(){},initialize(){},tick(){},admin(){},consumer(){},health(){return true},close(){}})}}`);
 const base={version:'1.0.0',manifestSha256:'a'.repeat(64),path:root,type:'framework',entrypoint:'main.mjs'};
 const pluginPart={...base,path:directory,type:'plugin',parentApp:null,entrypoint:'entry.mjs'};
 await assert.rejects(loadNativeApplications(JSON.stringify({frm_fixture:base,plugin_photo_export:pluginPart}),'frm_fixture'),/PLUGIN_OWNER_MISMATCH/);
 const appPath=join(root,'main');await mkdir(appPath);
 await writeFile(join(appPath,'application.json'),JSON.stringify({key:'id-photo',packageKey:'app_photo',format:'qicore-application-v1',version:'1.0.0',name:'测试主应用',pendingTasks:[]}));
 await writeFile(join(appPath,'entry.mjs'),`export const format='qicore-application-v1',version='1.0.0';
  export const definition={key:'id-photo',licensePackageKey:'app_photo',name:'测试主应用',permissions:[],defaultConfig:()=>({}),validateConfig:v=>v};
  export function createRuntime(){return{key:'id-photo',consumerPaths:[],connect(){},initialize(){},tick(){},admin(){},consumer(){},health(){return true},close(){}}}`);
 const components={frm_fixture:base,app_photo:{...base,path:appPath,type:'app',entrypoint:'entry.mjs'},plugin_photo_export:pluginPart};
 await assert.rejects(loadNativeApplications(JSON.stringify({...components,plugin_photo_export:{...pluginPart,parentApp:'app_photo'}}),'frm_fixture'),/PLUGIN_OWNER_MISMATCH/);
 const loaded=await loadNativeApplications(JSON.stringify(components),'frm_fixture');
 assert.deepEqual(loaded.applications.map(item=>item.definition.key),['id-photo','system']);
 assert.deepEqual(loaded.plugins.map(item=>item.descriptor.key),['photo-export']);
 for (const item of loaded.applications) assert.deepEqual(item.definition.plugins.map(p=>p.packageKey),['plugin_photo_export']);
 const runtimes=createNativeRuntimes(loaded.applications,{pluginAllowed:()=>true});
 assert.deepEqual(runtimes.map(runtime=>runtime.key),['id-photo','system']);
 for(const runtime of runtimes){assert.equal(await runtime.health(),true);await runtime.close()}

});
