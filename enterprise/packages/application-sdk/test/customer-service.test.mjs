import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import * as customer from '../../../apps/api/src/core/customer-service.mjs';
import {decorationTargets} from '../../../apps/api/src/core/decoration-contract.mjs';
import {normalizeDecorationLink} from '../../../apps/api/src/core/decoration-links.mjs';

test('native contact is selected only by configured WeChat buttons; H5 and normal routes still navigate',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const {descriptor}=compiler.parse(await readFile(new URL('../client/components/DecorationAction.vue',import.meta.url),'utf8'));
 const settings=vue.ref({...customer.customerServiceDefaults(),miniMode:'official'}),script=compiler.compileScript(descriptor,{id:'contact-action'}),{code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"mp-weixin"'}}),module={exports:{}},events=[];
 const attrs={};new Function('require','module','exports',code)(name=>name==='vue'?{...vue,inject:()=>settings,useAttrs:()=>attrs}:customer,module,module.exports);
 const state=module.exports.default.setup({target:'system:contact'},{expose(){},emit:()=>events.push('navigate')});
 assert.equal(state.openType.value,'contact');state.click({});assert.deepEqual(events,[]);settings.value.miniMode='page';assert.equal(state.openType.value,undefined);state.click({});assert.deepEqual(events,['navigate']);state.keyboard({});assert.equal(events.length,2);attrs.onKeydown=()=>{};state.keyboard({});assert.equal(events.length,2);
 assert.equal(customer.customerServiceOpenType('system:contact',{miniMode:'official'},'h5'),undefined);assert.equal(customer.customerServiceOpenType('help',{miniMode:'official'},'mp-weixin'),undefined);
 for(const key of ['system:contact','system:orders','system:growth-records','system:points-records','system:balance-records','system:privacy','system:terms','login']){const route=decorationTargets.find(route=>route.key===key);assert.ok(route?.path);assert.equal(normalizeDecorationLink(key,decorationTargets),key)}
});

test('web navigation shares safe top spacing while native navigation follows the status bar and capsule',async()=>{
 const source=await readFile(new URL('../client/lib/navigation-layout.ts',import.meta.url),'utf8'),{code}=await transform(source,{loader:'ts',format:'cjs'}),module={exports:{}};new Function('module','exports',code)(module,module.exports);
 const {navigationLayout,navigationFrame}=module.exports,web=navigationFrame(navigationLayout(),true);assert.match(web.paddingTop,/var\(--client-navigation-top, 12px\)/);assert.match(web.height,/44px \+ var\(--client-navigation-top, 12px\)/);assert.match(web.paddingTop,/safe-area-inset-top/);assert.match(web.height,/safe-area-inset-top/);
 const native=navigationLayout({windowWidth:390,statusBarHeight:44},{top:48,left:290,width:88,height:32});assert.deepEqual(navigationFrame(native),{paddingTop:'44px',height:'88px'});assert.equal(native.rightSpace,108);
});

test('contact page requests public scoped data and discards late clipboard results after changing sites',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),runtime={apiBase:'/api/v1',tenantId:'tenant-a',applicationKey:'app-a'},requests=[],copies=[];
 const bridge={useMaintenanceReload(){},runtimeConfig:()=>runtime,api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject})),message:e=>e.message,isH5:true,frameworkAsset:path=>path,onShow(){},onUnload(){}};
 const {descriptor}=compiler.parse(await readFile(new URL('../client/pages/contact/index.vue',import.meta.url),'utf8')),script=compiler.compileScript(descriptor,{id:'contact-state'}),{code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"h5"'}}),module={exports:{}};
 new Function('require','module','exports','uni',code)(name=>name==='vue'?vue:bridge,module,module.exports,{setClipboardData:options=>copies.push(options)});
 const state=module.exports.default.setup({},{expose(){}}),first=state.load();assert.equal(state.action.value,'initial');assert.match(requests[0].path,/^\/public\/client\/customer-service\?tenantId=tenant-a&applicationKey=app-a$/);requests[0].resolve({...customer.customerServiceDefaults(),wechat:'support'});await first;
 const reread=state.load('refresh');assert.equal(state.data.value.wechat,'support');requests.at(-1).reject(Error('temporary'));await reread;assert.equal(state.data.value.wechat,'support');const rereadRetry=state.load('retry');assert.equal(state.error.value,'temporary');assert.equal(state.data.value.wechat,'support');requests.at(-1).resolve({...customer.customerServiceDefaults(),wechat:'support'});await rereadRetry;assert.equal(state.error.value,'');
 const copying=state.copy();assert.equal(state.copying.value,true);assert.equal(state.action.value,'');
 runtime.tenantId='tenant-b';const retry=state.load('retry');assert.equal(state.data.value,null);assert.equal(state.copying.value,false);assert.equal(state.action.value,'retry');copies[0].fail(Error('late'));await copying;assert.equal(state.copyError.value,'');requests.at(-1).reject(Error('network'));await retry;assert.equal(state.action.value,'');assert.equal(state.error.value,'network');
});
