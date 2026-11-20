import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

test('browser refresh and close warn only while a draft or save is active, and dispose their handler',async()=>{
 const source=await readFile(new URL('../app/composables/useUnsavedBeforeUnload.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const output={},mounted=[],disposed=[],listeners=new Map();let dirty=false;
 new Function('exports','onMounted','onBeforeUnmount','window',code)(output,fn=>mounted.push(fn),fn=>disposed.push(fn),{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name)}});
 output.useUnsavedBeforeUnload(()=>dirty);mounted[0]();let prevented=0;const event={preventDefault(){prevented++},returnValue:null};
 listeners.get('beforeunload')(event);assert.equal(prevented,0);dirty=true;listeners.get('beforeunload')(event);assert.equal(prevented,1);assert.equal(event.returnValue,'');dirty=false;listeners.get('beforeunload')(event);assert.equal(prevented,1);disposed[0]();assert.equal(listeners.size,0);
});
