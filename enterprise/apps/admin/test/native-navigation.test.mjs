import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as navigation from '../app/utils/console-navigation.ts';
import {tenantLandingUrl,tenantEntryUrl} from '../app/utils/tenant-entry.ts';
import {isTenantPage,legacyTenantRoute} from '../app/utils/tenant-routes.ts';
import {consoleTitle} from '../app/utils/console-title.ts';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createRouter,createMemoryHistory,isNavigationFailure} from 'vue-router';

test('installed routes hand off before legacy tenant parsing and preserve query and hash',async()=>{
 const source=(await readFile(new URL('../app/middleware/tenant-context.global.ts',import.meta.url),'utf8')).replaceAll('import.meta.client','true');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,output={},moves=[];
 new Function('require','exports','defineNuxtRouteMiddleware','useTenantContext','navigateTo','window','useState','prepareConsoleMenuNavigation','useRuntimeConfig','useNuxtApp',code)(()=>({legacyTenantRoute:()=>{throw Error('Native route reached legacy parser')}}),output,fn=>fn,()=>({current:{value:{site:{consoleRoutes:[{path:'/admin/example'}]}}}}),(path,options)=>moves.push({path,options}),{addEventListener(){}},()=>({value:0}),(portal,path)=>{assert.deepEqual([portal,path],['tenant','/admin/example?tab=history#record']);return path},()=>({public:{}}),()=>({}));
 await output.default({path:'/admin/example',fullPath:'/admin/example?tab=history#record',query:{tab:'history'},hash:'#record'});
 assert.deepEqual(moves,[{path:'/admin/example?tab=history#record',options:{external:true}}]);
});
test('application navigation reuses existing groups, order and active-state markers',async()=>{
 const code=ts.transpileModule(await readFile(new URL('../app/utils/application-navigation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,output={};
 new Function('require','exports',code)(()=>navigation,output);
 const base=[{key:'transactions',label:'交易管理',icon:'i-lucide-credit-card',items:[{label:'充值订单',icon:'i-lucide-wallet',to:'/admin/recharge-orders'}]}];
 const routes=[{path:'/admin/example',label:'业务订单',group:'transactions',icon:'i-lucide-receipt-text'},{path:'/admin/example-home',label:'工作台',group:'workbench',icon:'i-lucide-layout-dashboard'}];
 const result=output.applicationMenus(base,routes,'/admin/example');assert.deepEqual(result.map(x=>x.key),['workbench','transactions']);assert.equal(result[0].to,'/admin/example-home');assert.deepEqual(result[1].items.map(x=>x.to),['/admin/example','/admin/recharge-orders']);assert.equal(result[1].items[0].active,true);assert.equal(base[0].items.length,1);
});

test('tenant entry chooses its authorized workbench and never guesses an application',()=>{
 const app={key:'example',state:'available',consoleRoutes:[{path:'/admin/orders',group:'transactions'},{path:'/admin/dashboard',group:'workbench'}]},entry={tenant:{id:'a',enabled:true,expiresAt:null},applications:[app],access:'choose-application'};
 assert.equal(tenantLandingUrl(entry),'/admin/dashboard');
 assert.equal(tenantLandingUrl({...entry,applications:[{...app,consoleRoutes:app.consoleRoutes.slice(0,1)}]}),'/admin/workbench');
 assert.equal(tenantLandingUrl({...entry,applications:[{...app,consoleRoutes:app.consoleRoutes.slice(0,1)}]},app.key),'/admin/workbench');
 assert.equal(tenantEntryUrl('a',app.key),'/admin/applications','legacy callers cannot generate an application status link');
 for(const access of ['tenant-disabled','tenant-expired','system-unavailable','forbidden'])assert.equal(tenantLandingUrl({...entry,access}),null);
 assert.equal(tenantLandingUrl({...entry,access:'no-applications',applications:[]}),'/admin/workbench');
 assert.equal(tenantLandingUrl({...entry,applications:[{...app,state:'expired'}]}),'/admin/workbench');
 assert.equal(tenantLandingUrl({...entry,applications:[app,{...app,key:'second'}]}),'/admin/workbench');
 assert.equal(tenantLandingUrl(entry,'another'),null);
 const expired={...entry,tenant:{...entry.tenant,expiresAt:'2000-01-01T00:00:00Z'}};
 assert.equal(tenantLandingUrl(expired),null);
 assert.equal(tenantLandingUrl({...expired,tenant:{...expired.tenant,canEnter:true}}),'/admin/dashboard','server-verified platform maintenance access may enter an expired tenant');
 assert.equal(tenantLandingUrl({...entry,tenant:{...entry.tenant,canEnter:false}}),null);
 assert.equal(tenantLandingUrl({...entry,applications:[{...app,consoleRoutes:[{path:'/admin/applications'},{path:'https://untrusted.test'},{path:'/admin/login'}]}]}),'/admin/workbench');
 assert.equal(consoleTitle('/admin/workbench','平台','租户'),'工作台 · 租户');
 assert.equal(consoleTitle('/admin/applications','平台','租户'),'工作台 · 租户');
});

test('enterprise routing selects the authenticated scope even when an old browser remembers another enterprise',async()=>{
 const source=(await readFile(new URL('../app/middleware/tenant-context.global.ts',import.meta.url),'utf8')).replaceAll('import.meta.client','false');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const site={id:'a',enabled:true,expiresAt:null,consoleRoutes:[]},calls=[],choices=[],output={};
 const session={value:{id:'u',role:'tenant',tenantId:'a',tenantIds:['a'],permissions:[],csrfToken:'fixture',expiresAt:'2099-01-01T00:00:00Z'}};
 const context={current:{value:null},tenantId:{value:''},recent:{value:{accountId:'u',tenantId:'b'}},choose(site){choices.push(site.id)}};
 const auth={session,api:async path=>{calls.push(path);return path.includes('/branding')?{tenantId:'a'}:{tenant:site,tenants:[site],applications:[],access:'no-applications',permissions:[]}}};
 const names=['require','exports','defineNuxtRouteMiddleware','useTenantContext','useApi','useSiteBranding','navigateTo','createError','useState','useRuntimeConfig'];
 const values=[name=>name.includes('tenant-entry')?{tenantLandingUrl}:{isTenantPage,legacyTenantRoute},output,fn=>fn,()=>context,()=>auth,()=>({tenantBrand:{value:null}}),()=>{throw Error('unexpected redirect')},v=>Object.assign(Error(v.statusMessage),v),()=>({value:0}),()=>({public:{}})];
 new Function(...names,compiled)(...values);
 const to={path:'/admin/roles',fullPath:'/admin/roles',query:{},hash:''};
 await output.default(to);
 assert.deepEqual(choices,['a']);assert.ok(calls.includes('/admin/tenant-entry?tenantId=a'));assert.ok(calls.every(url=>!url.includes('tenantId=b')));
 for(const invalid of [{role:'root'},{delegated:true},{tenantIds:['a','b']},{tenantId:'b'}]){
  const original=session.value;session.value={...original,...invalid};
  await assert.rejects(output.default(to),e=>e.statusCode===403);session.value=original;
 }
});

test('direct entry and client navigation redirect retired enterprise entry bookmarks to the current authorized workbench',async()=>{
 for(const client of [false,true])for(const path of ['/admin/applications','/admin/apps/example','/admin/apps/old-app','/admin/a/apps/example'])for(const workbench of [true,false]){
  const source=(await readFile(new URL('../app/middleware/tenant-context.global.ts',import.meta.url),'utf8')).replaceAll('import.meta.client',String(client));
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,output={},moves=[];
  const site={id:'a',enabled:true,expiresAt:null,consoleRoutes:workbench?[{path:'/admin/dashboard',group:'workbench'}]:[]},context={current:{value:null},tenantId:{value:'a'},recent:{value:null},choose(value){this.current.value={site:value}}};
  const entry={tenant:site,tenants:[site],applications:[{key:'example',state:'available',consoleRoutes:workbench?[{path:'/admin/dashboard',group:'workbench'}]:[]}],access:'choose-application'};
  const auth={session:{value:{id:'u',role:'tenant',tenantId:'a',tenantIds:['a'],permissions:[],csrfToken:'fixture',expiresAt:'2099-01-01T00:00:00Z'}},api:async path=>path.includes('/branding')?{tenantId:'a'}:entry};
  new Function('require','exports','defineNuxtRouteMiddleware','useTenantContext','useApi','useSiteBranding','navigateTo','createError','useState','useRuntimeConfig',code)(
   name=>name.includes('tenant-entry')?{tenantLandingUrl}:{legacyTenantRoute,isTenantPage},output,fn=>fn,()=>context,()=>auth,()=>({tenantBrand:{value:null}}),(path,options)=>moves.push({path,options}),value=>Error(value.statusMessage),()=>({value:0}),()=>({public:{}}));
  await output.default({path,query:{tab:'recent'},hash:'#section'});
  assert.deepEqual(moves,[{path:{path:workbench?'/admin/dashboard':'/admin/workbench',query:{tab:'recent'},hash:'#section'},options:{replace:true,redirectCode:302,external:workbench}}]);
 }
});

test('Nuxt does not render 404 for an aborted cross-document navigation or cancelled draft',async()=>{
 const require=createRequire(import.meta.url),source=await readFile(join(dirname(require.resolve('nuxt/package.json')),'dist/pages/runtime/plugins/router.js'),'utf8');
 const start=source.indexOf('router.afterEach((to, _from, failure) => {'),end=source.indexOf('\n\t\t});',start);
 assert.ok(start>0&&end>start,'installed Nuxt must carry the navigation failure patch');
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/admin/workbench',component:{}}]}),errors=[];
 await router.push('/admin/workbench');await router.isReady();
 new Function('router','error','nuxtApp','showError','createError',source.slice(start,end)+'\n});')(router,{value:null},{runWithContext:fn=>fn()},value=>errors.push(value),value=>value);
 let allowed=false;router.beforeEach(()=>allowed);
 assert.equal(isNavigationFailure(await router.push('/admin/users')),true);assert.equal(errors.length,0);assert.equal(router.currentRoute.value.path,'/admin/workbench');
 // Genuine successful navigation to an unknown route must still report a 404.
 allowed=true;await router.push('/admin/missing');assert.equal(errors.length,1);assert.equal(errors[0].status,404);
});
