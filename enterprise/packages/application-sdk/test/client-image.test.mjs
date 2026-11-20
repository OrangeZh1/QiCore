import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
import * as components from '../../../apps/api/src/core/decoration-components.mjs';
import * as options from '../../../apps/api/src/core/decoration-options.mjs';
import * as framework from '../../../apps/api/src/core/decoration-framework.mjs';
import {decorationBlock} from '../../../apps/api/src/core/decoration-contract.mjs';
import {consumerAuthAppearance} from '../../../apps/api/src/core/consumer-auth-appearance.mjs';

async function runtime(platform='mp-weixin'){
 const source=(await readFile(new URL('../client/lib/runtime-config.ts',import.meta.url),'utf8')).replaceAll('import.meta.env','ENV');
 const {code}=await transform(source,{loader:'ts',format:'cjs'}),module={exports:{}};
 const env={UNI_PLATFORM:platform,DEV:false},settings={apiDomain:'https://api.example.com',siteId:'site-a',appId:'wx1234567890abcdef'};
 const uni={getAccountInfoSync:()=>({miniProgram:{appId:settings.appId}}),getFileSystemManager:()=>({readFileSync:()=>JSON.stringify(settings)})};
 const document={getElementById:()=>({textContent:JSON.stringify({apiBase:'/api/v1',tenantId:'site-a',applicationKey:'test-app',basePath:'/h5/site-a/'})})};
 new Function('module','exports','ENV','uni','document','__QICORE_APPLICATION_KEY__',code)(module,module.exports,env,uni,document,'test-app');
 return {api:module.exports,settings,env};
}
const reference='/api/v1/public/site-assets/11111111-1111-4111-8111-111111111111';

test('server image references use the current API domain while H5, cloud and local image sources keep their meaning',async()=>{
 const mini=await runtime();assert.equal(mini.api.clientImageUrl(reference),'https://api.example.com'+reference);
 mini.settings.apiDomain='https://other.example.com/';assert.equal(mini.api.clientImageUrl(reference),'https://other.example.com'+reference);
 mini.env.DEV=true;mini.env.VITE_API_BASE='http://127.0.0.1:3500/api/v1/';assert.equal(mini.api.clientImageUrl(reference),'http://127.0.0.1:3500'+reference);
 const h5=await runtime('h5');assert.equal(h5.api.clientImageUrl(reference),reference);
 for(const value of ['https://cdn.example.com/avatar.webp','data:image/png;base64,AA==','wxfile://tmp/avatar.png','/static/avatar.webp','blob:https://client.example.com/image'])assert.equal(mini.api.clientImageUrl(value),value);
 assert.equal(mini.api.clientImageUrl(null),'');assert.equal(mini.api.clientImageUrl(undefined),'');
});

test('decoration renders stored and default avatars as usable mini-program URLs without rewriting their saved references',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),ssr=require('vue/server-renderer');
 const {api}=await runtime(),{descriptor}=compiler.parse(await readFile(new URL('../client/components/DecorationProfile.vue',import.meta.url),'utf8'));
 const script=compiler.compileScript(descriptor,{id:'stored-avatar',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','image'].includes(tag)}}});
 const {code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"mp-weixin"'}}),module={exports:{}};
 const Action={setup(_props,{slots}){return()=>vue.h('view',slots.default?.())}};
 new Function('require','module','exports',code)(name=>name==='vue'?vue:name.includes('runtime-config')?api:name.includes('decoration-components')?components:name.includes('decoration-options')?options:name.includes('decoration-framework')?framework:Action,module,module.exports);
 for(const profile of [{nickname:'用户',avatar:reference},{nickname:'用户',avatar:null,defaultAvatar:reference}]){
  const original=structuredClone(profile),html=await ssr.renderToString(vue.createSSRApp(module.exports.default,{block:decorationBlock('profile','avatar'),profile,images:{}}));
  assert.ok(html.includes('src="https://api.example.com'+reference+'"'));assert.deepEqual(profile,original,'rendering must not change the reference sent back by profile forms');
 }
 const visitor=await ssr.renderToString(vue.createSSRApp(module.exports.default,{block:decorationBlock('profile','avatar'),profile:null,defaultAvatar:reference,images:{}}));assert.ok(visitor.includes('src="https://api.example.com'+reference+'"'));assert.ok(visitor.includes('点击登录'));assert.ok(!visitor.includes('普通会员'));
 const own=await ssr.renderToString(vue.createSSRApp(module.exports.default,{block:decorationBlock('profile','avatar'),profile:{nickname:'用户',avatar:'https://cdn.example.com/own.png'},defaultAvatar:reference,images:{}}));assert.ok(own.includes('src="https://cdn.example.com/own.png"'));
});

test('packaged default artwork uses uploadable PNG with the existing image design and transparent avatar',async()=>{
 const sharp=createRequire(new URL('../../../apps/api/package.json',import.meta.url))('sharp');
 for(const [name,width] of [['avatar',256],['intro',512]]){
  const file=new URL('../client/static/decoration/framework/'+name+'.png',import.meta.url),bytes=await readFile(file),metadata=await sharp(bytes).metadata();
  assert.equal(metadata.format,'png');assert.equal(metadata.width,width);if(name==='avatar')assert.equal(metadata.hasAlpha,true);
  const source=await sharp(fileURLToPath(new URL('../../../apps/admin/public/decoration/framework/'+name+'.webp',import.meta.url))).resize({width}).flatten({background:'#f3f9ff'}).raw().toBuffer();
  const derived=await sharp(bytes).flatten({background:'#f3f9ff'}).raw().toBuffer();assert.equal(derived.length,source.length);
  const difference=derived.reduce((total,value,index)=>total+Math.abs(value-source[index]),0)/derived.length;assert.ok(difference<5,'PNG must retain the existing artwork, not replace it');
  assert.equal(framework.frameworkAsset(name+'.webp',true),'/static/decoration/framework/'+name+'.png');assert.equal(framework.frameworkAsset(name+'.webp'),'/decoration/framework/'+name+'.webp');
 }
});

test('decoration avatar failure falls back only for the current source and never changes the stored profile',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),{api}=await runtime();
 const {descriptor}=compiler.parse(await readFile(new URL('../client/components/DecorationProfile.vue',import.meta.url),'utf8')),script=compiler.compileScript(descriptor,{id:'avatar-fallback'}),module={exports:{}};
 const {code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"mp-weixin"'}});
 new Function('require','module','exports',code)(name=>name==='vue'?vue:name.includes('runtime-config')?api:name.includes('decoration-components')?components:name.includes('decoration-options')?options:name.includes('decoration-framework')?framework:{},module,module.exports);
 const props=vue.reactive({block:decorationBlock('profile','avatar'),profile:null,images:{}}),scope=vue.effectScope();
 try{const state=scope.run(()=>module.exports.default.setup(props,{expose(){}}));assert.equal(state.avatar.value,'/static/decoration/framework/avatar.png');props.profile={nickname:'用户',avatar:reference};await vue.nextTick();const src=state.avatar.value;
  state.avatarFailed({currentTarget:{dataset:{avatarSource:'previous'}}});assert.equal(state.avatar.value,src);state.avatarFailed({currentTarget:{dataset:{avatarSource:src}}});assert.equal(state.avatar.value,'/static/decoration/framework/avatar.png');assert.equal(props.profile.avatar,reference);
  props.profile={nickname:'另一用户',avatar:'https://cdn.example.com/new.png'};await vue.nextTick();assert.equal(state.avatar.value,'https://cdn.example.com/new.png');
 }finally{scope.stop()}
});

