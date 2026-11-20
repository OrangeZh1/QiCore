import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import {collectionItems} from '../../../apps/api/src/core/decoration-components.mjs';

test('collection drag and keyboard scroll stay within actual bounds and can reverse after reaching the end',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const {descriptor}=compiler.parse(await readFile(new URL('../client/components/DecorationCollection.vue',import.meta.url),'utf8'));
 const script=compiler.compileScript(descriptor,{id:'collection-scroll-check'}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}},navigations=[];
 new Function('require','module','exports',code)(name=>name==='vue'?vue:{collectionItems},module,module.exports);
 const state=module.exports.default.setup({block:{},component:{items:[]},images:{}},{expose(){},emit:(_event,target)=>navigations.push(target)});
 const content={scrollWidth:200},element={clientWidth:100,querySelector:()=>content},event=x=>({button:0,clientX:x,currentTarget:element,preventDefault(){}});
 state.down(event(400));state.move(event(0));assert.equal(state.left.value,100);
 state.scroll({detail:{scrollLeft:100}});state.end();state.go('card');assert.deepEqual(navigations,[]);
 state.down(event(0));state.move(event(50));assert.equal(state.left.value,50);state.end();
 state.step(event(0),144);assert.equal(state.left.value,100);state.step(event(0),144);assert.equal(state.left.value,100);
 state.step(event(0),-144);assert.equal(state.left.value,0);state.step(event(0),-144);assert.equal(state.left.value,0);
 state.scroll({detail:{scrollLeft:75}});state.down(event(0));state.move(event(25));assert.equal(state.left.value,50);state.end();
 content.scrollWidth=100;state.step(event(0),144);assert.equal(state.left.value,0);
 state.down(event(20));state.end();state.go('card');assert.deepEqual(navigations,['card']);
});
