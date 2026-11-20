import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {developmentWorkspace,developmentLicenseTransport,reserveDevelopmentApplications} from '../src/applications/development-workspace.mjs';
import {StateStore} from '../dist/license/store.js';
import {rebuildQueue,delay} from '../../../scripts/development/processes.mjs';
import {AdminAuth,requestCookie} from '../dist/core/admin-auth.mjs';

test('loopback workspaces issue, renew and clear only their own session cookie',t=>{
 const previous={NODE_ENV:process.env.NODE_ENV,QICORE_DEV_WORKSPACE:process.env.QICORE_DEV_WORKSPACE};
 t.after(()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}});
 process.env.NODE_ENV='development';
 const auth=new AdminAuth({},{}),pair=cookie=>cookie.split(';')[0];
 const workspace=n=>{process.env.QICORE_DEV_WORKSPACE=join(tmpdir(),'workspace-'+n,'workspace.json')};
 workspace(1);const first=pair(auth.sessionCookie('first',30,'/','tenant'));
 workspace(2);const second=pair(auth.sessionCookie('second',30,'/','tenant'));
 const jar=first+'; '+second;
 for(const [n,token,original] of [[1,'first',first],[2,'second',second]]){
   workspace(n);assert.equal(requestCookie(jar,'tenant'),token);
   assert.equal(pair(auth.sessionCookies(jar,new Date(Date.now()+60000),'tenant')[0]),original);
   assert.equal(pair(auth.sessionCookie('',0,'/','tenant')),original.split('=')[0]+'=');
 }
 process.env.NODE_ENV='production';
 assert.equal(pair(auth.sessionCookie('prod',30,'/','tenant')),'qicore_enterprise_session=prod');
});

test('development catalogs require an explicit development process and loopback origins',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-development-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'app');await mkdir(path);const file=join(root,'workspace.json');
 const app={key:'example-app',packageKey:'app_example',version:'1.0.0',path,adminOrigin:'http://127.0.0.1:4000',h5Origin:'http://127.0.0.1:4001'},env={NODE_ENV:'development',QICORE_DEV_WORKSPACE:file};
 const write=applications=>writeFile(file,JSON.stringify({format:'qicore-development-workspace-v1',applications}));
 assert.equal(developmentWorkspace({NODE_ENV:'development'}),null);await write([app]);assert.equal(developmentWorkspace(env).applications[0].key,'example-app');
 for(const NODE_ENV of ['production','test',undefined])assert.throws(()=>developmentWorkspace({...env,NODE_ENV}),/FORBIDDEN/);
 assert.throws(()=>developmentWorkspace({...env,QICORE_COMPONENTS:'{}'}),/FORBIDDEN/);
 await write([app,app]);assert.throws(()=>developmentWorkspace(env),/INVALID/);
 for(const adminOrigin of ['https://127.0.0.1:4000','http://example.com','http://127.0.0.1@evil.test','http://127.0.0.1/path']){await write([{...app,adminOrigin}]);assert.throws(()=>developmentWorkspace(env),/ORIGIN_INVALID/)}
});

test('local development transport serves only its explicit receipt, never an external release operation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-development-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const licenseReceipt=join(root,'receipt.json');await writeFile(licenseReceipt,JSON.stringify({fixture:true}));
 const product={product:'qicore-local-development',licenseApi:'https://development.invalid/api/v1/'},transport=developmentLicenseTransport({licenseReceipt},product);
 assert.deepEqual(await(await transport(product.licenseApi+'license/renew')).json(),{receipt:{fixture:true}});
 assert.equal((await transport('https://license.mcent.cn/api/v1/license/renew')).status,409);
 assert.throws(()=>developmentLicenseTransport({licenseReceipt},{...product,product:'qicore'}),/PRODUCT_REQUIRED/);
});

test('source rebuilds coalesce and serialize overlapping changes, and recover after a failed compile',async()=>{
 let active=0,maxActive=0,runs=0,errors=0,release;
 const schedule=rebuildQueue(async()=>{active++;maxActive=Math.max(active,maxActive);runs++;if(runs===1)await new Promise(resolve=>release=resolve);active--;if(runs===1)throw Error('compile failed')},()=>errors++);
 schedule();schedule();await delay(250);schedule();await delay(250);release();await delay(80);
 assert.equal(runs,2);assert.equal(errors,1);assert.equal(maxActive,1);
});

