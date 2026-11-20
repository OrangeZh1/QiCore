import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import {runInNewContext} from 'node:vm';
const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue');

test('profile loading and failure states do not flash a page heading, while native safe area remains',async()=>{
 const compiler=require('vue/compiler-sfc'),{renderToString}=require('vue/server-renderer');
 const navigation={props:['title'],render(){return vue.h('header',{'data-navigation':''},this.title)}},pageState={props:['title','description'],render(){return vue.h('section',{},[this.title,this.description])}};
 async function compile(file,imports){
  const {descriptor}=compiler.parse(await readFile(new URL(file,import.meta.url),'utf8')),script=compiler.compileScript(descriptor,{id:'profile-heading',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['page-meta','view','text'].includes(tag)}}}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
  new Function('require','module','exports',code)(name=>name==='vue'?vue:imports[name]||{},module,module.exports);return module.exports;
 }
 for(const isH5 of [true,false]){
  const state=await compile('../client/components/ClientDecorationState.vue',{'../lib/api':{isH5},'./ClientNavigation.vue':{__esModule:true,default:navigation},'./ClientPageState.vue':{__esModule:true,default:pageState}});
  const error=vue.ref(''),data=vue.ref();
  const page=await compile('../client/pages/profile/index.vue',{'../../lib/use-decoration-page':{useDecorationPage:()=>({data,title:vue.ref('个人中心'),error,action:vue.ref('initial'),needsLogin:vue.ref(false)})},'../../lib/use-mini-ads':{useMiniAds:()=>({})},'@dcloudio/uni-app':{onShareAppMessage(){},onShareTimeline(){}},'../../components/ClientDecorationState.vue':state});
  for(const message of ['', '网络连接失败，请检查网络后重试']){
   error.value=message;const app=vue.createSSRApp(page.default);app.component('page-meta',{render:()=>null});const html=await renderToString(app);
   assert.doesNotMatch(html,/个人中心/);assert.equal(html.includes('data-navigation'),!isH5);assert.match(html,message?/页面加载失败/:/页面加载中/);
  }
  const home=await renderToString(vue.createSSRApp(state.default,{title:'首页',error:'',action:'initial',hasContent:false,needsLogin:false,navigation:true}));assert.match(home,/首页/);
 }
});

test('native decoration grouping works without Array.prototype.at',async()=>{
 const {code}=await transform(await readFile(new URL('../../../apps/api/src/core/decoration-components.mjs',import.meta.url),'utf8'),{format:'cjs'}),module={exports:{}};
 runInNewContext('Array.prototype.at=undefined;'+code,{module,exports:module.exports,require:()=>({})});
 const member={type:'membership',enabled:true},assets={type:'assets',enabled:true,options:{assetMergeMembership:true}};
 const groups=module.exports.decorationRenderGroups([member,assets]);assert.equal(groups.length,1);assert.equal(groups[0].membership,member);assert.equal(groups[0].block,assets);
});

