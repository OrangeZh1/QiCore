import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';

test('page tabs restore from URL, reject unknown/unauthorized values and preserve other query and hash',async()=>{
 const route=vue.reactive({path:'/tenant/mini-program',query:{tab:'ads',application:'id-photo'},hash:'#details'}),pushes=[],output={};
 const source=await readFile(new URL('../app/composables/useRouteTab.ts',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','useRoute','useRouter',code)(()=>vue,output,()=>route,()=>({push:async value=>{pushes.push(value)}}));
 let allowed=['settings','ads'];const tab=output.useRouteTab('settings',()=>allowed);assert.equal(tab.value,'ads');tab.value='settings';assert.equal(tab.value,'ads','URL changes only after router accepts navigation');assert.deepEqual(pushes[0],{path:route.path,query:{tab:undefined,application:'id-photo'},hash:'#details'});
 route.query=pushes[0].query;assert.equal(tab.value,'settings');route.query={...route.query,tab:'ads'};assert.equal(tab.value,'ads','history back restores tab');allowed=['settings'];route.query={...route.query};assert.equal(tab.value,'settings');tab.value='ads';assert.equal(pushes.length,1);
 for(const input of ['missing',['ads','settings'],null,undefined])assert.equal(output.routeTabValue(input,'settings',['settings','ads']),'settings');
});

test('page-tab history uses the same unsaved-change guard without next-callback navigation hangs',async()=>{
 const output={},leave=[],update=[];
 const source=await readFile(new URL('../app/composables/usePageLeaveGuard.ts',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','onBeforeRouteLeave','onBeforeRouteUpdate',code)(output,fn=>leave.push(fn),fn=>update.push(fn));
 let dirty=true,calls=0;output.usePageLeaveGuard(()=>{calls++;return dirty?false:undefined});
 assert.equal(update[0].length,2);const from={path:'/tenant/mini-program',query:{tab:'ads'}};
 assert.equal(update[0]({...from,query:{}},from),false);assert.equal(calls,1);assert.equal(update[0]({...from,query:{tab:'ads',q:'search'}},from),undefined);assert.equal(calls,1);dirty=false;assert.equal(update[0]({...from,query:{}},from),undefined);assert.equal(leave[0]({},{}),undefined);
});
