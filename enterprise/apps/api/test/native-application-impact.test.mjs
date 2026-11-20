import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applicationImpact} from '../dist/lifecycle/native-applications.js';
import {singleEnterprise} from './fixtures/single-enterprise.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';

test('uninstall counts unprocessed notices for terminal and retired payments only in the target application',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db,url}=await isolatedDatabase(t),key='impact-fixture';await singleEnterprise(db,{id:'isolated'});
 const descriptor={format:'qicore-application-v1',key,packageKey:'app_impact',version:'1.0.0',name:'Impact',pendingTasks:[]};
 const state={active:()=>({current:{version:'1.0.0'}}),release:()=>({artifact:{manifestSha256:'a'.repeat(64)}}),component:()=>({read:()=>descriptor}),installed:()=>[{packageKey:'app_impact'}],config:{migrationUrl:url}};
 const count=async()=> (await applicationImpact(state,'app_impact')).pending;
 async function notice(applicationKey,state,noticeState='PENDING',retired=false){
  const id=randomUUID().replaceAll('-','');
  await db.paymentRecord.create({data:{id,tenantId:'isolated',applicationKey,orderId:id,userId:'user',provider:'wechat',revisionId:randomUUID(),payerCipher:'fixture',amount:100,currency:'CNY',state,expiresAt:new Date(),currentSlot:retired?null:1}});
  return db.paymentNotice.create({data:{id:randomUUID(),paymentId:id,kind:'payment',payloadHash:'a'.repeat(64),payloadCipher:'fixture',state:noticeState}});
 }
 assert.equal(await count(),0);
 await notice('another-app','CLOSED');await notice(key,'PAID','DONE');assert.equal(await count(),0);
 const closed=await notice(key,'CLOSED');assert.equal(await count(),1,'a late payment on a closed order must block uninstall');
 const retired=await notice(key,'CLOSED','PENDING',true);assert.equal(await count(),2,'retired attempts still own their compensation');
 const paid=await notice(key,'PAID');assert.equal(await count(),3);
 await db.paymentNotice.updateMany({where:{id:{in:[closed.id,retired.id,paid.id]}},data:{state:'DONE'}});assert.equal(await count(),0,'completed notices do not block uninstall');
 assert.equal(await db.paymentNotice.count(),5,'preflight never consumes or deletes evidence');
});

test('uninstall includes framework plugin pending work only in the target application domain',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db,url}=await isolatedDatabase(t),key='impact-fixture';await singleEnterprise(db,{id:'isolated'});
 const descriptor={format:'qicore-application-v1',key,packageKey:'app_impact',version:'1.0.0',name:'Impact',pendingTasks:[]};
 const plugin={format:'qicore-plugin-v1',key:'framework-jobs',packageKey:'plugin_jobs',version:'1.0.0',name:'Jobs',applicationKey:'*',namespace:'frameworkJobs',routes:{admin:[],consumer:[]},pendingTasks:[{table:'ImpactFrameworkJob',statusColumn:'state',pendingStates:['PENDING'],applicationKeyColumn:'applicationKey'}]};
 const descriptors={app_impact:descriptor,plugin_jobs:plugin};
 const state={active:()=>({current:{version:'1.0.0'}}),release:key=>({artifact:{manifestSha256:'a'.repeat(64)},manifest:{type:key==='plugin_jobs'?'plugin':'app'}}),component:key=>({read:()=>descriptors[key]}),installed:()=>Object.keys(descriptors).map(packageKey=>({packageKey})),config:{migrationUrl:url}};
 await db.$executeRawUnsafe('CREATE TABLE ImpactFrameworkJob (id INT PRIMARY KEY, applicationKey VARCHAR(64) NOT NULL, state VARCHAR(32) NOT NULL)');
 await db.$executeRawUnsafe("INSERT INTO ImpactFrameworkJob VALUES(1,'another-app','PENDING')");
 const count=async()=> (await applicationImpact(state,'app_impact')).pending;
 assert.equal(await count(),0,'another application domain does not block this uninstall');
 await db.$executeRawUnsafe('INSERT INTO ImpactFrameworkJob VALUES(2,?,?)',key,'PENDING');assert.equal(await count(),1,'framework plugin work must drain before its application runtime disappears');
 await db.$executeRawUnsafe("UPDATE ImpactFrameworkJob SET state='DONE' WHERE id=2");assert.equal(await count(),0);
 assert.equal(await db.$queryRawUnsafe('SELECT COUNT(*) AS total FROM ImpactFrameworkJob').then(rows=>Number(rows[0].total)),2,'preflight retains all plugin business records');
 assert.deepEqual((await applicationImpact(state,'app_impact')).descriptor,descriptor,'impact does not rewrite the application descriptor');
});
