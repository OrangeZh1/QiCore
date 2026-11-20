import {test} from 'node:test';
import assert from 'node:assert/strict';
import {protectedUpdateBackups} from '../dist/lifecycle/native-effects.js';

test('completed update history releases obsolete backup protection but active and unresolved recovery stays protected',()=>{
 const task=(id,status)=>({id,status,backup:{id:'backup-'+id}});
 const state={tasks:()=>[task('old','succeeded'),task('reverted','rolled_back'),task('current','succeeded'),task('running','running'),task('broken','recovery_required')],keys:()=>['framework','application'],active:key=>key==='framework'?{recoveryReferences:['backup-current']}:{recoveryReferences:['backup-app']}};
 assert.deepEqual(new Set(protectedUpdateBackups(state,['backup-old','backup-reverted','backup-current','backup-unknown'])),new Set(['backup-current','backup-app','backup-running','backup-broken','backup-unknown']));
});
