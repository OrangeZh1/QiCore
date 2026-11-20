import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
import {parse,compileTemplate} from 'vue/compiler-sfc';

test('shared native Banner compiles and invalid IDs collapse its visible container',async()=>{
 const file=await readFile(new URL('../../../packages/mini-ads/banner.vue',import.meta.url),'utf8'),{descriptor}=parse(file);assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'banner.vue',id:'banner',compilerOptions:{isCustomElement:tag=>['view','ad'].includes(tag)}}).errors,[]);
 const code=ts.transpileModule(descriptor.scriptSetup.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,props=vue.reactive({unitId:''}),events=[];
 const scope=vue.effectScope();try{const state=scope.run(()=>new Function('require','exports','defineProps','defineEmits',code+';return {failed,validUnit}')(()=>vue,{},()=>props,()=> (...args)=>events.push(args)));
 assert.equal(state.validUnit.value,'');assert.deepEqual(events.at(-1),['visible',false]);props.unitId='adunit-fixture01';await vue.nextTick();assert.equal(state.validUnit.value,props.unitId);assert.deepEqual(events.at(-1),['visible',true]);state.failed.value=true;props.unitId='https://invalid';await vue.nextTick();assert.equal(state.validUnit.value,'');assert.equal(state.failed.value,false);assert.deepEqual(events.at(-1),['visible',false]);
 }finally{scope.stop()}
});
