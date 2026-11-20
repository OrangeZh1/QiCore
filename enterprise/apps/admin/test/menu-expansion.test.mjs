import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computed,reactive,ref,watch,effectScope} from 'vue';
import ts from 'typescript';
import * as navigation from '../app/utils/console-navigation.ts';

const source=await readFile(new URL('../app/composables/useConsoleMenuExpansion.ts',import.meta.url),'utf8');
function fixture(t,{cookies=new Map(),states=new Map(),path='/admin/workbench',query={},server=false,referrer='',account='account-a',site='site-a',clockSkew=0}={}){
 const code=ts.transpileModule(source.replaceAll('import.meta.client',String(!server)).replaceAll('import.meta.server',String(server)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const output={},auth={session:ref({id:account,expiresAt:'2099-01-01'})},route=reactive({path,query,hash:''}),tenant=ref(site),cleanup=[],mounted=[];
 const groups=ref([{key:'users',items:[{to:'/admin/users'}]},{key:'decoration',items:[{key:'mobile',children:[{to:'/admin/decoration'}]}]}]);
 const document={set cookie(value){const [key,encoded]=value.split(';')[0].split('=');cookies.set(key,ref(JSON.parse(decodeURIComponent(encoded))))}};
 const env={require:()=>navigation,exports:output,useApi:()=>auth,useRoute:()=>route,ref,computed,watch,useState:(key,init)=>{if(!states.has(key))states.set(key,ref(init()));return states.get(key)},useCookie:key=>{if(!cookies.has(key))cookies.set(key,ref(null));return cookies.get(key)},useRequestHeaders:()=>({referer:referrer}),useRequestURL:()=>new URL('https://console.test'+path),onMounted:fn=>mounted.push(fn),useRouter:()=>({replace:value=>Object.assign(route,value)}),Date:{now:()=>Date.now()+clockSkew},document,location:{protocol:'https:',origin:'https://console.test'}};
 new Function(...Object.keys(env),code)(...Object.values(env));
 function mount(){const scope=effectScope();cleanup.push(()=>scope.stop());return scope.run(()=>output.useConsoleMenuExpansion('tenant',groups,()=>tenant.value))}
 t.after(()=>cleanup.forEach(fn=>fn()));
 return {model:mount(),mount,hydrate:()=>mounted.splice(0).forEach(fn=>fn()),prepare:path=>output.prepareConsoleMenuNavigation('tenant',path),auth,route,tenant,groups,cookies,states};
}
const hint=(fixture)=>[...fixture.cookies.values()].find(cookie=>cookie.value);
const navigationQuery=target=>Object.fromEntries(new URL(target,'https://console.test').searchParams);

test('multiple groups survive child routes, workbench and shell remount; manual close only changes its group',t=>{
 const c=fixture(t),state=c.model;assert.deepEqual(state.openGroups.value,[]);
 state.toggleGroup('decoration');state.toggleGroup('invalid');c.route.path='/admin/users';assert.deepEqual(state.openGroups.value,['decoration','users']);
 state.toggleGroup('users');assert.deepEqual(c.mount().openGroups.value,['decoration'],'remount must preserve a manually closed active group');
 c.route.path='/admin/decoration';assert.deepEqual(state.openGroups.value,['decoration','mobile']);
 state.toggleGroup('users');c.route.path='/admin/workbench';assert.deepEqual(state.openGroups.value,['decoration','mobile','users']);
 state.toggleGroup('decoration');assert.deepEqual(state.openGroups.value,['mobile','users']);
 c.route.path='/admin/users';assert.deepEqual(state.openGroups.value,['mobile','users']);
});

test('identity, session and tenant changes reset expansion; removed grants cannot resurrect old choices',t=>{
 const c=fixture(t),state=c.model;
 for(const change of [()=>c.tenant.value='site-b',()=>c.auth.session.value={id:'account-b'},()=>c.auth.session.value={id:'account-b',expiresAt:'2100-01-01'}]){state.toggleGroup('users');change();assert.deepEqual(state.openGroups.value,[])}
 state.toggleGroup('users');const all=c.groups.value;c.groups.value=all.filter(g=>g.key!=='users');assert.deepEqual(state.openGroups.value,[]);c.groups.value=all;assert.deepEqual(state.openGroups.value,[]);
 state.toggleGroup('users');c.route.path='/admin/login';c.route.path='/admin/workbench';assert.deepEqual(state.openGroups.value,[]);
});

test('accepted document navigation restores groups during SSR and consumes only its own marker',t=>{
 const c=fixture(t);c.model.toggleGroup('decoration');c.model.toggleGroup('users');assert.equal(c.cookies.size,0);
 const target=c.prepare('/admin/decoration?tab=style#block'),query=navigationQuery(target),cookie=hint(c);assert.match(target,/#block$/);assert.equal(query.tab,'style');cookie.value.groups.push('forbidden');
 const freshTab=fixture(t,{cookies:c.cookies,server:true,path:'/admin/decoration',referrer:'https://console.test/admin/workbench'});
 assert.deepEqual(freshTab.model.openGroups.value,['decoration','mobile'],'a new tab without the marker initializes from its route');assert.ok(cookie.value,'unrelated tab must not consume the pending handoff');
 const next=fixture(t,{cookies:c.cookies,server:true,path:'/admin/decoration',query,referrer:'https://console.test/admin/workbench'});
 assert.deepEqual(next.model.openGroups.value,['decoration','users','mobile'],'SSR starts expanded');assert.equal(cookie.value,null);
 const hydrated=fixture(t,{states:next.states,path:'/admin/decoration',query});hydrated.hydrate();assert.deepEqual(hydrated.model.openGroups.value,['decoration','users','mobile']);assert.deepEqual({...hydrated.route.query},{tab:'style'},'transient marker is removed after hydration');
 assert.deepEqual(fixture(t,{cookies:c.cookies,server:true,path:'/admin/decoration',query,referrer:'https://console.test/admin/workbench'}).model.openGroups.value,['decoration','mobile'],'refresh with even the old URL has no reusable hint');
 assert.deepEqual(fixture(t,{cookies:c.cookies,server:true}).model.openGroups.value,[]);
});

test('cookie expiry owns lifetime; client and server clocks need not agree',t=>{
 for(const skew of [-60000,60000]){
  const c=fixture(t,{clockSkew:skew});c.model.toggleGroup('users');const query=navigationQuery(c.prepare('/admin/decoration'));
  assert.equal(Object.hasOwn(hint(c).value,'createdAt'),false);
  assert.deepEqual(fixture(t,{cookies:c.cookies,server:true,path:'/admin/decoration',query,referrer:'https://console.test/admin/workbench'}).model.openGroups.value,['users','decoration','mobile']);
 }
});

test('invalid, cross-origin, cross-identity and unrelated hints cannot restore groups',t=>{
 for(const override of [{identity:'other-account'},{path:'/admin/another'},{from:'https://console.test/admin/another'},{from:'https://elsewhere.test/admin/workbench'},{groups:['users',7]},{groups:Array(65).fill('users')}]){
  const c=fixture(t);c.model.toggleGroup('users');const query=navigationQuery(c.prepare('/admin/decoration')),cookie=hint(c);Object.assign(cookie.value,override);
  const next=fixture(t,{cookies:c.cookies,server:true,path:'/admin/decoration',query,referrer:'https://console.test/admin/workbench'});assert.deepEqual(next.model.openGroups.value,['decoration','mobile']);assert.equal(cookie.value,null);
 }
 const c=fixture(t);c.model.toggleGroup('users');const query=navigationQuery(c.prepare('/admin/decoration'));hint(c).value.from='https://elsewhere.test/admin/workbench';
 assert.deepEqual(fixture(t,{cookies:c.cookies,server:true,path:'/admin/decoration',query,referrer:'https://elsewhere.test/admin/workbench'}).model.openGroups.value,['decoration','mobile'],'matching a foreign referrer and forged cookie still cannot cross origins');
 const f=fixture(t);assert.equal(f.prepare('/admin/login'),'/admin/login');assert.equal(f.prepare('https://another.test/admin/users'),'https://another.test/admin/users');assert.equal(f.cookies.size,0);
});
