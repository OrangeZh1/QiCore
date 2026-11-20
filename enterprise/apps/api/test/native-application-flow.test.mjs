import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './fixtures/native-release.mjs';
import {applicationFlowAuthority} from './fixtures/native-application-flow.mjs';
import {frameworkFlowAuthority} from './fixtures/native-framework-flow.mjs';
import {checkNativeOperation,checkNativePlan} from '../dist/license/native-updates.js';
import {QICORE_FRAMEWORK_KEY} from '../dist/license/native-release.js';

test('runtime application-flow authority returns the current QiCore signed lifecycle capability',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-flow-protocol-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:QICORE_FRAMEWORK_KEY,version:'0.1.7'}),installed=[{packageKey:QICORE_FRAMEWORK_KEY,version:'0.1.7'}];
 const compatibility={frameworkRange:'^0.1.0',framework:{packageKey:QICORE_FRAMEWORK_KEY,range:'^0.1.0'}},first=f.release('app_fixture','1.0.0','0.0.0',{'server/main.mjs':'export const fixture=true;'},compatibility),second=f.release('app_fixture','1.1.0','1.0.0',undefined,compatibility);
 const authority=applicationFlowAuthority({f,first,second,installRelease:()=>first});f.client.machine=authority;
 const result=await checkNativeOperation(f.client,installed,'app_fixture','install');
 assert.equal(result.plan.capability,'native-lifecycle-v2');assert.equal(result.release.version,'1.0.0');assert.equal(result.release.manifest.parentApp,null);
 const withApplication=[...installed,{packageKey:'app_fixture',version:'1.0.0'}],repair=await checkNativeOperation(f.client,withApplication,'app_fixture','repair');assert.equal(repair.release.artifact.sha256,first.release.artifact.sha256);
 const update=await checkNativePlan(f.client,withApplication,'app_fixture');assert.equal(update.plan.nativeContext.capability,'native-full-v3');assert.equal(update.release.version,'1.1.0');
 const request={protocol:'license-api-v2',capability:'native-lifecycle-v2',operation:'install',packageKey:'app_fixture',installed};
 await assert.rejects(authority('updates/lifecycle/plan',{...request,capability:'native-lifecycle-v1'}));await assert.rejects(authority('updates/lifecycle/plan',{...request,protocol:'license-api-v1'}));
 f.client.machine=async(path,body)=>{const response=await authority(path,body);return {signedPlan:f.envelope({...f.client.verifyEnvelope(response.signedPlan),capability:'native-lifecycle-v1'})}};
 await assert.rejects(checkNativeOperation(f.client,installed,'app_fixture','install'),/APPLICATION_PLAN_MISMATCH/,'a valid test signature cannot downgrade the capability');
});

test('framework-flow authority issues a fresh bounded plan after lengthy earlier harness phases',async t=>{
 const now=Date.now();t.mock.timers.enable({apis:['Date'],now});
 const root=await mkdtemp(join(tmpdir(),'qicore-framework-clock-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:QICORE_FRAMEWORK_KEY,version:'0.1.7'}),installed=[{packageKey:QICORE_FRAMEWORK_KEY,version:'0.1.7'}],release=f.release(QICORE_FRAMEWORK_KEY,'0.1.8','0.1.7').release;
 f.client.machine=frameworkFlowAuthority(f,release,QICORE_FRAMEWORK_KEY);t.mock.timers.setTime(now+11*60000);
 const {plan}=await checkNativePlan(f.client,installed,QICORE_FRAMEWORK_KEY);
 assert.equal(Date.parse(plan.generatedAt),Date.now());assert.equal(Date.parse(plan.validUntil)-Date.parse(plan.generatedAt),600000);assert.equal(plan.nativeContext.capability,'native-full-v3');
});
