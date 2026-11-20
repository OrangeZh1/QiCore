import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function recovery(t){
 const hooks={mounted:[],show:[],hide:[],unload:[],unmount:[]},listeners=new Set();let version=0;
 const lifecycle={onShow:fn=>hooks.show.push(fn),onHide:fn=>hooks.hide.push(fn),onUnload:fn=>hooks.unload.push(fn)};
 const vueApi={...vue,onMounted:fn=>hooks.mounted.push(fn),onBeforeUnmount:fn=>hooks.unmount.push(fn)};
 const source=await readFile(new URL('../client/lib/maintenance.ts',import.meta.url),'utf8'),{code}=await transform(source,{loader:'ts',format:'cjs'}),module={exports:{}};
 const monitor={recoveryVersion:()=>version,recovered(fn){listeners.add(fn);return()=>listeners.delete(fn)},reset(){},probe(){}};
 new Function('require','module','exports',code)(name=>name==='vue'?vueApi:name==='@dcloudio/uni-app'?lifecycle:name.includes('runtime-config')?{runtimeConfig:()=>({apiBase:'/api/v1'})}:{createMaintenanceMonitor:()=>monitor},module,module.exports);
 t.after(()=>{for(const fn of hooks.unmount)fn()});
 return{hook:module.exports.useMaintenanceReload,vue:vueApi,lifecycle,hooks,emit(){version++;for(const fn of listeners)fn()},mount(){for(const fn of hooks.mounted)fn()}};
}
test('recovery queues one read behind existing work, coalesces events, and stops after one failed read',async t=>{
 const f=await recovery(t),busy=vue.ref(true);let reads=0;f.hook(async()=>{reads++;throw Error('read failed')},()=>busy.value);f.mount();f.emit();f.emit();await tick();assert.equal(reads,0);busy.value=false;await tick();assert.equal(reads,1);await tick();assert.equal(reads,1);
 for(const fn of f.hooks.hide)fn();f.emit();await tick();assert.equal(reads,1);for(const fn of f.hooks.show)fn();await tick();assert.equal(reads,2);f.emit();await tick();assert.equal(reads,3);
});
test('a real decorated page waits for the old GET failure then performs one recovery read',async t=>{
 const f=await recovery(t),requests=[],module={exports:{}};let scope='site-a';
 const imports={useMaintenanceReload:f.hook,isH5:false,message:e=>e.message,decorationScope:()=>scope,loadDecoration:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),...f.lifecycle};
 const {code}=await transform(await readFile(new URL('../client/lib/use-decoration-page.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'});
 new Function('require','module','exports','uni',code)(name=>name==='vue'?f.vue:imports,module,module.exports,{setNavigationBarTitle(){}});
 const page=module.exports.useDecorationPage('home');f.mount();const old=page.load();f.emit();assert.equal(requests.length,1);requests[0].reject(Object.assign(Error('offline'),{code:'NETWORK_UNKNOWN'}));await old;await tick();assert.equal(requests.length,2);assert.equal(page.action.value,'maintenance');requests[1].resolve({scope,scheme:{home:{title:'已恢复'}}});await tick();assert.equal(page.error.value,'');assert.equal(page.data.value.scheme.home.title,'已恢复');assert.equal(requests.length,2);
 const delayed=page.load();f.emit();scope='site-b';requests[2].resolve({scope:'site-a',scheme:{home:{title:'旧站点'}}});await delayed;await tick();assert.equal(requests.length,4);requests[3].resolve({scope,scheme:{home:{title:'当前站点'}}});await tick();assert.equal(page.data.value.scope,'site-b');
});
test('a real recharge page queries the original request after a delayed unknown POST and never replays it',async t=>{
 const f=await recovery(t),requests=[],storage=new Map(),navigations=[],module={exports:{}};
 const request=(path,method='GET',body)=>new Promise((resolve,reject)=>requests.push({path,method,body,resolve,reject}));
 const bridge={useMaintenanceReload:f.hook,runtimeConfig:()=>({apiBase:'/api/v1',tenantId:'site',applicationKey:'system'}),getToken:()=> 'token',identityScope:()=> 'site:system:user',consumerScope:()=> 'site:system:user|token',consumerReady:async()=>true,api:request,readWallet:()=>request('/wallet'),message:e=>e.message,rechargeKey:()=> '00000000-0000-4000-8000-000000000001',...f.lifecycle};
 const {code}=await transform(await readFile(new URL('../client/lib/use-recharge.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'});
 new Function('require','module','exports','uni',code)(name=>name==='vue'?f.vue:bridge,module,module.exports,{getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),navigateTo:options=>navigations.push(options.url)});
 const page=module.exports.useRecharge('balance');f.mount();const loading=page.load();await tick();const wallet={points:{amount:0},balance:{amount:1234}},catalog={version:1,points:[],balance:{tiers:[],customEnabled:true,minCents:1,maxCents:100000}};requests[0].resolve(wallet);requests[1].resolve(catalog);await loading;
 const input={kind:'balance_custom',amountCents:1234,version:1},submission=page.submit(input);await tick();assert.equal(requests[2].method,'POST');f.emit();assert.equal(requests.length,3);requests[2].reject(Object.assign(Error('unknown outcome'),{status:0}));await submission;await tick();
 assert.equal(requests.filter(item=>item.method==='POST').length,1);const query=requests.find(item=>item.path.includes('/by-request/'));assert.ok(query);assert.equal(query.method,'GET');query.resolve({id:'original-order',status:'pending'});for(const item of requests.slice(3))if(item!==query)item.resolve(item.path==='/wallet'?wallet:catalog);await tick();assert.equal(page.pending.value.id,'original-order');assert.equal(page.pending.value.input.amountCents,1234);assert.equal(page.createAction.value,'');assert.deepEqual(navigations,[]);
});
