import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {build,transform} from 'esbuild';
import * as framework from '../../../apps/api/src/core/decoration-framework.mjs';
const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue');
const output=await build({entryPoints:[fileURLToPath(new URL('../client/lib/use-recharge.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['vue','@dcloudio/uni-app','./api','./wallet','./runtime-config']});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const offers={version:1,points:[{id:'one',name:'基础积分套餐',points:100,giftPoints:20,priceCents:990}],balance:{tiers:[]}};
function fixture(asset){
 let token='',logins=0,ready;const calls=[],storage=new Map(),hooks={},runtime={apiBase:'/api/v1',tenantId:'tenant',applicationKey:'app'};
 const scope=()=>token?'tenant:app:'+token:'tenant:app:guest',request=path=>new Promise((resolve,reject)=>calls.push({path,resolve,reject}));
 const bridge={getToken:()=>token,identityScope:scope,consumerScope:scope,consumerReady:async()=>ready?ready():!!token,runtimeConfig:()=>runtime,api:request,readWallet:()=>request('/wallet'),message:error=>error.message,consumerLogin(){logins++},rechargeKey:()=> 'fixture-request'};
 const module={exports:{}};new Function('require','module','exports','uni',output.outputFiles[0].text)(name=>name==='vue'?vue:name==='@dcloudio/uni-app'?{onShow:fn=>{const previous=hooks.show;hooks.show=()=>{previous?.();return fn()}},onHide:fn=>{const previous=hooks.hide;hooks.hide=()=>{previous?.();return fn()}},onUnload:fn=>{const previous=hooks.unload;hooks.unload=()=>{previous?.();return fn()}}}:bridge,module,module.exports,{getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),navigateTo(){}});
 return{state:module.exports.useRecharge(asset),calls,token:value=>token=value,hooks,runtime,storage,logins:()=>logins,ready:fn=>ready=fn};
}
test('guest balance remains private; signed-in data cannot return after sign-out',async()=>{
 for(const asset of ['balance']){
  const f=fixture(asset),s=f.state;await s.load();assert.equal(s.guest.value,true);assert.equal(s.wallet.value,null);assert.equal(s.catalog.value,null);assert.equal(f.calls.length,0);assert.equal(s.action.value,'');
  f.token('user');const login=s.load();await tick();assert.deepEqual(f.calls.map(call=>call.path),['/wallet','/recharge/catalog']);
  const wallet={points:{amount:12},balance:{amount:3400}},catalog={version:1,points:[{id:'one'}],balance:{tiers:[]}};f.calls[0].resolve(wallet);f.calls[1].resolve(catalog);await login;assert.equal(s.guest.value,false);assert.equal(s.wallet.value.points.amount,12);assert.equal(s.catalog.value.points.length,1);
  const stale=s.load('reload');await tick();f.token('');await s.load();assert.equal(s.guest.value,true);assert.equal(s.wallet.value,null);assert.equal(s.catalog.value,null);
  f.calls[2].resolve(wallet);f.calls[3].resolve(catalog);await stale;assert.equal(s.wallet.value,null);assert.equal(s.catalog.value,null);assert.equal(s.action.value,'');assert.equal(f.calls.length,4);f.hooks.unload();
 }
});

test('guests browse public points offers and enter login without creating an order',async()=>{
 const f=fixture('points'),s=f.state,loading=s.load();await tick();
 assert.deepEqual(f.calls.map(call=>call.path),['/public/client/recharge-catalog?tenantId=tenant&applicationKey=app']);
 assert.equal(s.action.value,'initial');assert.equal(s.createAction.value,'');assert.equal(s.wallet.value,null);
 f.calls[0].resolve(offers);await loading;assert.equal(s.catalog.value.points[0].priceCents,990);assert.equal(s.action.value,'');
 await s.submit({kind:'points_recharge',packageId:'one',version:1});assert.equal(f.logins(),1);assert.equal(f.calls.length,1);assert.equal(f.storage.size,0);
});

test('points discard stale public/private results across login, sign-out and site changes',async()=>{
 const f=fixture('points'),s=f.state,guest=s.load();await tick();
 f.token('user');const login=s.load();await tick();
 f.calls[0].resolve(offers);await guest;assert.equal(s.catalog.value,null);assert.equal(s.action.value,'initial');
 const wallet={points:{amount:12},balance:{amount:3400}};
 f.calls[1].resolve(wallet);f.calls[2].resolve(offers);await login;assert.equal(s.wallet.value.points.amount,12);assert.equal(s.guest.value,false);
 const stale=s.load('reload');await tick();f.token('');const logout=s.load();await tick();
 assert.equal(s.wallet.value,null);assert.equal(s.catalog.value,null);assert.equal(s.pending.value,null);
 f.calls[5].resolve(offers);await logout;f.calls[3].resolve(wallet);f.calls[4].resolve({...offers,version:99});await stale;
 assert.equal(s.wallet.value,null);assert.equal(s.catalog.value.version,1);assert.equal(s.guest.value,true);
 const oldSite=s.load('reload');await tick();f.runtime.tenantId='other';const newSite=s.load();await tick();
 assert.match(f.calls[7].path,/tenantId=other&applicationKey=app/);f.calls[6].resolve(offers);await oldSite;assert.equal(s.catalog.value,null);assert.equal(s.action.value,'initial');
 f.calls[7].resolve({...offers,points:[]});await newSite;assert.deepEqual(s.catalog.value.points,[]);assert.equal(s.action.value,'');
 const unloaded=s.load('reload');await tick();f.hooks.unload();f.calls[8].resolve(offers);await unloaded;assert.equal(s.catalog.value,null);
});

test('expired sessions fall back to public offers; failures retry with independent loading',async()=>{
 const f=fixture('points'),s=f.state;f.token('expired');f.ready(()=>{f.token('');throw Object.assign(Error('expired'),{status:401})});
 const expired=s.load();await tick();assert.match(f.calls[0].path,/^\/public\/client\/recharge-catalog/);
 f.calls[0].reject(Error('套餐读取失败'));await expired;assert.equal(s.error.value,'套餐读取失败');assert.equal(s.action.value,'');
 f.ready(null);const retry=s.load('retry');await tick();assert.equal(s.action.value,'retry');assert.equal(s.createAction.value,'');
 await s.load('retry');await s.submit({kind:'points_recharge',packageId:'one',version:1});assert.equal(f.calls.length,2);assert.equal(f.logins(),0);
 f.calls[1].resolve(offers);await retry;assert.equal(s.error.value,'');assert.equal(s.action.value,'');
 f.token('user');const login=s.load();await tick();f.token('');f.calls[2].reject(Object.assign(Error('expired on server'),{status:401}));f.calls[3].resolve(offers);await tick();
 assert.match(f.calls[4].path,/^\/public\/client\/recharge-catalog/);f.calls[4].resolve(offers);await login;
 assert.equal(s.guest.value,true);assert.equal(s.wallet.value,null);assert.equal(s.catalog.value.version,1);assert.equal(s.action.value,'');
});

async function compile(file,resolve){
 const compiler=require('vue/compiler-sfc');
 const {descriptor}=compiler.parse(await readFile(new URL(file,import.meta.url),'utf8'),{templateParseOptions:{isCustomElement:tag=>['view','text','image','scroll-view','page-meta'].includes(tag)}});
 const script=compiler.compileScript(descriptor,{id:'guest-recharge',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','image','scroll-view','page-meta'].includes(tag)}}});
 const {code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
 new Function('require','module','exports',code)(name=>name==='vue'?vue:resolve(name),module,module.exports);return module.exports;
}

test('points page renders public pricing, gifts, login purchase and an honest empty state',async()=>{
 const f=fixture('points'),loading=f.state.load();await tick();f.calls[0].resolve(offers);await loading;
 const pageState=await compile('../client/components/ClientPageState.vue',name=>name.includes('decoration-framework')?framework:{isH5:true});
 const page=await compile('../client/pages/member/index.vue',name=>name.includes('ClientPageState.vue')?pageState:name.includes('ClientNavigation.vue')?{props:['title'],render(){return vue.h('header',this.title)}}:name.endsWith('.vue')?{render:()=>null}:name==='@dcloudio/uni-app'?{onLoad:fn=>fn({tab:'records'})}:name.endsWith('/use-recharge')?{useRecharge:()=>f.state}:name.includes('decoration-framework')?framework:{isH5:true,money:n=>(n/100).toFixed(2),consumerLogin(){}});
 const render=()=>require('vue/server-renderer').renderToString(vue.createSSRApp(page.default));
 const guest=await render();assert.match(guest,/积分套餐/);assert.match(guest,/基础积分套餐/);assert.match(guest,/9\.90/);assert.match(guest,/赠送 20 积分/);assert.match(guest,/合计到账 120 积分/);assert.match(guest,/登录后充值/);
 assert.doesNotMatch(guest,/我的积分|可用积分|订单记录|继续原订单/);
 assert.match(guest,/登录查看积分/);assert.match(guest,/guest-login/);
 f.state.catalog.value={...offers,points:[]};const empty=await render();assert.match(empty,/暂无积分套餐/);assert.match(empty,/套餐上架后会在这里展示/);assert.doesNotMatch(empty,/purchase-footer|登录后充值|选择充值套餐/);
});

test('balance page distinguishes guests, unknown balances, failed reads and real zero balances',async()=>{
 const ssr=require('vue/server-renderer'),f=fixture('balance');await f.state.load();
 const pageState=await compile('../client/components/ClientPageState.vue',name=>name.includes('decoration-framework')?framework:{isH5:true});
 const page=await compile('../client/pages/recharge/index.vue',name=>name.includes('ClientPageState.vue')?pageState:name.endsWith('.vue')?{render:()=>null}:name==='@dcloudio/uni-app'?{onLoad(){}}:name.endsWith('/use-recharge')?{useRecharge:()=>f.state}:{money:n=>(n/100).toFixed(2),consumerLogin(){}});
 const render=()=>ssr.renderToString(vue.createSSRApp(page.default));
 const guest=await render();assert.match(guest,/登录后查看余额/);assert.match(guest,/去登录/);
 assert.doesNotMatch(guest,/asset-summary|账户余额|0\.00|充值金额|自定义充值金额|订单记录|继续原订单|确认充值|recharge-card|recharge-footer/);assert.equal(f.calls.length,0);
 const guestLoading=f.state.load();const checking=await render();assert.doesNotMatch(checking,/asset-summary|正在读取余额信息|0\.00/);await guestLoading;
 f.token('user');const login=f.state.load();await tick();
 const loading=await render();assert.match(loading,/>—<\/view>/);assert.match(loading,/正在读取余额信息/);assert.doesNotMatch(loading,/0\.00|登录后查看余额|订单记录/);
 const catalog={version:1,balance:{tiers:[{id:'tier',amountCents:1000,giftCents:0}],customEnabled:false}};
 f.calls[0].reject(Error('余额读取失败'));f.calls[1].resolve(catalog);await login;
 const failed=await render();assert.match(failed,/>—<\/view>/);assert.match(failed,/余额读取失败/);assert.match(failed,/重新加载/);assert.doesNotMatch(failed,/0\.00|正在读取余额信息/);assert.equal(f.state.action.value,'');
 const retry=f.state.load('retry');await tick();const retrying=await render();assert.match(retrying,/<button[^>]*loading="true"[^>]*>重新加载<\/button>/);assert.equal(f.state.createAction.value,'');
 f.calls[2].resolve({points:{amount:0},balance:{amount:0}});f.calls[3].resolve(catalog);await retry;
 const zero=await render();assert.match(zero,/>¥0\.00<\/view>/);assert.doesNotMatch(zero,/余额读取失败|登录后查看余额/);assert.equal(f.state.action.value,'');
 const refresh=f.state.load('reload');await tick();f.calls[4].resolve({points:{amount:0},balance:{amount:3400}});f.calls[5].resolve(catalog);await refresh;
 const signedIn=await render();assert.match(signedIn,/34\.00/);assert.match(signedIn,/订单记录/);assert.match(signedIn,/recharge-card/);assert.match(signedIn,/确认充值/);assert.doesNotMatch(signedIn,/登录后查看余额/);
 f.token('');await f.state.load();const signedOut=await render();assert.match(signedOut,/登录后查看余额/);assert.doesNotMatch(signedOut,/asset-summary|34\.00|0\.00|订单记录|recharge-card|recharge-footer/);assert.equal(f.calls.length,6);f.hooks.unload();
});
