import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalJson} from '../../dist/license/contracts.js';

// Synthetic records model completed preparation failures; no live production data is copied.
export function seedTerminalTransitionHistory(state,keys){
 assert.ok(keys.length>0);const records=[];
 for(let index=0;index<4;index++){
  const key=keys[index%keys.length],createdAt=new Date(Date.now()-86400000+index*1000).toISOString();
  const record={id:randomUUID(),createdAt,updatedAt:createdAt,status:'blocked',step:'COMPATIBILITY',code:'COMPONENT_DEPENDENCY_CONFLICT'};
  const store=state.component(key),existing=store.read('tasks.json')??[];store.write('tasks.json',[...existing,record]);records.push({...record,packageKey:key});
 }
 const ids=new Set(records.map(r=>r.id)),snapshot=()=>state.tasks().filter(t=>ids.has(t.id));
 const initial=snapshot();assert.equal(initial.length,4);
 const originalFiles=keys.map(key=>{const path=state.component(key).path('tasks.json');return {path,bytes:readFileSync(path)}});
 const digest=createHash('sha256').update(canonicalJson(initial)).digest('hex');
 return {assertFilesUnchanged(){for(const file of originalFiles)assert.deepEqual(readFileSync(file.path),file.bytes,'bootstrap transition must not rewrite task file bytes')},assertPreserved(){assert.deepEqual(snapshot(),initial,'historical blocked tasks must remain unchanged')},report:{records:4,status:'blocked',synthetic:true,sha256:digest,preserved:true}};
}