test('development data keeps application identities across unload, restart and source relocation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-development-identities-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new StateStore(root),first={key:'first-app',packageKey:'app_first'},second={key:'second-app',packageKey:'app_second'};
 store.write('workspace.json',{format:'qicore-development-workspace-v1',applications:[first]});
 reserveDevelopmentApplications(store,[]);
 store.write('workspace.json',{format:'qicore-development-workspace-v1',applications:[]});
 reserveDevelopmentApplications(new StateStore(root),[second]);
 const saved=store.read('application-identities.json');
 for(const app of [{...first,packageKey:'app_other'},{...first,key:'other-app'}]){
  assert.throws(()=>reserveDevelopmentApplications(store,[app]),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
  assert.deepEqual(store.read('application-identities.json'),saved);
 }
 reserveDevelopmentApplications(store,[{...first,path:'relocated',version:'2.0.0'},second]);
 assert.deepEqual(store.read('application-identities.json'),saved);
 store.write('application-identities.json',{format:'unknown',applications:[]});
 assert.throws(()=>reserveDevelopmentApplications(store,[]),/HISTORY_INVALID/);
});

test('development plugin namespaces remain owned after unload and cannot change target or inherit retired grants',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-plugin-identities-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new StateStore(root);
 const plugin={format:'qicore-plugin-v1',key:'photo-export',packageKey:'plugin_photo_export',applicationKey:'id-photo',namespace:'photoExport'};
 reserveDevelopmentApplications(store,[plugin]);reserveDevelopmentApplications(store,[]);const saved=store.read('application-identities.json');
 for(const changed of [{...plugin,namespace:'another'},{...plugin,applicationKey:'other-app'}])assert.throws(()=>reserveDevelopmentApplications(store,[changed]),/IDENTITY_CHANGED/);
 for(const applicationKey of ['id-photo','*'])assert.throws(()=>reserveDevelopmentApplications(store,[{...plugin,key:'another-export',packageKey:'plugin_another',applicationKey}]),/NAMESPACE_CONFLICT/);
 assert.deepEqual(store.read('application-identities.json'),saved);
});

test('development loader rejects emitted plugin identities that differ from the reserved source',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-development-output-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {loadDevelopmentApplications}=await import('../dist/applications/native-catalog.js');
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='development';t.after(()=>{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous});
 async function emitted(name,descriptor){
  const path=join(root,name);await mkdir(path);await writeFile(join(path,'application.json'),JSON.stringify(descriptor));
  await writeFile(join(path,'entry.mjs'),`export function createApplication(){return{format:${JSON.stringify(descriptor.format)},version:${JSON.stringify(descriptor.version)},definition:{key:${JSON.stringify(descriptor.key)},name:${JSON.stringify(descriptor.name)},licensePackageKey:${JSON.stringify(descriptor.packageKey)},permissions:[],defaultConfig:()=>({}),validateConfig:value=>value},createRuntime(){}}}`);
  return {...descriptor,path};
 }
 const owner=await emitted('owner',{format:'qicore-application-v1',key:'fixture-app',packageKey:'app_fixture',version:'1.0.0',name:'Fixture',pendingTasks:[]});
 const declared={format:'qicore-plugin-v1',key:'fixture-plugin',packageKey:'plugin_fixture',version:'1.0.0',name:'Plugin',pendingTasks:[],applicationKey:'fixture-app',namespace:'reserved',routes:{admin:[],consumer:[]}};
 for(const [name,change] of [['namespace',{namespace:'otherScope'}],['changed-owner',{applicationKey:'*'}]]){
  const output=await emitted(name,{...declared,...change});
  await assert.rejects(loadDevelopmentApplications({applications:[owner,{...declared,path:output.path}]}),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
 }
 const output=await emitted('format',{...declared,key:owner.key,packageKey:owner.packageKey});
 await assert.rejects(loadDevelopmentApplications({applications:[{...owner,path:output.path}]}),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
});

test('development workspace checks plugin identity history and requires its active owner',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-development-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const appPath=join(root,'app'),pluginPath=join(root,'plugin');await mkdir(appPath);await mkdir(pluginPath);
 const app={key:'fixture-app',packageKey:'app_fixture',format:'qicore-application-v1',version:'1.0.0',path:appPath};
 const plugin={key:'fixture-plugin',packageKey:'plugin_fixture',format:'qicore-plugin-v1',applicationKey:app.key,namespace:'reserved',version:'1.0.0',path:pluginPath};
 const store=new StateStore(root);reserveDevelopmentApplications(store,[app,plugin]);
 const file=join(root,'workspace.json'),env={NODE_ENV:'development',QICORE_DEV_WORKSPACE:file};
 const write=applications=>writeFile(file,JSON.stringify({format:'qicore-development-workspace-v1',applications}));
 await write([app,{...plugin,namespace:'otherScope'}]);assert.throws(()=>developmentWorkspace(env),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
 await write([app,{...plugin,applicationKey:'*'}]);assert.throws(()=>developmentWorkspace(env),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
 const {format,applicationKey,namespace,...legacy}=plugin;await write([app,legacy]);assert.throws(()=>developmentWorkspace(env),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
 await write([plugin]);assert.throws(()=>developmentWorkspace(env),/PLUGIN_OWNER_MISMATCH/);
 await write([app,plugin]);assert.deepEqual(developmentWorkspace(env).applications.map(({key,namespace})=>[key,namespace]),[[app.key,undefined],[plugin.key,'reserved']]);
});
