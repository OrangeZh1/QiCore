import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeCheckTimeout} from './fixtures/native-check-budget.mjs';

test('native package harness keeps its default and accepts an explicit bounded local budget',()=>{
 assert.equal(nativeCheckTimeout({}),600000);
 for(const value of [600000,1200000,1800000])assert.equal(nativeCheckTimeout({QICORE_NATIVE_CHECK_TIMEOUT_MS:String(value)}),value);
});
test('native package harness rejects invalid and out-of-range budgets',()=>{
 for(const value of ['', '0','-1','599999','1800001','1200000.5','NaN','Infinity','invalid'])assert.throws(()=>nativeCheckTimeout({QICORE_NATIVE_CHECK_TIMEOUT_MS:value}),/QICORE_NATIVE_CHECK_TIMEOUT_MS/);
});
