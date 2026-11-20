import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMaintenanceMonitor,maintenanceText} from '../src/core/maintenance-client.mjs';
test('only a validated maintenance status triggers UI and recovery emits one read, never a write replay',async()=>{
 let result=null,reads=0,reloads=0,last;const timers=[];
 const m=createMaintenanceMonitor({read:async()=>{reads++;if(result instanceof Error)throw result;return result},schedule:(fn,delay)=>{timers.push({fn,delay});return timers.length},cancel(){}});
 const dispose=m.subscribe(value=>last=value);m.recovered(()=>reloads++);await m.retry();assert.equal(last.active,false);
 result={protocol:'qicore-maintenance-v1',state:'updating',serviceAvailable:false,estimatedSeconds:null};await m.retry();assert.equal(last.active,true);assert.equal(timers.at(-1).delay,5000);
 result=Error('502');await m.retry();assert.equal(last.active,true);assert.equal(last.unreachable,true);assert.equal(reloads,0);
 result={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:false};await m.retry();assert.equal(reloads,0);
 result.serviceAvailable=true;await m.retry();await m.retry();assert.equal(last.active,false);assert.equal(reloads,1);assert.ok(reads>=5);dispose();
});
test('estimate, overtime, operator recovery and no-history copy never promises a countdown',()=>{
 assert.equal(maintenanceText({state:'updating'}),'系统正在更新，请稍候');
 const input={state:'updating',estimatedSeconds:90,startedAt:new Date(0).toISOString()};assert.match(maintenanceText(input,1000),/约 2 分钟/);assert.match(maintenanceText(input,100000),/比预计稍长/);
 assert.match(maintenanceText({state:'recovery_required'}),/管理员/);
});
test('operator recovery keeps bounded polling; hidden/unmounted pages pause it and manual retry only reads status',async()=>{
 let next={protocol:'qicore-maintenance-v1',state:'recovery_required',serviceAvailable:false},latest,reloads=0,scheduled,cancelled=0;
 const monitor=createMaintenanceMonitor({read:async()=>next,schedule:(fn,delay)=>{scheduled={fn,delay};return 1},cancel(){cancelled++}});
 let release=monitor.subscribe(value=>latest=value);monitor.recovered(()=>reloads++);await monitor.retry();assert.equal(scheduled.delay,5000);
 release();assert.ok(cancelled>0);release=monitor.subscribe(value=>latest=value);await monitor.retry();
 next={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true};await scheduled.fn();await Promise.resolve();assert.equal(reloads,1);
 next={protocol:'qicore-maintenance-v1',state:'recovery_required',serviceAvailable:false};await monitor.retry();
 for(let i=0;i<120;i++)await scheduled.fn();assert.equal(latest.paused,true);
 next={protocol:'qicore-maintenance-v1',state:'ready',serviceAvailable:true};await monitor.retry();assert.equal(reloads,2);release();
});
