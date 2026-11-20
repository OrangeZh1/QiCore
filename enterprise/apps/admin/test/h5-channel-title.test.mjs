import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {TenantH5} from '../../api/src/core/tenant-h5.mjs';
import {h5PagePath} from '../../api/src/core/h5-routes.mjs';

test('H5 channel names feed runtime, first HTML, refresh and client route titles on both entry domains',async()=>{
 const scope={tenantId:'title-site',applicationKey:'system'};
 let channel=null;
 const scopedNull={findUnique:async()=>null},db={tenantConsumerSetting:scopedNull,tenantDecoration:scopedNull,tenantOfficialAccountSetting:scopedNull,tenantPolicyDocument:{findMany:async()=>[]},tenantH5Setting:{findUnique:async query=>{assert.deepEqual(query.where,{tenantId_applicationKey:scope});return channel}},tenant:{findUnique:()=>{throw Error('H5 must not read the internal tenant name')}},tenantSiteSetting:{findUnique:()=>{throw Error('H5 must not read console branding')}}};
 const h5=new TenantH5(db,{});h5.resolve=async()=>scope;
 const template='<html><head><title>旧标题</title><script id="qicore-h5-runtime" type="application/json"></script></head></html>',manifest={'/':'首页','/profile':'个人中心','/orders':'订单中心'};
 const source=await readFile(new URL('../server/utils/h5-entry.ts',import.meta.url),'utf8'),{code}=await transform(source,{loader:'ts',format:'cjs'}),output={exports:{}};
 const headers={},h3={getQuery:()=>({}),getRequestHeader:event=>event.host,setHeader:(_event,key,value)=>headers[key]=value,createError:value=>Object.assign(Error(value.statusMessage),value)};
 new Function('module','exports','require','useRuntimeConfig','$fetch',code)(output,output.exports,name=>name==='h3'?h3:{frameworkH5Asset:async file=>file==='index.html'?template:manifest},()=>({apiInternalBase:'/api/v1'}),async(_url,options)=>({data:await h5.runtime(options.query)}));
 const bootstrap=(await readFile(new URL('../../../packages/application-sdk/client/lib/h5-bootstrap.ts',import.meta.url),'utf8')).replaceAll('import.meta.env.UNI_PLATFORM',JSON.stringify('h5'));
 const clientCode=(await transform(bootstrap,{loader:'ts',format:'cjs'})).code;
 for(const value of [null,{displayName:'',favicon:null},{displayName:'证件照',favicon:'data:image/png;base64,AA=='},{displayName:'渠道 & <测试>',favicon:null}]){
  channel=value;const name=value?.displayName||'H5端';assert.equal((await h5.runtime({})).siteName,name);
  for(const tenantId of [scope.tenantId,undefined])for(const path of Object.keys(manifest))for(let refresh=0;refresh<2;refresh++){
   const html=await output.exports.h5Html({host:tenantId?'platform.example.com':'channel.example.com'},tenantId,path);
   const title=manifest[path]+' · '+name,escaped=title.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');assert.ok(html.includes('<title>'+escaped+'</title>'));
   const runtime=JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/)[1]);assert.equal(runtime.titles[path],title);assert.equal(runtime.basePath,tenantId?'/h5/title-site/':'/');assert.equal(headers['cache-control'],'no-store');assert.ok(html.includes('href="'+(value?.favicon||'data:,')+'"'));
   const client={exports:{}},interceptors={},host={__uniConfig:{router:{}},__uniRoutes:[{path:'/pages/orders/index',meta:{}}]};
   new Function('module','exports','require','window','uni',clientCode)(client,client.exports,module=>module.includes('runtime-config')?{runtimeConfig:()=>runtime}:{h5PagePath},host,{addInterceptor:(method,handler)=>interceptors[method]=handler});
   client.exports.setupH5();assert.equal(host.__uniRoutes[0].meta.navigationBar.titleText,'订单中心 · '+name);
   const update={title:'订单中心'};interceptors.setNavigationBarTitle.invoke(update);assert.equal(update.title,'订单中心 · '+name);interceptors.setNavigationBarTitle.invoke(update);assert.equal(update.title,'订单中心 · '+name);
  }
 }
});
