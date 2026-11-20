import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as h5Routes from '../../../apps/api/src/core/h5-routes.mjs';

async function client(platform='h5',object=Object){
 const source=(await readFile(new URL('../client/lib/api.ts',import.meta.url),'utf8'))
  .replace("import {runtimeConfig} from './runtime-config'","const runtimeConfig=()=>runtime")
  .replace("import {maintenance} from './maintenance'","const maintenance={probe(){}}")
  .replaceAll('import.meta.env','ENV');
 const {code}=await transform(source,{loader:'ts',format:'cjs',target:'es2022'});
 const runtime={apiBase:'/api/v1',tenantId:'alpha',applicationKey:'test-app',appId:''},storage=new Map(),requests=[],navigations=[],timers=[];
 const uni={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),request:options=>{requests.push(options);return{abort(){options.aborted=true;options.fail({errMsg:'request:fail abort'})}}},navigateTo:options=>{navigations.push(options.url);options.complete?.()}};
 const module={exports:{}};
 new Function('module','exports','require','uni','runtime','ENV','getCurrentPages','location','Object','setTimeout','clearTimeout','URLSearchParams',code)(module,module.exports,()=>h5Routes,uni,runtime,{UNI_PLATFORM:platform,DEV:false},()=>[{route:'pages/result/index',options:{id:'work-1'}}],{search:'?id=work-1&application=test-app&previewReload=1'},object,(callback,delay)=>{const timer={callback,delay,cleared:false};timers.push(timer);return timer},timer=>{timer.cleared=true},platform==='h5'?URLSearchParams:undefined);
 const api=module.exports;
 storage.set(api.sessionStorageKey('zjz-token'),'token');
 return {api,runtime,storage,requests,navigations,timers};
}

test('protected pages recover login with their return path while guest checks stay on the page',async()=>{
 for(const expired of [false,true]){
  const c=await client();if(!expired)c.api.clearSession();
  else c.storage.set(c.api.sessionStorageKey('zjz-session'),{...c.runtime,mode:'password',expiresAt:'2000-01-01T00:00:00Z'});
  await assert.rejects(c.api.ensureSession(),{code:'LOGIN_REQUIRED'});
  assert.equal(c.navigations.length,1);
  assert.equal(new URL(c.navigations[0],'https://fixture.test').searchParams.get('returnPath'),'/result?id=work-1');
  assert.equal(c.api.getToken(),'');assert.equal(c.requests.length,0);
 }
 for(const check of ['consumerReady','profile']){
  const c=await client();
  await assert.rejects(check==='consumerReady'?c.api.consumerReady():c.api.ensureSession({redirect:false}),{status:401});
  assert.deepEqual(c.navigations,[]);assert.equal(c.api.getToken(),'');
  assert.equal(await c.api.consumerReady(),false);
 }
 const active=await client();active.storage.set(active.api.sessionStorageKey('zjz-session'),{...active.runtime,mode:'password',expiresAt:'2100-01-01T00:00:00Z'});
 await active.api.ensureSession();assert.equal(await active.api.consumerReady(),true);assert.deepEqual(active.navigations,[]);
 const mini=await client('mp-weixin');await assert.rejects(mini.api.ensureSession(),{status:401});assert.deepEqual(mini.navigations,['/pages/login/index?returnPath='+encodeURIComponent('/pages/result/index?id=work-1')]);assert.equal(mini.requests.length,0);
});

test('empty or malformed API responses settle with an error instead of leaving callers loading',async()=>{
 for(const [statusCode,data] of [[502,null],[500,'<html>upstream error</html>'],[200,null],[200,{}],[200,'not JSON']]){
  const c=await client(),pending=c.api.api('/profile');
  const rejected=assert.rejects(pending,{code:statusCode===200?'API_RESPONSE_INVALID':'HTTP_ERROR'});
  assert.doesNotThrow(()=>c.requests[0].success({statusCode,data}));
  await rejected;
 }
 const c=await client(),pending=c.api.api('/profile');
 c.requests[0].success({statusCode:200,data:{data:null}});
 assert.equal(await pending,null,'an explicit null data value remains valid');
});

