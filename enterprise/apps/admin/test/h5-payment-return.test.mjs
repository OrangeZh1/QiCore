import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {PaymentExecution} from '../../api/src/payments/execution.mjs';
import {h5PagePath} from '../../api/src/core/h5-routes.mjs';

test('WeChat H5 return URLs resolve platform and custom-domain order pages with their initial title',async t=>{
 const previous=process.env.PUBLIC_ADMIN_ORIGIN;process.env.PUBLIC_ADMIN_ORIGIN='https://platform.example.com';
 t.after(()=>{if(previous===undefined)delete process.env.PUBLIC_ADMIN_ORIGIN;else process.env.PUBLIC_ADMIN_ORIGIN=previous});
 const identity={tenantId:'site-a',applicationKey:'app-a'},checks=[],engine=Object.create(PaymentExecution.prototype);
 engine.h5={resolve:async value=>{checks.push(value);if(value.host==='unbound.example.com')throw Error('unbound');return identity}};
 const {code}=await transform(await readFile(new URL('../server/utils/h5-entry.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}),module={exports:{}};
 const manifest={[h5PagePath('/pages/orders/index')]:'订单中心'},template='<html><head><title>旧标题</title><script id="qicore-h5-runtime" type="application/json"></script></head></html>';
 const h3={getQuery:event=>Object.fromEntries(event.url.searchParams),getRequestHeader:event=>event.url.host,setHeader(){},createError:value=>Object.assign(Error(value.statusMessage),value)};
 new Function('module','exports','require','useRuntimeConfig','$fetch','useStorage','process',code)(module,module.exports,name=>name==='h3'?h3:{},()=>({apiInternalBase:'/api/v1'}),async()=>({data:{...identity,siteName:'测试站点',homeTitle:'首页',profileTitle:'个人中心'}}),()=>({getItem:async key=>key==='h5-routes.json'?manifest:template}),{env:{}});
 for(const host of ['platform.example.com','store.example.com']){
  const context=await engine.h5Context(identity,{origin:'https://'+host,ip:'::ffff:127.0.0.1'});
  context.returnUrl+='&orderId=order-123';
  const redirect=new URL(engine.h5Redirect('https://wx.tenpay.com/cashier?token=fixture',context.returnUrl)),url=new URL(redirect.searchParams.get('redirect_url'));
  const platform=host==='platform.example.com';assert.equal(url.pathname,platform?'/h5/site-a/orders':'/orders');assert.equal(url.searchParams.get('orderId'),'order-123');assert.equal(url.searchParams.get('application'),'app-a');
  const path=platform?url.pathname.slice('/h5/site-a'.length):url.pathname;
  for(let refresh=0;refresh<2;refresh++){
   const html=await module.exports.h5Html({url},platform?'site-a':undefined,path);assert.match(html,/<title>订单中心 · 测试站点<\/title>/);
   const runtime=JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/)[1]);assert.equal(runtime.basePath,platform?'/h5/site-a/':'/');assert.equal(runtime.titles['/orders'],'订单中心 · 测试站点');
  }
 }
 assert.deepEqual(checks.slice(0,2),['platform.example.com','store.example.com'].map(host=>({host,...identity})));
 await assert.rejects(engine.h5Context(identity,{origin:'https://unbound.example.com',ip:'127.0.0.1'}),/unbound/);
 for(const origin of ['http://store.example.com','https://user@store.example.com','https://store.example.com/other','https://store.example.com/?redirect=evil'])await assert.rejects(engine.h5Context(identity,{origin,ip:'127.0.0.1'}),{code:'PAYMENT_ORIGIN_INVALID'});
 assert.throws(()=>engine.h5Redirect('https://untrusted.example.com', 'https://store.example.com/orders'),{code:'PAYMENT_RESPONSE_INVALID'});
});
