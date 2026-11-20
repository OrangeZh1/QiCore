import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
import * as renderContext from '../app/utils/console-render-context.ts';

async function client({hydrating=false,serverRendered=false,server=false,request,applicationKey}={}){
 const source=(await readFile(new URL('../app/composables/useApi.ts',import.meta.url),'utf8')).replaceAll('import.meta.server',String(server));
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const states=new Map(),pending=[],output={};
 const useState=(key,init)=>{if(!states.has(key))states.set(key,vue.ref(init()));return states.get(key)};
 const fetch=(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}));
 const nuxt={isHydrating:hydrating,payload:{serverRendered}};
 new Function('exports','useState','useRuntimeConfig','useNuxtApp','computed','$fetch','require','useRequestEvent','useRequestHeaders',code)(output,useState,()=>({apiInternalBase:'/api/v1',public:{apiBase:'/api/v1',nativeApplication:applicationKey?{key:applicationKey}:undefined}}),()=>nuxt,vue.computed,fetch,()=>renderContext,()=>({node:{req:request}}),()=>({}));
 return {auth:output.useApi(),second:output.useApi(),tenant:output.useApi('tenant'),pending,nuxt};
}

test('hydration reuses this document\'s verified session, but subsequent navigation still revalidates it',async()=>{
 for(const portal of ['admin','tenant']){
  const c=await client({hydrating:true,serverRendered:true}),auth=portal==='admin'?c.auth:c.tenant;
  auth.session.value={id:'current',role:portal==='admin'?'root':'tenant',expiresAt:'2099-01-01T00:00:00Z'};
  const first=auth.restore();assert.equal(c.pending.length,0,'hydration must not repeat /auth/me');assert.equal((await first).id,'current');
  c.nuxt.isHydrating=false;const next=auth.restore();assert.equal(c.pending.length,1,'later navigation must check current authorization');
  c.pending.shift().reject({status:401});assert.equal(await next,null);
 }
});

test('embedded SSR consumes only its own verified dispatch reads; business APIs and clients still fetch',async()=>{
 const session={id:'owner',role:'tenant',expiresAt:'2099-01-01',tenantIds:['alpha']},tenant={id:'alpha',enabled:true,expiresAt:null};
 const entry={tenant,applications:[{key:'example',state:'available',consoleRoutes:[{path:'/tenant/example'}]}]};
 const request={method:'GET',url:'/tenant/example',[renderContext.consoleRenderContext]:{applicationKey:'example',path:'/tenant/example',session,entry}};
 const c=await client({server:true,request,applicationKey:'example'});
 assert.equal((await c.tenant.restore()).id,'owner');assert.equal((await c.tenant.api('/admin/tenant-entry?tenantId=alpha')).tenant.id,'alpha');assert.equal(c.pending.length,0);
 for(const [auth,url,method] of [[c.tenant,'/admin/tenants/alpha/consumers','GET'],[c.auth,'/admin/auth/me','GET'],[c.tenant,'/admin/auth/me','POST']]){
  const pending=auth.api(url,method);assert.equal(c.pending.length,1);c.pending.shift().resolve({data:{fresh:true}});assert.deepEqual(await pending,{fresh:true});
 }
 const browser=await client({request,applicationKey:'example'}),pending=browser.tenant.restore();assert.equal(browser.pending.length,1);browser.pending.shift().resolve({data:session});await pending;
});

test('expired, missing, wrong-portal and client-only sessions cannot use the hydration shortcut',async()=>{
 for(const change of [c=>c.auth.session.value=null,c=>c.auth.session.value.expiresAt='2000-01-01',c=>c.auth.session.value.role='tenant',c=>c.nuxt.payload.serverRendered=false]){
  const c=await client({hydrating:true,serverRendered:true});c.auth.session.value={id:'old',role:'root',expiresAt:'2099-01-01'};change(c);
  const result=c.auth.restore();assert.equal(c.pending.length,1);c.pending.shift().resolve({data:{id:'fresh'}});assert.equal((await result).id,'fresh');
 }
});

test('SSR layout and page share a verified session while another request must authenticate independently',async()=>{
 for(const portal of ['admin','tenant']){
  const c=await client({server:true}),auth=portal==='admin'?c.auth:c.tenant;
  const first=auth.restore();assert.equal(c.pending.length,1);c.pending.shift().resolve({data:{id:'current',role:portal==='admin'?'root':'tenant',expiresAt:'2099-01-01'}});await first;
  assert.equal((await auth.restore()).id,'current');assert.equal(c.pending.length,0);
  const other=await client({server:true}),restore=(portal==='admin'?other.auth:other.tenant).restore();assert.equal(other.pending.length,1);other.pending.shift().reject({status:401});assert.equal(await restore,null);
  auth.session.value={...auth.session.value,expiresAt:'2000-01-01'};const expired=auth.restore();assert.equal(c.pending.length,1);c.pending.shift().reject({status:401});assert.equal(await expired,null);
 }
});

test('platform and tenant storage connection tests get the same long timeout without extending ordinary reads',async()=>{
 const c=await client();
 for(const [auth,prefix] of [[c.auth,'/admin/storage'],[c.tenant,'/admin/tenants/site-a/storage']]){
  for(const provider of ['local','qiniu','oss','cos']){
   const controller=new AbortController(),result=auth.api(prefix+'/'+provider+'/test','POST',{}, {signal:controller.signal}),request=c.pending.shift();
   assert.equal(request.options.timeout,120000);assert.equal(request.options.signal,controller.signal);request.resolve({data:{status:'passed'}});assert.deepEqual(await result,{status:'passed'});
  }
  const result=auth.api(prefix),request=c.pending.shift();assert.equal(request.options.timeout,8000);request.resolve({data:{}});await result;
 }
});

test('an old console request cannot expire a later login, but a matching 401 still expires it',async()=>{
 const c=await client();c.auth.session.value={id:'old'};
 const old=c.auth.api('/admin/example'),rejected=assert.rejects(old,{status:401});
 c.second.session.value={id:'new'};c.pending.shift().reject({status:401});await rejected;
 assert.equal(c.auth.session.value.id,'new');
 const current=c.auth.api('/admin/example'),expired=assert.rejects(current,{status:401});
 c.pending.shift().reject({status:401});await expired;assert.equal(c.auth.session.value,null);
});

test('late session restoration cannot replace or clear a newer login',async()=>{
 for(const failure of [false,true]){
  const c=await client(),restore=c.auth.restore();
  c.second.session.value={id:'new'};
  const pending=c.pending.shift();if(failure)pending.reject({status:401});else pending.resolve({data:{id:'old'}});
  await restore;assert.equal(c.auth.session.value.id,'new');
 }
});

test('restoration started while signed out cannot undo a later explicit sign out',async()=>{
 const c=await client(),restore=c.auth.restore();
 c.second.session.value=null;
 c.pending.shift().resolve({data:{id:'old'}});
 await restore;assert.equal(c.auth.session.value,null);
});

test('an aborted console read does not clear the active session',async()=>{
 const c=await client();c.auth.session.value={id:'current'};
 const controller=new AbortController(),pending=c.auth.api('/admin/example','GET',undefined,{signal:controller.signal}),rejected=assert.rejects(pending);
 controller.abort();c.pending.shift().reject({status:401});await rejected;
 assert.equal(c.auth.session.value.id,'current');
});