test('login backgrounds and rich text resolve stored image references without rewriting content',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),ssr=require('vue/server-renderer');
 const {api}=await runtime(),settings={...api.runtimeConfig(),registration:{passwordLoginEnabled:true,smsLoginEnabled:true,appearance:{image:reference}}};
 const {descriptor}=compiler.parse(await readFile(new URL('../client/pages/login/index.vue',import.meta.url),'utf8'));
 const script=compiler.compileScript(descriptor,{id:'login-stored-image',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','image','scroll-view','page-meta'].includes(tag)}}});
 const {code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
 const Empty={render:()=>null};
 new Function('require','module','exports','setInterval','clearInterval',code)(name=>name==='vue'?vue:name==='@dcloudio/uni-app'?{onLoad(){}}:name.includes('runtime-config')?{...api,runtimeConfig:()=>settings}:name.includes('consumer-auth-appearance')?{consumerAuthAppearance}:name.includes('decoration-framework')?framework:name.endsWith('/api')?{isH5:false}:name.endsWith('.vue')?Empty:{},module,module.exports,()=>1,()=>{});
 const rendered=await ssr.renderToString(vue.createSSRApp(module.exports.default));
 assert.match(rendered,/一键登录/);assert.match(rendered,/其他登录方式/);assert.match(rendered,/账号密码登录/);assert.match(rendered,/手机验证码登录/);assert.doesNotMatch(rendered,/role="tab"/,'native one-click login is the primary entry, with alternate methods below it');
 assert.match(rendered,/<image[^>]*class="auth-hero-image"[^>]*src="https:\/\/api\.example\.com/);assert.ok(rendered.includes('src="https://api.example.com'+reference+'"'));assert.equal(settings.registration.appearance.image,reference);
 const parserSource=await readFile(new URL('../../../apps/client/node_modules/mp-html/dist/uni-app/components/mp-html/parser.js',import.meta.url),'utf8');
 const parserCode=(await transform(parserSource,{loader:'js',format:'cjs'})).code,parserModule={exports:{}};
 new Function('module','exports','uni','wx',parserCode)(parserModule,parserModule.exports,{getSystemInfoSync:()=>({windowWidth:375}),canIUse:()=>false},{getSystemInfoSync:()=>({windowWidth:375}),canIUse:()=>false});
 const resolve=value=>parserModule.exports.default.prototype.getUrl.call({options:{domain:api.clientImageDomain()}},value);
 assert.equal(resolve(reference),'https://api.example.com'+reference);
 for(const value of ['https://cdn.example.com/image.webp','data:image/png;base64,AA=='])assert.equal(resolve(value),value);
 assert.equal((await runtime('h5')).api.clientImageDomain(),'');
 for(const page of ['policy/index','help/index','help/detail']){
  const source=await readFile(new URL('../client/pages/'+page+'.vue',import.meta.url),'utf8');
  assert.match(source,/<mp-html[^>]*:domain="clientImageDomain\(\)"/,page+' must pass the runtime domain into the actual rich-text renderer');
 }
});
