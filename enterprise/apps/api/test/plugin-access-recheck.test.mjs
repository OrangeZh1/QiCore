import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composePluginRuntime} from '../src/applications/plugins.mjs';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';

setApplicationDefinitions([{key:'id-photo',name:'照片应用',licensePackageKey:'app_photo',permissions:['plugins.photoExport.status.read']}]);

test('a delayed plugin response is rejected when its tenant changes application before completion',async()=>{
 let selected=true,finish,started;
 const entered=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>finish=resolve);
 const db={tenant:{findUnique:async()=>({id:'tenant-a',enabled:true})},tenantApplication:{findUnique:async()=>({enabled:true,activeSlot:selected?1:null})}};
 const base={key:'id-photo',consumerPaths:[],connect(){},initialize(){},tick(){},admin(){},consumer(){},health(){return true},close(){}};
 const plugin={descriptor:{key:'photo-export',namespace:'photoExport',routes:{admin:[],consumer:[{path:'status',method:'GET'}]}},definition:{licensePackageKey:'plugin_export'},createRuntime:()=>({...base,key:'photo-export',async consumer(){started();await pending;return{privateResult:true}}})};
 const runtime=composePluginRuntime(base,[plugin],{db,pluginAllowed:()=>true});
 const response=runtime.consumer({tenantId:'tenant-a',applicationKey:'id-photo',userId:'consumer-a'},['plugins','photo-export','status'],'GET',{});
 await entered;selected=false;finish();
 await assert.rejects(response,error=>error.code==='APPLICATION_NOT_OPEN');
});

test('a delayed plugin admin response is rejected after its current role loses the declared permission',async()=>{
 const qualified='id-photo:plugins.photoExport.status.read';let granted=true,finish,started;
 const entered=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>finish=resolve);
 const db={tenant:{findUnique:async()=>({id:'tenant-a',enabled:true})},tenantApplication:{findUnique:async()=>({enabled:true,activeSlot:1})},adminSession:{findFirst:async()=>({})},adminAccount:{findUnique:async()=>({enabled:true,role:{enabled:true,portal:'tenant',permissions:granted?[qualified]:[]},scopes:[{tenantId:'tenant-a',enabled:true}]})}};
 const base={key:'id-photo',consumerPaths:[],connect(){},initialize(){},tick(){},admin(){},consumer(){},health(){return true},close(){}};
 const plugin={descriptor:{key:'photo-export',namespace:'photoExport',routes:{admin:[{path:'status',method:'GET',permission:'status.read'}],consumer:[]}},definition:{licensePackageKey:'plugin_export'},createRuntime:()=>({...base,key:'photo-export',async admin(){started();await pending;return{privateResult:true}}})};
 const runtime=composePluginRuntime(base,[plugin],{db,pluginAllowed:()=>true});
 const session={_admin:true,id:'operator',role:'tenant',tokenHash:'session-fixture',tenantIds:['tenant-a'],permissions:[qualified]};
 const response=runtime.admin(session,['admin','tenants','tenant-a','apps','id-photo','plugins','photo-export','status'],'GET',{});
 await entered;granted=false;finish();
 await assert.rejects(response,error=>error.code==='FORBIDDEN');
});
