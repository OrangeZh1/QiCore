import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import {decorationBlock} from '../../../apps/api/src/core/decoration-contract.mjs';
import * as options from '../../../apps/api/src/core/decoration-options.mjs';

test('switching navigation styles preserves entries and resets pagination without losing settings',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const {descriptor}=compiler.parse(await readFile(new URL('../client/components/DecorationLinks.vue',import.meta.url),'utf8'));
 const script=compiler.compileScript(descriptor,{id:'decoration-navigation'}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
 new Function('require','module','exports',code)(name=>name==='vue'?vue:name.endsWith('decoration-options.mjs')?options:{},module,module.exports);
 const block=vue.reactive(decorationBlock('links','navigation'));
 block.appearance.columns=3;block.options={navDisplay:'pages',navRows:2,iconSize:40,labelSize:14};
 block.items=Array.from({length:8},(_,i)=>({id:String(i),label:'入口'+i,target:'help',imageId:null,enabled:i!==2}));
 const scope=vue.effectScope(),state=scope.run(()=>module.exports.default.setup({block,images:{}},{expose(){},emit(){}}));
 try{
  assert.equal(state.paged.value,true);assert.deepEqual(state.pages.value.map(page=>page.length),[6,1]);
  assert.equal(state.height.value,184);state.current.value=1;
  block.options.navStyle='tiles';await vue.nextTick();assert.equal(state.paged.value,false);assert.equal(state.cards.value,true);assert.equal(state.current.value,0);assert.equal(state.pages.value[0].length,7);
  block.options.navStyle='icons';block.appearance.layout='list';await vue.nextTick();assert.equal(state.paged.value,false);assert.equal(state.pages.value[0].length,7);
  block.appearance.layout='grid';await vue.nextTick();assert.equal(state.paged.value,true);assert.deepEqual(state.pages.value.map(page=>page.length),[6,1]);
  assert.equal(block.options.navDisplay,'pages');assert.equal(block.options.navRows,2);assert.equal(block.items.length,8);
 }finally{scope.stop()}
});
