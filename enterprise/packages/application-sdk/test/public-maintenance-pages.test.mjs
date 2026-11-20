import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import {readLoadedPages} from '../client/lib/read-loaded-pages.ts';
const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
async function page(file,extra={},props={}){
 let recovery;const calls=[],bridge={isH5:false,isClientPreview:false,isSignedOut:()=>false,message:e=>e.message,getToken:()=> 'token',identityScope:()=> 'site:system:user',consumerScope:()=> 'site:system:user',consumerReady:async()=>true,ensureSession:async()=>{},runtimeConfig:()=>({apiBase:'/api/v1',tenantId:'site',applicationKey:'system'}),frameworkAsset:name=>'/'+name,profileAvatar:()=>'',onShow(){},onHide(){},onUnload(){},onLoad(){},readLoadedPages,useMaintenanceReload:fn=>recovery=fn,api:async(path,method='GET')=>{calls.push({path,method});return {}},...extra};
 const {descriptor}=compiler.parse(await readFile(new URL('../client/'+file,import.meta.url),'utf8')),script=compiler.compileScript(descriptor,{id:'public-maintenance'}),{code}=await transform(script.content,{loader:'ts',format:'cjs',define:{'import.meta.env.UNI_PLATFORM':'"h5"'}}),module={exports:{}};
 new Function('require','module','exports','uni',code)(name=>name==='vue'?{...vue,onMounted(){},onBeforeUnmount(){},getCurrentInstance:()=>null}:bridge,module,module.exports,{getStorageSync(){},disableAlertBeforeUnload(){}});
 const state=module.exports.default.setup(props,{expose(){},emit(){}});return{state,calls,bridge,recover:()=>recovery()};
}
test('loaded-page refresh is atomic, bounded to the loaded range, deduplicates moved rows and respects cancellation',async()=>{
 const requests=[];const value=await readLoadedPages(async page=>{requests.push(page);return {page,pageSize:2,total:9,items:page===1?[{id:'a'},{id:'b'}]:[{id:'b'},{id:'c'}]}},2,()=>true);assert.deepEqual(requests,[1,2]);assert.deepEqual(value.items.map(item=>item.id),['a','b','c']);assert.equal(value.page,2);
 assert.equal(await readLoadedPages(async()=>({page:1,pageSize:20,total:1,items:[{id:'a'}]}),2,()=>false),null);
 await assert.rejects(readLoadedPages(async page=>{if(page===2)throw Error('offline');return{page,pageSize:1,total:2,items:[{id:'a'}]}},2,()=>true),/offline/);
});
test('help recovery retains category, loaded range and expanded answer while rereading only that range',async()=>{
 const calls=[];let generation=0;const f=await page('pages/help/index.vue',{helpEndpoint:()=> 'site',loadHelp:async q=>{calls.push(q);return{page:q.page,pageSize:1,total:2,categories:[{id:'category',name:'分类'}],items:[{id:'article-'+q.page,title:'标题 '+generation}]}},loadHelpArticle:async id=>({id,content:'新答案 '+generation})});
 await f.state.load();f.state.category.value='category';await f.state.load('more',2);f.state.expanded.value='article-2';f.state.answers.value={'article-2':'旧答案'};calls.length=0;generation=1;await f.recover();assert.deepEqual(calls.map(q=>q.page),[1,2]);assert.ok(calls.every(q=>q.categoryId==='category'));assert.equal(f.state.category.value,'category');assert.equal(f.state.data.value.page,2);assert.equal(f.state.data.value.items.length,2);assert.equal(f.state.expanded.value,'article-2');assert.equal(f.state.answers.value['article-2'],'新答案 1');
});
test('growth and asset records retain filters, loaded range and selected detail without appending duplicate pages',async()=>{
 for(const kind of ['growth','assets']){
  const calls=[];let generation=0;const f=await page(kind==='growth'?'pages/growth-records/index.vue':'components/ClientAssetRecords.vue',{api:async(path,method='GET')=>{calls.push({path,method});if(path==='/growth-records/entry-2')return{id:'entry-2',reason:'new detail'};const n=Number(new URL(path,'http://test').searchParams.get('page'));return{growth:100,current:{id:'level'},page:n,pageSize:1,total:2,items:[{id:'entry-'+n,kind:'spend',delta:100+generation,reason:'generation '+generation}]}}},kind==='assets'?{kind:'balance'}:{});
  await f.state.load();if(kind==='growth')f.state.tab.value='levels';else f.state.filter.value='spend';await f.state.load('more',2);f.state.selected.value={id:'entry-2'};if(kind==='growth')f.state.detailTarget.value='entry-2';calls.length=0;generation=1;await f.recover();
  const rows=kind==='growth'?f.state.data.value.items:f.state.rows.value;assert.deepEqual(rows.map(item=>item.id),['entry-1','entry-2']);assert.equal(f.state.selected.value.id,'entry-2');assert.ok(calls.every(c=>c.method==='GET'));assert.ok(calls.some(c=>c.path.includes('page=2')));assert.equal(kind==='growth'?f.state.tab.value:f.state.filter.value,kind==='growth'?'levels':'spend');
 }
});
test('guest membership selection and expanded FAQ survive a recovery refresh',async()=>{
 let generation=0;const levels=[{id:'first',name:'一级',criteria:[],benefits:[]},{id:'second',name:'二级',criteria:[],benefits:[]}];const f=await page('pages/levels/index.vue',{getToken:()=>'',consumerReady:async()=>false,levelKey:level=>level.id,api:async()=>({levels:levels.map(level=>({...level,description:String(generation)})),growthRules:{}})});await f.state.load();f.state.selectedId.value='second';f.state.openFaq.value='growth';f.state.criteriaOpen.value=true;generation=1;await f.recover();assert.equal(f.state.selectedId.value,'second');assert.equal(f.state.openFaq.value,'growth');assert.equal(f.state.criteriaOpen.value,true);assert.equal(f.state.catalog.value.levels[1].description,'1');
});
test('policy, help detail and contact recovery retain their requested identity and only read',async()=>{
 const paths=[];const policy=await page('pages/policy/index.vue',{date:v=>v,api:async(path,method='GET')=>{paths.push({path,method});return{kind:'privacy',title:'隐私政策',contentHtml:'new',version:3}}});policy.state.kind.value='privacy';policy.state.versions.privacy=3;await policy.state.load();await policy.recover();assert.ok(paths.every(item=>item.path.endsWith('/privacy?version=3')&&item.method==='GET'));assert.equal(policy.state.kind.value,'privacy');
 let reads=0;const detail=await page('pages/help/detail.vue',{loadHelpArticle:async id=>{reads++;return{id,title:'标题',content:'fresh'}}});detail.state.id.value='article';await detail.state.load();await detail.recover();assert.equal(detail.state.id.value,'article');assert.equal(reads,2);
 const contactCalls=[];const contact=await page('pages/contact/index.vue',{api:async(path,method='GET')=>{contactCalls.push({path,method});return{wechat:'public-contact'}}});await contact.state.load();await contact.recover();assert.equal(contactCalls.length,2);assert.ok(contactCalls.every(item=>item.method==='GET'&&item.path.includes('tenantId=site&applicationKey=system')));
});
test('personal profile recovery preserves dirty profile, password and phone input and marks the profile conflict',async()=>{
 const profile={id:'user',nickname:'server before',avatar:null,gender:'unknown',version:1,hasPassword:true},calls=[];const f=await page('pages/personal/index.vue',{api:async(path,method='GET')=>{calls.push({path,method});return path==='/profile'?{...profile}:{phone:'13800000000'}}});await f.state.load();await new Promise(resolve=>setImmediate(resolve));f.state.form.nickname='未提交昵称';f.state.password.password='unsent password';f.state.phoneBinding.value={dirty:true,busy:false};profile.nickname='server after';profile.version=2;calls.length=0;await f.recover();assert.equal(f.state.form.nickname,'未提交昵称');assert.equal(f.state.password.password,'unsent password');assert.equal(f.state.phoneBinding.value.dirty,true);assert.equal(f.state.conflict.value,true);assert.deepEqual(calls,[{path:'/profile',method:'GET'}]);
});
