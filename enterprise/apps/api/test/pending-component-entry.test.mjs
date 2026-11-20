import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpdateService} from '../dist/lifecycle/update-service.js';
test('unfinished install and uninstall retain their component entry without granting expired application permissions',async t=>{
 const original=process.env.UPDATER_SOCKET;process.env.UPDATER_SOCKET='fixture';t.after(()=>{if(original===undefined)delete process.env.UPDATER_SOCKET;else process.env.UPDATER_SOCKET=original});
 const client={product:{appKey:'frm_qa',deliveryKind:'archive'},componentCatalog:async()=>({components:[],issuedAt:''}),componentStatus:()=>{throw Error('expired')},status:()=>({updatesEligible:true,receipt:{entitlements:[]}})};
 const license={client,updateCenter:()=>({allowed:true,update:{state:'current',currentVersion:'0.1.0'},license:{}})};
 for(const operation of ['install','uninstall']){
  const task={id:'fixture-task',operation,status:'recovery_required',step:'CLEANUP',createdAt:'',updatedAt:'',request:{packageKey:'app_qa',operation},componentTarget:{from:{version:'0.1.0'},to:operation==='install'?{version:'0.1.0'}:null}};
  const state={kind:'native',applicationLifecycle:true,code:'RECOVERY_REQUIRED',backups:{ready:true},components:[{packageKey:'frm_qa',version:'0.1.0',update:{}}],tasks:[task],applicationIdentities:[{packageKey:'app_qa',key:'qa-app'}]};
  const view=await new UpdateService(license,async()=>state).view();assert.equal(view.applications.purchased[0].packageKey,'app_qa');assert.equal(view.applications.purchased[0].license.allowed,false);assert.equal(view.applications.purchased[0].management.canInstall,false);assert.equal(view.tasks[0].id,task.id);
  task.status='succeeded';assert.equal((await new UpdateService(license,async()=>state).view()).applications.purchased.length,0);
 }
});
