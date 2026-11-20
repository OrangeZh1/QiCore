import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TenantPermissions} from '../src/core/tenant-permissions.mjs';
import {attachPlugins} from '../src/applications/plugins.mjs';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';
import {bindPluginAccess} from '../src/applications/plugin-access.mjs';

test('application and framework plugin permissions appear in the existing role editor and cannot be granted after revocation',async()=>{
 const owner={definition:{key:'id-photo',name:'照片应用',licensePackageKey:'app_photo',permissions:['settings.read'],permissionLabels:{'settings.read':'应用设置'}}};
 const plugin=(key,namespace,applicationKey)=>({descriptor:{key,name:key,packageKey:'plugin_'+namespace,version:'1.0.0',applicationKey,namespace,pendingTasks:[],routes:{admin:[],consumer:[]}},definition:{licensePackageKey:'plugin_'+namespace,permissions:['status.read'],permissionLabels:{'status.read':'查看扩展状态'}}});
 const loaded=attachPlugins([owner],[plugin('photo-export','photoExport','id-photo'),plugin('framework-tools','tools','*')]);setApplicationDefinitions(loaded.map(app=>app.definition));bindPluginAccess(()=>true);
 let opened=[{applicationKey:'id-photo'}];const db={tenantApplication:{findMany:async()=>opened}},permissions=new TenantPermissions(db,()=>Buffer.alloc(32));
 const appKey='id-photo:plugins.photoExport.status.read';
 const appCatalog=await permissions.catalog(db,'tenant-a',[appKey]);assert.deepEqual(appCatalog.find(item=>item.key===appKey),{group:'photo-export',key:appKey,label:'查看扩展状态',grantable:true});
 assert.ok(!appCatalog.some(item=>item.key==='tenant:plugins.tools.status.read'),'active applications use their own scope');
 opened=[];const systemKey='tenant:plugins.tools.status.read';const systemCatalog=await permissions.catalog(db,'tenant-a',[systemKey]);assert.equal(systemCatalog.find(item=>item.key===systemKey).grantable,true);
 bindPluginAccess(()=>false);const revoked=await permissions.catalog(db,'tenant-a',[systemKey]);assert.equal(revoked.find(item=>item.key===systemKey).grantable,false);assert.throws(()=>permissions.ceiling([systemKey],[systemKey]),error=>error.code==='TENANT_GRANT_FORBIDDEN');
});
