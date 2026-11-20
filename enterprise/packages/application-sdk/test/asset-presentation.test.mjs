import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import * as components from '../../../apps/api/src/core/decoration-components.mjs';
import * as options from '../../../apps/api/src/core/decoration-options.mjs';
import * as customer from '../../../apps/api/src/core/customer-service.mjs';
import * as framework from '../../../apps/api/src/core/decoration-framework.mjs';
import * as contract from '../../../apps/api/src/core/decoration-contract.mjs';
const {decorationBlock}=contract;

test('guest and signed-in asset entries open their own pages before authentication',async()=>{
 const {code}=await transform(await readFile(new URL('../client/lib/decoration.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}),module={exports:{}},navigations=[];
 new Function('require','module','exports','uni',code)(name=>name.includes('decoration-contract')?contract:{consumerLogin(){assert.fail('asset navigation must not redirect to login')}},module,module.exports,{navigateTo:({url})=>navigations.push(url)});
 for(const member of [null,undefined,{accountAssets:{points:12,balanceCents:3400}}]){
  for(const item of components.accountAssetItems(member,decorationBlock('assets','assets')))module.exports.navigateDecoration(item.target,'profile');
  assert.deepEqual(navigations.splice(0),['/pages/member/index','/pages/recharge/index']);
 }
});

test('editor and client pages render one joined card and restore two independent cards when disabled',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),ssr=require('vue/server-renderer');
 const empty={render:()=>null};
 async function compile(file,children={}){
  let source=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/<!-- #ifndef H5 -->[\s\S]*?<!-- #endif -->/g,'');
  if(!source.includes("from 'vue'"))source=source.replace('<script setup lang="ts">',"<script setup lang=\"ts\">\nimport {computed} from 'vue'\n");
  const {descriptor}=compiler.parse(source),script=compiler.compileScript(descriptor,{id:'merged-assets',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','image'].includes(tag)}}});
  const {code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"h5"'}}),module={exports:{}};
  new Function('require','module','exports',code)(name=>name==='vue'?vue:children[name]|| (name.includes('decoration-components')?components:name.includes('decoration-contract')?contract:name.includes('decoration-options')?options:name.includes('decoration-framework')?framework:name.includes('customer-service')?customer:empty),module,module.exports);return module.exports;
 }
 const action=await compile('../client/components/DecorationAction.vue');
 for(const client of [false,true]){
  const childName=client?'DecorationMembership':'DecorationMembershipPreview',child=await compile(client?'../client/components/'+childName+'.vue':'../../../apps/admin/app/components/console/'+childName+'.vue',{'./DecorationAction.vue':action});
  const passthrough={props:['block','member','primary','images','imageUrl','editable'],setup:props=>()=>vue.h(child.default,props)};
  const parent=await compile(client?'../client/components/DecorationPage.vue':'../../../apps/admin/app/components/console/DecorationPreview.vue',{['./'+childName+'.vue']:child,[client?'./DecorationExtra.vue':'./DecorationExtraPreview.vue']:passthrough});
  const scheme=contract.defaultDecoration(),membership=decorationBlock('membership','membership'),assets=decorationBlock('assets','assets');scheme.profile.blocks=[membership,assets];scheme.navigation.enabled=false;
  const props={scheme,page:'profile',member:{accountAssets:{points:1234,balanceCents:12345}},images:{},imageUrl:value=>value},render=()=>{const app=vue.createSSRApp(parent.default,props);app.component('UIcon',empty);return ssr.renderToString(app)};
  assets.options.assetMergeMembership=true;let html=await render();assert.equal((html.match(/class="(?:preview|diy)-block-outer\b/g)||[]).length,1);assert.equal((html.match(/class="joined-member\b/g)||[]).length,1);assert.equal((html.match(/class="account-assets\b/g)||[]).length,1);assert.match(html,/查看权益/);assert.match(html,/积分充值/);assert.match(html,/余额充值/);assert.match(html,/123\.45/);
  assert.equal((html.match(/class="asset-recharge-arrow(?: [^"]*)?"/g)||[]).length,2);
  assets.options.assetMergeMembership=false;html=await render();assert.equal((html.match(/class="(?:preview|diy)-block-outer\b/g)||[]).length,2);assert.doesNotMatch(html,/class="joined-member\b/);assert.equal((html.match(/class="asset-recharge-arrow(?: [^"]*)?"/g)||[]).length,2);
  assets.options.assetMergeMembership=true;membership.enabled=false;html=await render();assert.doesNotMatch(html,/查看权益/);assert.match(html,/积分充值/);
 }
});

test('editor and client asset renderers honor title, asset and layout switches without inventing guest balances',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),ssr=require('vue/server-renderer');
 async function compile(file){
  const source=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/<!-- #ifndef H5 -->[\s\S]*?<!-- #endif -->/g,'').replace(/<!-- #ifdef H5 -->|<!-- #endif -->/g,'');
  const {descriptor}=compiler.parse(source),script=compiler.compileScript(descriptor,{id:'contact-render',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','image'].includes(tag)}}}),{code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"h5"'}}),module={exports:{}};
  new Function('require','module','exports',code)(name=>name==='vue'?vue:customer,module,module.exports);return module.exports;
 }
 const action=await compile('../client/components/DecorationAction.vue');
 for(const file of ['../client/components/DecorationMembership.vue','../../../apps/admin/app/components/console/DecorationMembershipPreview.vue']){
  const {descriptor}=compiler.parse(await readFile(new URL(file,import.meta.url),'utf8'));
  const script=compiler.compileScript(descriptor,{id:'asset-presentation',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','image'].includes(tag)}}});
  const {code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"h5"'}}),module={exports:{}};
  new Function('require','module','exports',code)(name=>name==='vue'?vue:name.includes('DecorationAction.vue')?action:name.includes('decoration-components')?components:name.includes('decoration-options')?options:name.includes('decoration-framework')?framework:{render:()=>null},module,module.exports);
  const block=decorationBlock('assets','assets'),props={block,member:{accountAssets:{points:1234,balanceCents:12345}},primary:'#3264f5',images:{},imageUrl:value=>value};
  const render=()=>ssr.renderToString(vue.createSSRApp(module.exports.default,props));
  let html=await render();assert.match(html,/asset-layout-strip/);assert.doesNotMatch(html,/asset-heading-title/);assert.match(html,/123\.45/);assert.match(html,/asset-icon-wrap/);assert.match(html,/>积分充值</);assert.match(html,/>余额充值</);
  block.title='我的资产';block.options={assetTitle:true,assetPoints:false,assetBalance:true,assetLayout:'list',assetIcons:false};
  html=await render();assert.match(html,/我的资产/);assert.match(html,/one-asset/);assert.match(html,/asset-layout-list/);assert.doesNotMatch(html,/asset-icon-wrap/);assert.doesNotMatch(html,/积分充值/);assert.doesNotMatch(html,/asset-recharge-arrow/);
  block.options={assetTitle:false,assetPoints:true,assetBalance:false,assetLayout:'cards'};html=await render();assert.match(html,/asset-layout-cards/);assert.doesNotMatch(html,/123\.45/);assert.doesNotMatch(html,/asset-heading-title/);assert.doesNotMatch(html,/asset-recharge-arrow/);
  props.member=null;block.options={assetTitle:false,assetPoints:true,assetBalance:true};html=await render();assert.doesNotMatch(html,/class="asset-login"|登录后查看/);assert.match(html,/aria-label="积分充值，积分 0"/);assert.match(html,/aria-label="余额充值，余额（元） 0.00"/);assert.match(html,/>0<\/text>|>0<\/span>/);assert.match(html,/0\.00/);assert.equal((html.match(/<button\b/g)||[]).length,2);
  block.type='membership';block.title='会员权益';block.options={showMemberStatus:true};html=await render();assert.doesNotMatch(html,/member-tag|未登录/);assert.match(html,/会员权益/);
  props.member={level:{name:'VIP会员'}};html=await render();assert.match(html,/member-tag/);assert.match(html,/VIP会员/);

 }
});