test('runtime configuration failures end page loading and allow recovery',async()=>{
 const {code}=await transform(await readFile(new URL('../client/lib/use-decoration-page.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}),module={exports:{}};
 let invalid=true;const imports={useMaintenanceReload(){},isH5:false,decorationScope:()=>{if(invalid)throw Error('小程序发布配置无效，请从后台重新上传');return 'site-a'},loadDecoration:async()=>({scope:'site-a',scheme:{home:{title:'首页'}}}),onShow(){},onHide(){},onUnload(){},message:e=>e.message};
 new Function('require','module','exports','uni',code)(name=>name==='vue'?vue:imports,module,module.exports,{setNavigationBarTitle(){}});
 const state=module.exports.useDecorationPage('home');await state.load();assert.match(state.error.value,/发布配置无效/);assert.equal(state.action.value,'');
 invalid=false;await state.load('retry');assert.equal(state.error.value,'');assert.equal(state.data.value.scheme.home.title,'首页');
});

test('shared search accepts uni-app and native H5 input events without losing their values',async()=>{
 const source=await readFile(new URL('../client/components/ClientSearchField.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace('import.meta.env.UNI_PLATFORM',"'h5'"),{code}=await transform(script,{loader:'ts',format:'cjs'}),events=[];
 const input=new Function('require','defineOptions','defineProps','withDefaults','defineEmits',code+';return input')(require,()=>{},()=>({modelValue:''}),props=>props,()=>(...args)=>events.push(args));
 input({detail:{value:'一寸'}});input({detail:0,target:{value:'295 × 413'}});input({target:null});input({detail:{value:''},target:{value:'old'}});
 assert.deepEqual(events,[['update:modelValue','一寸'],['update:modelValue','295 × 413'],['update:modelValue',''],['update:modelValue','']]);
});

test('shared bottom navigation reads public site configuration without changing the page title or retaining a stale scope',async()=>{
 const source=await readFile(new URL('../client/components/ClientBottomNavigation.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1],{code}=await transform(script,{loader:'ts',format:'cjs'});
 let scope='first';const requests=[],navigations=[],events=[],hooks={},props={activeTarget:'records'};
 const imports={api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),isH5:true,message:e=>e.message,runtimeConfig:()=>({apiBase:'/api/v1',tenantId:'site',applicationKey:'photo'}),decorationScope:()=>scope,navigateDecoration:(...args)=>navigations.push(args),normalizeDecorationScheme:value=>value,decorationNavigation:()=>({}),decorationIcons:[],frameworkAsset:value=>value,onShow:fn=>hooks.show=fn,onHide:fn=>hooks.hide=fn,onUnload:fn=>hooks.unload=fn};
 const page=new Function('require','exports','defineProps','defineEmits','location',code+';return{load,loaded,error,loading,go}')(name=>name==='vue'?vue:imports,{},()=>props,()=>(...args)=>events.push(args),{origin:'https://client.example'});
 const data={scheme:{navigation:{enabled:true,items:[{id:'records',label:'制作记录',target:'records',builtin:'record-icon'}]}},assets:{'record-icon':{web:'/local-record.svg',client:'/static/record.svg'}},targets:[{key:'home',path:'/pages/home/index'}]};
 const loading=page.load();assert.match(requests[0].url,/^\/public\/client\/decoration\?tenantId=site&applicationKey=photo$/);await page.load();assert.equal(requests.length,1);requests.shift().resolve(data);await loading;
 assert.equal(page.loaded.value.images['record-icon'],'https://client.example/local-record.svg');page.go('records');assert.equal(navigations.length,0);page.go('home');assert.equal(navigations.length,1);assert.equal(navigations[0][1],'records');assert.equal(navigations[0][3],true);
 scope='second';const pending=page.load();assert.equal(page.loaded.value,undefined);hooks.hide();requests.shift().resolve(data);await pending;assert.equal(page.loaded.value,undefined);assert.equal(page.loading.value,false);
 props.scheme=data.scheme;hooks.show();await page.load();assert.equal(requests.length,0);page.go('home');assert.deepEqual(events,[['navigate','home',true]],'a decorated page retains scope checking and root navigation mode');
});

test('an application tab can return home through the actual navigation helper',async()=>{
 const {code}=await transform(await readFile(new URL('../client/lib/decoration.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}),module={exports:{}},visits=[];
 new Function('require','module','exports','uni',code)(()=>({decorationActions:{}}),module,module.exports,{reLaunch:({url})=>visits.push(url),navigateTo:({url})=>visits.push(url)});
 const targets=[{key:'home',path:'/pages/home/index'},{key:'catalogue',path:'/pages/catalogue/index'},{key:'records',path:'/pages/records/index'}];
 module.exports.navigateDecoration('home','catalogue',targets);module.exports.navigateDecoration('records','catalogue',targets);module.exports.navigateDecoration('catalogue','catalogue',targets);
 assert.deepEqual(visits,['/pages/home/index','/pages/records/index']);
});

test('root navigation stays at one page through repeated business tabs while details retain a back stack',async()=>{
 const {code}=await transform(await readFile(new URL('../client/lib/decoration.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}),module={exports:{}},stack=['/pages/home/index'];
 new Function('require','module','exports','uni',code)(()=>({decorationActions:{}}),module,module.exports,{reLaunch:({url})=>stack.splice(0,stack.length,url),navigateTo:({url})=>stack.push(url)});
 const targets=[{key:'home',path:'/pages/home/index'},{key:'catalogue',path:'/pages/catalogue/index'},{key:'records',path:'/pages/records/index'},{key:'detail',path:'/pages/detail/index?id=one'}];let current='home';
 for(let i=0;i<24;i++){const next=i%2?'records':'catalogue';module.exports.navigateDecoration(next,current,targets,true);current=next;assert.equal(stack.length,1)}
 module.exports.navigateDecoration('detail',current,targets);assert.equal(stack.length,2);
 module.exports.navigateDecoration({type:'url',url:'/pages/catalogue/index'},'detail',targets,true);assert.deepEqual(stack,['/pages/catalogue/index']);
 module.exports.navigateDecoration('member','catalogue',targets,true);assert.deepEqual(stack,['/pages/member/index']);
});

test('decorated pages forward root navigation without bypassing the loaded identity scope',async()=>{
 const hookCode=(await transform(await readFile(new URL('../client/lib/use-decoration-page.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'})).code,module={exports:{}},visits=[];let scope='first';
 const imports={useMaintenanceReload(){},isH5:false,runtimeConfig:()=>({}),decorationScope:()=>scope,navigateDecoration:(...args)=>visits.push(args),onShow(){},onHide(){},onUnload(){},message:e=>e.message,loadDecoration:()=>new Promise(()=>{})};
 new Function('require','module','exports',hookCode)(name=>name==='vue'?vue:imports,module,module.exports);const host=module.exports.useDecorationPage('home'),targets=[{key:'records',path:'/pages/records/index'}];host.data.value={scope,targets};
 const source=await readFile(new URL('../client/components/DecorationPage.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1],{code}=await transform(script,{loader:'ts',format:'cjs'});
 const go=new Function('require','defineProps','defineEmits',code+';return go')(name=>name==='vue'?{...vue,provide(){},onMounted(){}}:{},()=>({page:'home',targets}),()=>(_event,target,root)=>host.navigate(target,root));
 go('records',true);assert.equal(visits[0][3],true);scope='second';go('records',true);assert.equal(visits.length,1);assert.equal(host.data.value,undefined);
});

test('page background contracts keep editor and client aligned without overwriting explicit component colours',async()=>{
 const {clientPageBackground,decorationPageBackground,decorationTheme,decorationBlockStyle,decorationBlock}=await import('../../../apps/api/src/core/decoration-contract.mjs');
 const scheme={theme:{background:'#f2f8f5',surface:'#fcfcfc'},home:{inheritTheme:true,background:'#ffeecc'}};
 assert.equal(decorationPageBackground(scheme,'home'),clientPageBackground);assert.equal(decorationTheme().background,clientPageBackground);
 scheme.home.inheritTheme=false;assert.equal(decorationPageBackground(scheme,'home'),'#ffeecc');
 const block={...decorationBlock('text','custom'),inheritTheme:false,background:'#ffeedd'};block.appearance.transparent=false;assert.equal(decorationBlockStyle(block,scheme).background,'#ffeedd');block.appearance.transparent=true;assert.equal(decorationBlockStyle(block,scheme).background,'transparent');
});

test('native page scroll observations do not issue another scroll command',async()=>{
 const source=await readFile(new URL('../client/components/DecorationPage.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 const {code}=await transform(script,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"mp-weixin"'}});
 const state=new Function('require','defineProps','defineEmits',code+';return {pageScroll,scrollTarget,rememberScroll,go}')(name=>name==='vue'?{...vue,provide(){},onMounted(){}}:{},()=>({page:'home',targets:[]}),()=>()=>{});
 for(const top of [30,150,300,120,420]){state.rememberScroll({detail:{scrollTop:top}});assert.equal(state.pageScroll.value,0)}
 state.go('home');assert.equal(state.pageScroll.value,420);await vue.nextTick();assert.equal(state.pageScroll.value,0);
 state.rememberScroll({detail:{scrollTop:0}});assert.equal(state.pageScroll.value,0);
});

test('decoration read failures use page copy and preserve content and retry state',async()=>{
 const {code}=await transform(await readFile(new URL('../client/lib/use-decoration-page.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}),module={exports:{}},pending=[];
 const imports={useMaintenanceReload(){},isH5:false,decorationScope:()=> 'site-a',loadDecoration:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),onShow(){},onHide(){},onUnload(){},message:error=>error.message};
 new Function('require','module','exports','uni',code)(name=>name==='vue'?vue:imports,module,module.exports,{setNavigationBarTitle(){}});
 const state=module.exports.useDecorationPage('home'),network=Object.assign(Error('已有任务、订单或解锁请先查状态再重试'),{code:'NETWORK_UNKNOWN',status:0});
 const first=state.load();pending.shift().reject(network);await first;
 assert.equal(state.error.value,'网络连接失败，请检查网络后重试');assert.equal(state.data.value,undefined);
 const retry=state.load('retry');assert.equal(state.action.value,'retry');assert.equal(state.error.value,'网络连接失败，请检查网络后重试');
 pending.shift().resolve({scope:'site-a',scheme:{home:{title:'首页'}}});await retry;assert.equal(state.error.value,'');assert.equal(state.action.value,'');
 const refresh=state.load('background');pending.shift().reject(network);await refresh;assert.equal(state.data.value.scheme.home.title,'首页');
 const again=state.load('retry');assert.equal(state.action.value,'retry');assert.equal(state.data.value.scheme.home.title,'首页');pending.shift().reject(Object.assign(Error('invalid body'),{code:'API_RESPONSE_INVALID'}));await again;
 assert.equal(state.error.value,'页面暂时无法加载，请稍后重试');assert.equal(state.action.value,'');
 const denied=state.load();pending.shift().reject(Object.assign(Error('请重新登录'),{status:401}));await denied;
 assert.equal(state.data.value,undefined);assert.equal(state.needsLogin.value,true);assert.equal(state.error.value,'请重新登录');
});

test('the theme editor shows the shared page colour as read-only even for a saved legacy theme',async()=>{
 const compiler=require('vue/compiler-sfc'),{renderToString}=require('vue/server-renderer'),contract=await import('../../../apps/api/src/core/decoration-contract.mjs');
 async function component(name,imports={}){
  const source=await readFile(new URL('../../../apps/admin/app/components/console/'+name+'.vue',import.meta.url),'utf8'),{descriptor}=compiler.parse(source),script=compiler.compileScript(descriptor,{id:name,inlineTemplate:true}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
  new Function('require','module','exports',code)(key=>key==='vue'?vue:key.endsWith('decoration-contract.mjs')?contract:imports[key],module,module.exports);return module.exports.default;
 }
 const colour=await component('DecorationColorField'),panel=await component('DecorationThemePanel',{'./DecorationColorField.vue':{__esModule:true,default:colour}}),app=vue.createSSRApp(panel,{modelValue:contract.decorationTheme({theme:{background:'#f2f8f5'}})});
 app.component('UButton',{render(){return vue.h('button',{},this.$slots.default?.())}});
 const html=await renderToString(app),fields=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).filter(tag=>tag.includes('aria-label="页面背景'));
 assert.equal(fields.length,2);assert.ok(fields.every(tag=>/\bdisabled\b/.test(tag)&&tag.includes('value="#f3f9ff"')));
});

test('the compact header search uses actual capsule height, center and an eight-pixel horizontal gap',async()=>{
 const geometry={exports:{}},{code:geometryCode}=await transform(await readFile(new URL('../client/lib/navigation-layout.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'});
 new Function('module','exports',geometryCode)(geometry,geometry.exports);
 const source=await readFile(new URL('../client/components/DecorationPageHeader.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1],{code}=await transform(script,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"mp-weixin"'}});
 for(const [window,menu] of [
  [{windowWidth:393,statusBarHeight:59},{width:87,height:32,left:296,top:64}],
  [{windowWidth:320,statusBarHeight:20},{width:87,height:32,left:226,top:24}],
  [{windowWidth:430,statusBarHeight:24},{width:87,height:34,left:334,top:29}],
 ]){
  const imports={...geometry.exports,decorationHeader:p=>p.header};
  const result=new Function('require','exports','defineProps','defineEmits','uni',code+';return{layout,searchStyle,brandStyle}')(name=>name==='vue'?{...vue,onMounted(){},onBeforeUnmount(){}}:imports,{},()=>({page:{header:{mode:'search',brandName:'证件照制作',subtitle:'多种规格'}}}),()=>()=>{},{getWindowInfo:()=>window,getMenuButtonBoundingClientRect:()=>menu});
  const layout=result.layout.value,style=result.searchStyle.value;
  assert.equal(style['--client-search-height'],menu.height+'px');assert.equal(Number.parseFloat(style.marginTop)+layout.statusBar,menu.top);
  assert.equal(window.windowWidth-layout.rightSpace,menu.left-8);
  const shift=Number.parseFloat(result.brandStyle.value.transform.slice('translateY('.length));
  assert.equal(layout.statusBar+layout.rowHeight/2+shift,menu.top+menu.height/2);
 }
});

 test('personal route keeps the native bar while H5 supplies its own navigation',async()=>{
  const pages=JSON.parse(await readFile(new URL('../../../apps/client/src/pages.json',import.meta.url),'utf8'));
  const personal=pages.pages.find(page=>page.path==='pages/personal/index');assert.equal(personal.style.navigationStyle,'default');assert.equal(personal.style.h5.navigationStyle,'custom');
 });