test('mini-program responses settle on engines without Object.hasOwn',async()=>{
 const legacyObject=new Proxy(Object,{get:(target,key)=>key==='hasOwn'?undefined:Reflect.get(target,key)});
 for(const data of [{data:{title:'首页'}},{data:null,hasOwnProperty:false},Object.assign(Object.create(null),{data:[]})]){
  const c=await client('mp-weixin',legacyObject),pending=c.api.api('/public/client/decoration');
  assert.doesNotThrow(()=>c.requests[0].success({statusCode:200,data}));
  assert.equal(await pending,data.data);
 }
 const c=await client('mp-weixin',legacyObject),pending=c.api.api('/public/client/decoration'),rejected=assert.rejects(pending,{code:'API_RESPONSE_INVALID'});
 c.requests[0].success({statusCode:200,data:Object.create({data:{}})});await rejected;
});

test('response callback exceptions reject the request instead of leaving it pending',async()=>{
 const c=await client('mp-weixin'),pending=c.api.api('/public/client/decoration'),rejected=assert.rejects(pending,{code:'API_RESPONSE_INVALID'});
 const data={get data(){throw Error('invalid response')}};
 assert.doesNotThrow(()=>c.requests[0].success({statusCode:200,data}));await rejected;
});

test('page reads have a bounded timeout and failures settle without retrying writes',async()=>{
 for(const method of ['GET','POST']){
  const c=await client('mp-weixin'),pending=c.api.api('/profile',method),rejected=assert.rejects(pending,{code:'NETWORK_UNKNOWN'});
  assert.equal(c.requests[0].timeout,method==='GET'?15000:60000);
  c.requests[0].fail({errMsg:'request:fail timeout'});await rejected;assert.equal(c.requests.length,1);
 }
});

test('a silent native bridge times out, aborts and ignores late callbacks',async()=>{
 const c=await client('mp-weixin'),pending=c.api.api('/profile'),rejected=assert.rejects(pending,{code:'NETWORK_UNKNOWN'});
 assert.equal(c.timers[0].delay,15000);c.timers[0].callback();await rejected;
 assert.equal(c.requests[0].aborted,true);assert.equal(c.timers[0].cleared,true);
 c.requests[0].success({statusCode:401,data:null});assert.equal(c.api.getToken(),'token');assert.equal(c.requests.length,1);
 const next=c.api.api('/profile');c.requests[1].success({statusCode:200,data:{data:'ready'}});assert.equal(await next,'ready');assert.equal(c.timers[1].cleared,true);
});

test('a delayed 401 only expires the original scope and authentication generation',async()=>{
 for(const change of ['tenant','application','endpoint','token','login']){
  const c=await client(),pending=c.api.api('/profile'),rejected=assert.rejects(pending,{status:401});
  if(change==='tenant')c.runtime.tenantId='beta';
  if(change==='application')c.runtime.applicationKey='other-app';
  if(change==='endpoint')c.runtime.apiBase='https://other.test/api/v1';
  if(change==='login')c.api.clearSession();
  const expected=change==='token'?'new-token':'token';
  c.storage.set(c.api.sessionStorageKey('zjz-token'),expected);
  c.requests[0].success({statusCode:401,data:{error:{code:'EXPIRED',message:'expired'}}});
  await rejected;assert.equal(c.api.getToken(),expected);
 }
 const c=await client(),pending=c.api.api('/profile'),rejected=assert.rejects(pending,{status:401});
 c.requests[0].success({statusCode:401,data:null});
 await rejected;assert.equal(c.api.getToken(),'');
});

test('public authentication failures do not expire a protected session and retain server errors',async()=>{
 const c=await client(),pending=c.api.api('/consumer/auth/login','POST'),rejected=assert.rejects(pending,{code:'LOGIN_INVALID',message:'invalid credentials',status:401});
 assert.equal(c.requests[0].header.Authorization,undefined);
 c.requests[0].success({statusCode:401,data:{error:{code:'LOGIN_INVALID',message:'invalid credentials'}}});
 await rejected;assert.equal(c.api.getToken(),'token');
});
