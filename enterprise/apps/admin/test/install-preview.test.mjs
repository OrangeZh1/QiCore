import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInstallPreview} from '../app/utils/install-wizard.ts';

test('editing preview Redis cancels only its environment check and clears old results',async()=>{
 const pending=[],wizard=createInstallPreview(1,signal=>new Promise(resolve=>pending.push({signal,resolve})));
 assert.equal(wizard.redis.tls,false);
 const first=wizard.inspectEnvironment();assert.equal(wizard.checkingEnvironment.value,true);assert.equal(wizard.checkingAuthorization.value,false);
 wizard.redis.tls=true;assert.equal(pending[0].signal.aborted,true);assert.equal(wizard.checkingEnvironment.value,false);pending[0].resolve();await first;assert.equal(wizard.environment.value,'idle');
 wizard.redis.tls=false;const second=wizard.inspectEnvironment();pending[1].resolve();await second;assert.equal(wizard.environment.value,'passed');
 wizard.redis.host='changed.local';assert.equal(wizard.environment.value,'idle');wizard.environmentResult.value='failure';const failed=wizard.inspectEnvironment();pending[2].resolve();await failed;assert.equal(wizard.environment.value,'failed');
 wizard.redis.password='preview-only';wizard.dispose();assert.equal(wizard.redis.password,'');
});

test('preview recovery continues only the final checks and clears its own indicator when cancelled',async()=>{
 let hold=false,finish;const wizard=createInstallPreview(4,()=>hold?new Promise(resolve=>{finish=resolve}):Promise.resolve());
 wizard.authorization.value={state:'active',allowed:true,domain:'preview.example.com',source:'preview'};wizard.installationResult.value='health-failure';
 await wizard.simulateInstallation();assert.equal(wizard.progress.value,67);assert.equal(wizard.canResume.value,true);
 hold=true;const retry=wizard.retryInstallation();assert.equal(wizard.resuming.value,true);assert.deepEqual(wizard.phases.value.slice(0,4),['passed','passed','passed','passed']);wizard.cancelInstallation();finish();await retry;assert.equal(wizard.resuming.value,false);assert.equal(wizard.installing.value,false);wizard.dispose();
});
