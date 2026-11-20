import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fixtureProduct,signedFixture} from './fixtures/standalone-product.mjs';
import {compositionFilename,describeBundle} from '../dist/applications/standalone-bundle.js';

test('existing installation gains trusted application permissions only in the built-in role, without widening scoped or custom roles',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-role-check-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});
 const bundle=join(root,'bundle'),path=join(bundle,'components','app_fixture');
 mkdirSync(path,{recursive:true});mkdirSync(join(bundle,'server'));
 writeFileSync(join(bundle,'product.json'),JSON.stringify({version:'1.0.0',frameworkVersion:'0.1.10'}));
 writeFileSync(join(bundle,'server/start.mjs'),'// isolated role fixture');
 writeFileSync(join(path,'application.json'),JSON.stringify({format:'qicore-application-v1',key:'fixture',packageKey:'app_fixture',version:'1.0.0',name:'Fixture',pendingTasks:[]}));
 writeFileSync(join(path,'entry.mjs'),"export function createApplication(){return {format:'qicore-application-v1',version:'1.0.0',definition:{key:'fixture',licensePackageKey:'app_fixture',name:'Fixture',permissions:['settings.read','settings.write'],defaultConfig:()=>({}),validateConfig:x=>x},createRuntime(){}}}");
 const {product,privateKey}=fixtureProduct('app_fixture'),productFile=join(root,'product.json'),releaseFile=join(root,'release.json');
 writeFileSync(productFile,JSON.stringify(product));
 writeFileSync(join(bundle,compositionFilename),JSON.stringify(await describeBundle(bundle,product)));
 writeFileSync(releaseFile,JSON.stringify(await signedFixture(bundle,privateKey,'app_fixture')));
 const env={QICORE_STANDALONE_BUNDLE_ROOT:bundle,QICORE_STANDALONE_PRODUCT_FILE:productFile,QICORE_STANDALONE_RELEASE_FILE:releaseFile};
 for(const [name,value] of Object.entries(env)){
  const previous=process.env[name];process.env[name]=value;
  t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous});
 }
 const {AdminAuth,ensureTenantAdministratorRole}=await import('../dist/core/admin-auth.mjs');
 const {foundationTenantPermissions}=await import('../dist/core/admin-identity.mjs');
 const {tenantGrants}=await import('../dist/core/tenant-access.mjs');
 const {TenantApplications}=await import('../dist/applications/service.mjs');
 const role={id:'builtin',systemCode:'tenant-admin',portal:'tenant',enabled:true,version:1,permissions:[...foundationTenantPermissions,'removed:records.read']},audits=[];
 const {bindStandaloneEnterprise}=await import('../dist/core/standalone-edition.mjs');
 const db={tenant:{count:async()=>1,findMany:async()=>[{id:'tenant-one',standaloneSlot:1,ownerAdminId:'owner'}],findUnique:async()=>({id:'tenant-one'})},adminTenantScope:{findUnique:async()=>({enabled:true,admin:{enabled:true,role:{enabled:true,portal:'tenant'}}})},adminAccount:{count:async()=>1},$queryRaw:async()=>[],adminRole:{
  upsert:async q=>{assert.equal(q.where.systemCode,'tenant-admin');return role},findUniqueOrThrow:async()=>role,
  update:async q=>{role.permissions=q.data.permissions;role.version++;return role}
 },audit:{create:async({data})=>audits.push(data)}};db.$transaction=async fn=>fn(db);
 await bindStandaloneEnterprise(db);
 const auth=new AdminAuth(db,{}, {directory:join(root,'auth')});await auth.bootstrap();
 assert.ok(role.permissions.includes('fixture:settings.read'));assert.ok(role.permissions.includes('fixture:settings.write'));
 assert.ok(role.permissions.includes('removed:records.read'));assert.equal(role.version,2);assert.equal(audits.length,1);
 assert.equal(audits[0].scope,'tenant');assert.equal(audits[0].tenantId,'tenant-one');
 await auth.bootstrap();await ensureTenantAdministratorRole(db);assert.equal(role.version,2);assert.equal(audits.length,1);
 const account={id:'owner',role,scopes:[{tenantId:'tenant-one',enabled:true}]};
 const apiView=auth.view(account);assert.ok(apiView.permissions.includes('fixture:settings.read'));assert.ok(!apiView.permissions.includes('removed:records.read'));
 const apps=new TenantApplications({tenant:{findMany:async()=>[{id:'tenant-one',name:'Tenant',enabled:true}]},tenantApplication:{findMany:async()=>[{tenantId:'tenant-one',applicationKey:'fixture',enabled:true}]}});apps.actor=async()=>account;
 assert.equal((await apps.entry({id:'owner',permissions:apiView.permissions},{tenantId:'tenant-one'})).applications[0].state,'available');
 assert.deepEqual(tenantGrants({...account,role:{permissions:['tenant:settings.read']}},'tenant-one'),['tenant:settings.read']);
 assert.deepEqual(tenantGrants({...account,scopes:[{tenantId:'tenant-one',enabled:true,permissionRoleId:'restricted',permissionRole:{tenantId:'tenant-one',enabled:true,permissions:['fixture:settings.read']}}]},'tenant-one'),['fixture:settings.read']);
 role.enabled=false;await ensureTenantAdministratorRole(db);assert.equal(role.enabled,false);
 role.portal='admin';await assert.rejects(ensureTenantAdministratorRole(db),{code:'ROLE_UNAVAILABLE'});
});
