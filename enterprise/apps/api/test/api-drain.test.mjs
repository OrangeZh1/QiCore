import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Run the actual API stop handler without a DB or server. Only the timer delay is
// shortened; its real Node ref/unref behavior and the 60-second contract remain checked.
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const start=source.indexOf('  const stop=async()=>'),end=source.indexOf('\n  process.on(',start);
assert.ok(start>=0&&end>start);
const handler=source.slice(start,end);
function run(mode){
 const code=`const assert=require('node:assert/strict');const realTimeout=globalThis.setTimeout;
 const setTimeout=(callback,ms)=>{assert.equal(ms,60000);return realTimeout(callback,150)};
 let draining=false,workerBusy=false;
 const timer=undefined,storageTimer=undefined,taskTimer=undefined,paymentTimer=undefined,smsTimer=undefined,subscriptionTimer=undefined,officialTimer=undefined;
 const storage={},scheduledTasks={async close(){console.log('LOCK_POOL_CLOSED')}},payments={},tenantSms={},tenantSubscriptions={},tenantOfficialAccounts={};
 const licenseRuntime={stop(){}},restoration={async close(){}},backups={async close(){}},app={async close(){}},appRuntimes=[],redisClient={disconnect(){}};
 const resources={async close(){console.log('CLOSE_STARTED');if(${JSON.stringify(mode)}==='hang')await new Promise(()=>{});if(${JSON.stringify(mode)}==='error')throw Error('fixture');console.log('CLOSE_FINISHED')}};
 ${handler}
 const started=performance.now();process.on('exit',()=>console.log('ELAPSED '+Math.round(performance.now()-started)));void stop();`;
 const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);
 return {...result,elapsed:Number(result.stdout.match(/ELAPSED (\d+)/)?.[1])};
}
test('API async close with no remaining handles waits for the referenced deadline and fails',()=>{
 const result=run('hang');assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/RUNTIME_DRAIN_TIMEOUT/);assert.match(result.stdout,/LOCK_POOL_CLOSED/);assert.match(result.stdout,/CLOSE_STARTED/);assert.doesNotMatch(result.stdout,/CLOSE_FINISHED/);assert.ok(result.elapsed>=140&&result.elapsed<3000,String(result.elapsed));
});
test('API settled closes clear the deadline and preserve success or failure exit status',()=>{
 for(const mode of ['success','error']){const result=run(mode);assert.equal(result.status,mode==='success'?0:1,result.stderr);assert.doesNotMatch(result.stderr,/RUNTIME_DRAIN_TIMEOUT/);if(mode==='success')assert.match(result.stdout,/CLOSE_FINISHED/);else assert.match(result.stderr,/RUNTIME_DRAIN_FAILED/)}
});
