import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/native-release.mjs';
import {NativeApplicationLifecycle} from '../dist/lifecycle/native-applications.js';
import {BackupArchive} from '../dist/backups/archive.mjs';
import {checkNativePlan} from '../dist/license/native-updates.js';
import {assertComponentOwner} from '../dist/applications/component-owner.js';

async function setup(t,applicationKey='id-photo'){
 const root=await mkdtemp(join(tmpdir(),'qicore-plugin-lifecycle-'));t.after(()=>{assert.equal(resolve(root,'..'),resolve(tmpdir()));return rm(root,{recursive:true,force:true})});
 const f=fixture(root);await f.install(f.release('frm_fixture','1.0.0','0.0.0'));
 const parent={format:'qicore-application-v1',key:'id-photo',name:'照片应用',packageKey:'app_parent',version:'1.0.0',pendingTasks:[]};
 await f.install(f.release('app_parent','1.0.0','0.0.0',{'application.json':JSON.stringify(parent),'server/main.mjs':'export const parent=true;'}));
 const receipt=f.client.status().receipt;f.client.acceptReceipt(f.envelope({...receipt,revision:receipt.revision+1,entitlements:[...receipt.entitlements,{packageKey:'app_parent',type:'app',useExpiresAt:null,updatesExpiresAt:null,channel:'stable'},{packageKey:'plugin_fixture',type:'plugin',useExpiresAt:null,updatesExpiresAt:null,channel:'stable'}]}));
 const descriptor={format:'qicore-plugin-v1',key:'photo-export',name:'导出扩展',packageKey:'plugin_fixture',version:'1.0.0',applicationKey,namespace:'photoExport',pendingTasks:[],routes:{admin:[],consumer:[]}};
 const make=(version='1.0.0',from='0.0.0')=>f.release('plugin_fixture',version,from,{'application.json':JSON.stringify({...descriptor,version}),'server/main.mjs':'export const plugin=true;'},
  {type:'plugin',parentApp:applicationKey==='*'?null:'app_parent',dependencies:applicationKey==='*'?[]:[{packageKey:'app_parent',range:'^1.0.0'}]});
 let served=make();const calls={migrations:0,stops:0};
 f.client.machine=async(path,body)=>{
  if(path==='updates/plan')return{signedPlan:f.envelope({...f.plan(served.release,body.installed,'plugin_fixture'),licenseRevision:f.client.status().receipt.revision})};
  if(path.endsWith('/access'))return{accessToken:'fixture_token.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.equal(path,'updates/lifecycle/plan');const now=Date.now();return{signedPlan:f.envelope({protocol:'license-api-v2',capability:'native-lifecycle-v1',operation:body.operation,key_id:'receipt',planId:'plan_plugin_fixture',licenseId:'license-test',licenseRevision:f.client.status().receipt.revision,instanceId:f.client.identity().instanceId,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+60000).toISOString(),productId:'frm_fixture',domain:'127.0.0.1',packageKey:'plugin_fixture',installed:body.installed,release:served.release})};
 };
 f.client.transport=async()=>new Response(served.archive,{headers:{'content-length':String(served.archive.length)}});
 new BackupArchive({root:f.state.config.backupRoot,keyRoot:f.state.config.backupKeyRoot}).init();await mkdir(f.state.config.dataRoot);
 let running=true;const host={stop:async()=>{calls.stops++;running=false},start:async()=>{running=true},running:()=>running,health:async()=>{}};
 class Harness extends NativeApplicationLifecycle{runtime(){return{platform:'linux',arch:'x64',node:'24.0.0'}}async migrations(_release,_path,execute){if(execute)calls.migrations++}async backup(id){return{id:'backup-'+id,sha256:'a'.repeat(64),verified:true}}async impact(){return{tenants:1,pending:0,descriptor}}}
 const engine=new Harness(f.state,host,f.client),request=operation=>({requestId:randomUUID(),operation,packageKey:'plugin_fixture',targetVersion:served.release.version,manifestSha256:served.release.artifact.manifestSha256});
 return{...f,engine,host,calls,request,make,serve:value=>{served=value}};
}

test('signed plugin installation, exact repair, independent update plans and uninstall preserve the parent',async t=>{
 const f=await setup(t),parent=structuredClone(f.state.active('app_parent')),code=await readFile(join(f.state.path('app_parent',parent.current),'server/main.mjs'),'utf8');
 const install=f.request('install'),installed=await f.engine.execute(install.requestId,install);assert.equal(installed.status,'succeeded',JSON.stringify(installed));assert.equal(f.calls.migrations,1);
 const repair=f.request('repair');assert.equal((await f.engine.execute(repair.requestId,repair)).status,'succeeded');assert.equal(f.calls.migrations,1,'exact repair does not repeat migrations');
 f.serve(f.make('1.1.0','1.0.0'));const next=await checkNativePlan(f.client,f.state.installed(),'plugin_fixture');assert.equal(next.release.manifest.type,'plugin');assert.equal(next.release.version,'1.1.0');
 const uninstall=f.request('uninstall');uninstall.targetVersion='1.0.0';uninstall.manifestSha256=f.state.release('plugin_fixture',f.state.active('plugin_fixture').current).artifact.manifestSha256;
 assert.equal((await f.engine.execute(uninstall.requestId,uninstall)).status,'succeeded');assert.equal(f.state.active('plugin_fixture'),null);
 assert.deepEqual(f.state.active('app_parent'),parent);assert.equal(await readFile(join(f.state.path('app_parent',parent.current),'server/main.mjs'),'utf8'),code);
 assert.equal(f.state.component('plugin_fixture').read('application.json').key,'photo-export');
 const retired=f.state.component('plugin_fixture').read('application.json');
 assert.throws(()=>assertComponentOwner(f.state,{...retired,key:'other-export',packageKey:'plugin_other'},f.make().release),/PLUGIN_NAMESPACE_CONFLICT/,'uninstall retains namespace ownership so old custom roles cannot authorize another plugin');
});

test('wrong plugin ownership is blocked before migrations and stopping the parent',async t=>{
 const f=await setup(t,'another-app'),request=f.request('install'),result=await f.engine.execute(request.requestId,request);
 assert.equal(result.status,'blocked');assert.equal(result.code,'PLUGIN_OWNER_MISMATCH');assert.equal(f.calls.migrations,0);assert.equal(f.calls.stops,0);
});

test('a signed framework plugin uses the same lifecycle without becoming an application',async t=>{
 const f=await setup(t,'*'),request=f.request('install'),result=await f.engine.execute(request.requestId,request);assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(f.calls.migrations,1);
});
