import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';

async function page(){
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const runtime={apiBase:'/api/v1',tenantId:'tenant-a',applicationKey:'app-a'},session={token:'valid',identity:'tenant-a:app-a:user-a'},requests=[];
 const bridge={useMaintenanceReload(){},runtimeConfig:()=>runtime,getToken:()=>session.token,identityScope:()=>session.identity,consumerReady:async()=>!!session.token,api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject})),message:e=>e.message,levelKey:level=>level.id??'base',isH5:true,isClientPreview:false,onShow(){},onLoad(){},onUnload(){}};
 const {descriptor}=compiler.parse(await readFile(new URL('../client/pages/levels/index.vue',import.meta.url),'utf8')),script=compiler.compileScript(descriptor,{id:'levels'}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
 new Function('require','module','exports',code)(name=>name==='vue'?vue:bridge,module,module.exports);
 return{state:module.exports.default.setup({},{expose(){}}),runtime,session,requests,bridge};
}
const catalog={levels:[{id:null,name:'普通会员',rank:0,defined:true,criteria:[],benefits:[]}],growthRules:{registration:0,perYuan:0}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('expired member requests fall back to the public catalog, including retry failure and recovery',async()=>{
 const {state,session,requests}=await page();
 const loading=state.load();await tick();assert.equal(requests[0].path,'/member-levels');
 session.token='';session.identity='::';requests[0].reject(Object.assign(Error('expired'),{status:401}));await tick();
 assert.match(requests[1]?.path||'',/^\/public\/client\/member-levels\?/);requests[1].resolve(catalog);await loading;
 assert.equal(state.data.value,null);assert.deepEqual(state.catalog.value,catalog);assert.equal(state.guest.value,true);assert.equal(state.action.value,'');
 const retry=state.load('retry');await tick();assert.equal(state.action.value,'retry');requests[2].reject(Error('offline'));await retry;assert.equal(state.error.value,'offline');assert.equal(state.action.value,'');
 const recovery=state.load('retry');await tick();requests[3].resolve(catalog);await recovery;assert.equal(state.error.value,'');assert.deepEqual(state.catalog.value,catalog);
});

test('restored login displays private membership and late responses cannot overwrite a new site',async()=>{
 const {state,session,runtime,requests,bridge}=await page();session.token='';bridge.consumerReady=async()=>{session.token='restored';return true};
 const loading=state.load();await tick();requests[0].resolve({...catalog,current:catalog.levels[0],profile:{name:'A'},nextId:null});await loading;
 assert.equal(state.guest.value,false);assert.equal(state.data.value.profile.name,'A');
 const old=state.load();await tick();runtime.tenantId='tenant-b';session.token='';session.identity='::';bridge.consumerReady=async()=>false;
 const fresh=state.load();await tick();requests[2].resolve(catalog);await fresh;requests[1].reject(Object.assign(Error('late'),{status:401}));await old;
 assert.equal(requests.length,3);assert.equal(state.data.value,null);assert.deepEqual(state.catalog.value,catalog);assert.equal(state.error.value,'');
});
