import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachPlugins} from '../src/applications/plugins.mjs';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';
import {applicationCatalog} from '../src/applications/registry.mjs';
import {TenantApplications} from '../src/applications/service.mjs';
import {bindPluginAccess} from '../src/applications/plugin-access.mjs';

test('zero-application switching retains framework plugin pending-task checks after license revocation',async()=>{
 const task={table:'ExamplePluginTask',statusColumn:'state',pendingStates:['PENDING'],applicationKeyColumn:'applicationKey',tenantIdColumn:'tenantId'};
 const plugin={descriptor:{key:'framework-tools',name:'框架扩展',packageKey:'plugin_tools',version:'1.0.0',applicationKey:'*',namespace:'tools',pendingTasks:[task],routes:{admin:[],consumer:[]}},definition:{permissions:[]}};
 const loaded=attachPlugins([],[plugin]);setApplicationDefinitions(loaded.map(app=>app.definition));assert.deepEqual(applicationCatalog(),[]);
 let pending=1;const reads=[];
 const db={paymentRecord:{count:async()=>0},paymentRefund:{count:async()=>0},$queryRaw:async()=>[{total:0n}],$queryRawUnsafe:async(sql,...values)=>{reads.push({sql,values});return[{total:pending}]}};
 const applications=new TenantApplications(db);bindPluginAccess(()=>false);
 await assert.rejects(applications.assertCanRelease(db,'tenant-a','system'),error=>error.code==='APPLICATION_BUSY');
 assert.deepEqual(reads[0].values,['PENDING','system','tenant-a']);assert.match(reads[0].sql,/ExamplePluginTask/);
 pending=0;await applications.assertCanRelease(db,'tenant-a','system');assert.equal(reads.length,2);
});
