import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schedulePreset,scheduleRule,scheduleDescription} from '../app/utils/task-schedule.ts';
test('schedule picker roundtrips common rules and preserves custom expressions for editing',()=>{
  for(const rule of ['* * * * *','*/5 * * * *','15 * * * *','0 3 * * *','30 9 * * 1'])assert.equal(scheduleRule(schedulePreset(rule)),rule);
  for(const rule of ['0 9 1 * *','0 9 * * 1-5','*/7 * * * *','0 25 * * *'])assert.equal(schedulePreset(rule).mode,'custom');
  assert.equal(scheduleDescription(schedulePreset('0 3 * * *')),'每天 03:00 执行');
  assert.equal(scheduleDescription(schedulePreset('30 9 * * 1')),'每周一 09:30 执行');
  assert.equal(scheduleDescription(schedulePreset('*/5 * * * *')),'每隔 5 分钟执行一次');
  assert.equal(scheduleRule({...schedulePreset('0 3 * * *'),time:''}),'');
});
