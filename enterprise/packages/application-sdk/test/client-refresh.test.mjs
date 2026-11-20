import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';

test('help retries retain the current list and answer while a changed site clears both',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const {descriptor}=compiler.parse(await readFile(new URL('../client/pages/help/index.vue',import.meta.url),'utf8')),script=compiler.compileScript(descriptor,{id:'help-refresh'}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}},requests=[];
 let scope='site-a';const bridge={useMaintenanceReload(){},helpEndpoint:()=>scope,loadHelp:q=>new Promise((resolve,reject)=>requests.push({q,resolve,reject})),loadHelpArticle:async()=>{throw Error('inline answer should be reused')},message:e=>e.message,isClientPreview:false,onLoad(){},onShow(){},onUnload(){}};
 new Function('require','module','exports',code)(name=>name==='vue'?vue:bridge,module,module.exports);
 const state=module.exports.default.setup({},{expose(){}}),listing={page:1,pageSize:20,total:1,categories:[{id:'general',name:'常见问题'}],items:[{id:'one',title:'如何制作',content:'选择照片后制作'}]};
 const first=state.load();requests.shift().resolve(listing);await first;await state.open('one');assert.equal(state.expanded.value,'one');
 const reload=state.load('refresh');assert.equal(state.data.value.items[0].id,'one');assert.equal(state.expanded.value,'one');requests.shift().reject(Error('temporary'));await reload;assert.equal(state.data.value.items.length,1);
 const retry=state.load('retry');assert.equal(state.busy.value,'retry');assert.equal(state.error.value,'temporary');assert.equal(state.answers.value.one,'选择照片后制作');requests.shift().resolve(listing);await retry;assert.equal(state.error.value,'');assert.equal(state.busy.value,'');
 scope='site-b';const changed=state.load('scope');assert.equal(state.data.value,null);assert.equal(state.expanded.value,'');assert.deepEqual(state.categories.value,[]);requests.shift().reject(Error('unavailable'));await changed;assert.equal(state.data.value,null);
});
