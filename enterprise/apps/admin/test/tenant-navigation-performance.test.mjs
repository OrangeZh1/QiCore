import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {tenantLandingUrl,rememberedTenant} from '../app/utils/tenant-entry.ts';
import {isTenantPage,legacyTenantRoute} from '../app/utils/tenant-routes.ts';

test('choosing a tenant does not remount the pending selector or login, but still changes scoped page identity',async()=>{
 const source=await readFile(new URL('../app/app.vue',import.meta.url),'utf8');
 const snippet=source.slice(source.indexOf('const tenantPageKey='),source.indexOf('const installation='));
 const code=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const context={current:{value:null},tenantId:{value:''}},key=new Function('tenantContext',code+';return tenantPageKey')(context);
 const targets=['/admin','/admin/login','/admin/workbench','/install'].map(path=>({path,meta:{}}));
 const before=targets.map(key);context.current.value={accountId:'account'};context.tenantId.value='site';
 const after=targets.map(key);
 assert.equal(after[0],before[0]);assert.equal(after[1],before[1]);assert.equal(after[3],before[3]);assert.notEqual(after[2],before[2]);
 context.tenantId.value='another';assert.notEqual(key(targets[2]),after[2]);
});

async function fixture({hydrating=false,nativeRoutes,brandCurrent=false}={}){
 const source=(await readFile(new URL('../app/middleware/tenant-context.global.ts',import.meta.url),'utf8')).replaceAll('import.meta.client','true');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const site={id:'site',enabled:true,expiresAt:null,consoleRoutes:[]},context={tenantId:{value:'site'},recent:{value:null},current:{value:{accountId:'user',site}},choose(site){this.current.value={accountId:auth.session.value.id,site};this.tenantId.value=site.id}};
 const branding={tenantBrand:{value:{accountId:'user',tenantId:'site'}}},requests=[],moves=[],sequence={value:0};
 const auth={session:{value:{id:'user',role:'tenant',tenantId:'site',csrfToken:'first',expiresAt:'2099-01-01',tenantIds:['site']}},api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
 if(brandCurrent)branding.tenantBrand.value.sessionKey=JSON.stringify(['user','first',undefined,'site']);
 const output={};
 new Function('require','exports','defineNuxtRouteMiddleware','useTenantContext','useApi','useSiteBranding','useNuxtApp','useState','navigateTo','createError','window','useRuntimeConfig','prepareConsoleMenuNavigation','useAsyncData',code)(
  name=>name.includes('tenant-entry')?{tenantLandingUrl,rememberedTenant}:{isTenantPage,legacyTenantRoute},output,fn=>fn,()=>context,()=>auth,()=>branding,()=>({isHydrating:hydrating,payload:{serverRendered:true}}),()=>sequence,(...args)=>{moves.push(args);return args[0]},value=>Object.assign(Error(value.statusMessage),value),{addEventListener(){}},()=>({public:{nativeApplication:nativeRoutes?{routes:nativeRoutes}:undefined}}),(_portal,path)=>path,async(_key,handler)=>({data:{value:await handler(null,{})},error:{value:null}}));
 const route=(path='/admin/decoration-editor',query={})=>({path,query,hash:'',fullPath:path});
 const resolve=(offset=0,extra={})=>{requests[offset].resolve({tenant:site,tenants:[site],applications:[],application:null,access:'choose-application',permissions:['settings.read'],...extra});if(requests[offset+1]?.path.endsWith('/branding'))requests[offset+1].resolve({tenantId:'site'})};
 return{run:output.default,context,branding,auth,requests,moves,route,resolve,site};
}

test('SSR hydration and UI-only tabs reuse the verified, unexpired account and site',async()=>{
 const c=await fixture({hydrating:true});await c.run(c.route(),c.route());assert.equal(c.requests.length,0);
 const d=await fixture();await d.run(d.route(undefined,{tab:'theme',page:'home'}),d.route(undefined,{page:'profile'}));assert.equal(d.requests.length,0);
});

test('implicit enterprise entry resolves its authorized landing page without selecting an enterprise',async()=>{
 for(const application of [false,true]){
  const c=await fixture(),target=application?'/admin/dashboard':'/admin/workbench';
  if(application)c.site.consoleRoutes=[{path:target,group:'workbench'}];
  const pending=c.run(c.route('/admin'),c.route('/admin/login'));assert.equal(c.requests.length,2);
  c.resolve(0,{applications:application?[{key:'example',state:'available',consoleRoutes:c.site.consoleRoutes}]:[]});await pending;
  assert.equal(c.moves[0][0].path,target);assert.equal(c.moves[0][1].external,application);
 }
 const c=await fixture(),pending=c.run(c.route('/admin',{switch:'1'}));
 c.resolve();await pending;assert.equal(c.moves[0][0].query.switch,undefined);assert.equal(c.moves[0][0].path,'/admin/workbench');
});

test('hydration shortcuts cannot render retired entry URLs without resolving their redirect',async()=>{
 for(const path of ['/admin/apps/example','/admin/applications']){
  const c=await fixture({hydrating:true}),pending=c.run(c.route(path),c.route('/admin/workbench'));
  assert.equal(c.requests.length,2);c.resolve(0,{applications:[]});await pending;
  assert.equal(c.moves.at(-1)[0].path,'/admin/workbench');assert.equal(c.moves.at(-1)[1].external,false);
 }
});

test('same-session navigation reuses branding but still refreshes permissions and removes a revoked site',async()=>{
 const c=await fixture({brandCurrent:true}),first=c.run(c.route('/admin/users'),c.route('/admin/workbench'));
 assert.equal(c.requests.length,1);assert.match(c.requests[0].path,/tenant-entry/);c.resolve();await first;
 assert.deepEqual(c.auth.session.value.permissionsByTenant.site,['settings.read']);
 const blocked=c.run(c.route('/admin/site'),c.route('/admin/users'));assert.equal(c.requests.length,2);c.resolve(1,{access:'tenant-disabled'});await assert.rejects(blocked,{statusCode:403});
 assert.equal(c.branding.tenantBrand.value,null);assert.equal(c.moves.length,0);
});

test('a new session for the same account cannot reuse the old branding scope',async()=>{
 const c=await fixture({brandCurrent:true});c.auth.session.value.csrfToken='new-session';
 const pending=c.run(c.route('/admin/users'),c.route('/admin/workbench'));assert.equal(c.requests.length,2);c.resolve();await pending;
 assert.equal(c.branding.tenantBrand.value.sessionKey,JSON.stringify(['user','new-session',undefined,'site']));
});

test('application-to-host handoff skips the departing document\'s redundant initialization',async()=>{
 const c=await fixture({nativeRoutes:['/admin/app-workbench']});
 await c.run(c.route('/admin/users'),c.route('/admin/app-workbench'));
 assert.equal(c.requests.length,0);assert.deepEqual(c.moves,[['/admin/users',{external:true}]]);
 const internal=c.run(c.route('/admin/app-workbench'),c.route('/admin/app-other'));assert.equal(c.requests.length,2);c.resolve();await internal;
 assert.equal(c.moves.length,1,'routes owned by this application must stay in its router');
});

test('navigation reads entry and branding concurrently and preserves scope validation',async()=>{
 const c=await fixture(),pending=c.run(c.route('/admin/decoration'),c.route('/admin/workbench'));
 assert.equal(c.requests.length,2,'both reads must start before either completes');c.resolve();await pending;
 assert.deepEqual(c.auth.session.value.permissionsByTenant.site,['settings.read']);assert.equal(c.branding.tenantBrand.value.accountId,'user');
 const denied=c.run(c.route('/admin/site'),c.route('/admin/decoration'));c.resolve(2,{tenant:null});await assert.rejects(denied,{statusCode:403});assert.equal(c.context.current.value,null);assert.equal(c.moves.length,0);
});

test('expired sessions, disabled sites, mismatched branding and document queries cannot take the UI shortcut',async()=>{
 for(const change of [c=>c.auth.session.value.expiresAt='2000-01-01',c=>c.site.enabled=false,c=>c.branding.tenantBrand.value.accountId='other',()=>{}]){
  const c=await fixture();change(c);const pending=c.run(c.route(undefined,{application:'different'}),c.route());assert.equal(c.requests.length,2);c.resolve();await pending;
 }
 const c=await fixture();c.auth.session.value.expiresAt='2000-01-01';const pending=c.run(c.route(undefined,{tab:'theme'}),c.route());assert.equal(c.requests.length,2);c.resolve();await pending;
});

test('a late read cannot overwrite a newer navigation or account',async()=>{
 const c=await fixture(),first=c.run(c.route('/admin/site'),c.route()),second=c.run(c.route('/admin/decoration'),c.route());
 c.resolve(2);await second;c.resolve(0,{permissions:['obsolete']});assert.equal(await first,false);assert.deepEqual(c.auth.session.value.permissionsByTenant.site,['settings.read']);
 const next=c.run(c.route('/admin/site'),c.route());c.auth.session.value={...c.auth.session.value,id:'new',csrfToken:'new'};c.resolve(4);assert.equal(await next,false);assert.equal(c.branding.tenantBrand.value.accountId,'user');assert.equal(c.context.current.value.accountId,'user','stale site must not be assigned to the new account');
});

test('failures remain failures and a disabled site does not depend on successful branding',async()=>{
 const c=await fixture(),pending=c.run(c.route('/admin/site'),c.route());c.requests[0].reject({status:403});c.requests[1].resolve({tenantId:'site'});await assert.rejects(pending,{statusCode:403});
 const d=await fixture(),disabled=d.run(d.route('/admin/site'),d.route());d.requests[0].resolve({tenant:d.site,tenants:[d.site],access:'tenant-disabled'});d.requests[1].reject({status:403});await assert.rejects(disabled,{statusCode:403});assert.equal(d.branding.tenantBrand.value,null);
 const e=await fixture(),mismatch=e.run(e.route('/admin/site'),e.route());e.requests[0].resolve({tenant:e.site,tenants:[e.site],access:'choose-application'});e.requests[1].resolve({tenantId:'other'});await assert.rejects(mismatch,{statusCode:503});
});

test('a blocked enterprise fails closed on workbench, applications, and retired selector routes',async()=>{
 for(const access of ['tenant-disabled','tenant-expired','system-unavailable']){
  const c=await fixture();
  for(const path of ['/admin/workbench','/admin/apps/example','/admin/applications']){
   const offset=c.requests.length,pending=c.run(c.route(path),c.route('/admin'));
   c.requests[offset].resolve({tenant:c.site,tenants:[c.site],access});c.requests[offset+1].reject({status:403});
   await assert.rejects(pending,{statusCode:access==='system-unavailable'?503:403});
   assert.equal(c.moves.length,0);
  }
 }
});

test('leaving for login also invalidates a previous pending tenant navigation',async()=>{
 const c=await fixture(),pending=c.run(c.route('/admin/site'),c.route());
 await c.run(c.route('/admin/login'),c.route('/admin/site'));c.resolve(0,{permissions:['obsolete']});assert.equal(await pending,false);assert.equal(c.auth.session.value.permissionsByTenant,undefined);
});
