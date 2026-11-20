import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TenantApplications} from '../dist/applications/service.mjs';
import {applicationCatalog} from '../dist/applications/registry.mjs';
import {frameworkKey} from '../dist/applications/framework.mjs';
import {foundationTenantPermissions} from '../dist/core/admin-identity.mjs';
import {provisionEnterprise,bindStandaloneEnterprise,standaloneOwner} from '../dist/core/standalone-edition.mjs';
import {TenantDecoration} from '../dist/core/tenant-decoration.mjs';
import {TenantH5} from '../dist/core/tenant-h5.mjs';
import {TenantMiniPrograms} from '../dist/core/tenant-mini-programs.mjs';
import {TenantConsumers} from '../dist/core/tenant-consumers.mjs';
import {TenantRecords} from '../dist/core/tenant-records.mjs';
import {TenantPayments} from '../dist/core/tenant-payments.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';

test('zero-application sites use real framework decoration and channels without allocating an application or bypassing grants',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t),{db:peerDb}=await isolatedDatabase(t),expiresAt=new Date(Date.now()+600000);
 async function install(installation,username){
  const created=await installation.$transaction(tx=>provisionEnterprise(tx,{username,nickname:username,passwordHash:'fixture',permissions:foundationTenantPermissions}));
  assert.equal(await bindStandaloneEnterprise(installation),created);
  return created;
 }
 const tenantId=await install(db,'owner-a'),peerId=await install(peerDb,'owner-b'),ownerId=standaloneOwner(db);
 assert.notEqual(tenantId,peerId);assert.notEqual(ownerId,standaloneOwner(peerDb));
 await db.adminSession.create({data:{adminId:ownerId,portal:'tenant',tokenHash:'a'.repeat(64),csrfHash:'b'.repeat(64),expiresAt}});
 const s={_admin:true,id:ownerId,role:'tenant',tenantId,tenantIds:[tenantId],permissions:foundationTenantPermissions,tokenHash:'a'.repeat(64)},apps=new TenantApplications(db),decoration=new TenantDecoration(db,{}),h5=new TenantH5(db,{}),mini=new TenantMiniPrograms(db,{});
 assert.deepEqual(applicationCatalog(),[]);assert.deepEqual(await apps.assignable(),{items:[]});
 const entry=await apps.entry(s,{tenantId});assert.equal(entry.tenant.application,null);assert.deepEqual(entry.applications,[]);assert.deepEqual(entry.tenant.consoleRoutes,[]);
 const initial=await decoration.view(s,tenantId);assert.equal(initial.applicationKey,frameworkKey);assert.equal(initial.canWrite,true);assert.equal(initial.current.scheme.home.title,'首页');assert.equal(initial.systemTemplates[0].name,'框架默认方案');assert.ok(initial.targets.every(route=>route.source==='system'));
 assert.equal(await db.tenantApplication.count(),0,'reading framework defaults must not create an application binding');
 const scheme=structuredClone(initial.current.scheme);scheme.home.title='系统首页';
 const saved=await decoration.mutate(s,tenantId,frameworkKey,{version:0,action:'save',id:initial.current.id,name:'当前装修',scheme});assert.equal(saved.version,1);
 const record=await db.tenantApplication.findFirst();assert.equal(record.applicationKey,frameworkKey);assert.equal(record.activeSlot,null);assert.equal(await db.tenantApplication.count({where:{activeSlot:1}}),0);assert.deepEqual(await apps.assignable(),{items:[]});
 await assert.rejects(decoration.mutate(s,tenantId,frameworkKey,{version:0,action:'save',id:initial.current.id,scheme}),{code:'DECORATION_CONFLICT'});
 const view=await h5.view(s,tenantId);assert.equal(view.applicationKey,frameworkKey);assert.equal(view.canWrite,true);assert.ok(view.entryUrl.endsWith('/h5/'+tenantId+'/'));assert.ok(view.qrCode.startsWith('data:image/png'));
 await h5.save(s,tenantId,frameworkKey,{version:0,config:{displayName:'公共手机站',customDomain:''}});
 const runtime=await h5.runtime({host:new URL(view.entryUrl).host,tenantId});assert.equal(runtime.contentSource,'framework');assert.equal(runtime.homeTitle,'系统首页');assert.equal(runtime.applicationKey,frameworkKey);assert.equal(runtime.siteName,'公共手机站');
 assert.equal((await h5.publicDecoration({host:new URL(view.entryUrl).host,tenantId})).scheme.home.title,'系统首页');
 const host=new URL(view.entryUrl).host,peerH5=new TenantH5(peerDb,{});
 assert.equal((await peerH5.runtime({host})).tenantId,peerId);
 await assert.rejects(h5.runtime({host,tenantId:peerId}),{code:'H5_SCOPE_MISMATCH'});
 await assert.rejects(peerH5.runtime({host,tenantId}),{code:'H5_SCOPE_MISMATCH'});
 const channel=await mini.view(s,tenantId);assert.equal(channel.applicationKey,frameworkKey);assert.equal(channel.canWrite,true);assert.equal(channel.hasAppSecret,false);
 assert.equal((await new TenantPayments(db,{}).view(s,tenantId)).channels.length,3);
 assert.equal((await new TenantConsumers(db).list(s,tenantId,{})).total,0);
 // Two installations may use the same consumer ID; a prior application in the current
 // enterprise may retain it as well. Only the active framework scope can be listed.
 await peerDb.consumerProfile.create({data:{tenantId:peerId,applicationKey:frameworkKey,userId:'member1',nickname:'其他用户',passwordHash:'other-digest'}});
 await db.consumerProfile.createMany({data:[{tenantId,applicationKey:frameworkKey,userId:'member1',nickname:'公共用户',passwordHash:'private-password-digest'},{tenantId,applicationKey:'retired-app',userId:'member1',nickname:'历史应用用户',passwordHash:'old-digest'}]});
 assert.equal((await peerDb.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId:peerId,applicationKey:frameworkKey,userId:'member1'}}})).nickname,'其他用户');
 const users=await new TenantConsumers(db).list(s,tenantId,{});assert.equal(users.total,1);assert.equal(users.items[0].enabled,true);assert.doesNotMatch(JSON.stringify(users),/private-password-digest|other-digest|old-digest|其他用户|历史应用用户/);
 for(const [feature,permission] of [['pointsLedger','entitlements.read'],['transactions','orders.read']])assert.equal((await new TenantRecords(db,feature,permission).list(s,tenantId,{})).total,0);
 await assert.rejects(apps.featureContext(db,s,tenantId,'unknown-app','decoration','settings.read'),{code:'FORBIDDEN'});
 await assert.rejects(decoration.view(s,peerId),{code:'FORBIDDEN'});
 await assert.rejects(apps.bindTenant(db,tenantId,frameworkKey),{code:'APPLICATION_INPUT_INVALID'});
 await assert.rejects(decoration.view({...s,permissions:[]},tenantId),{code:'FORBIDDEN'});
 await assert.rejects(decoration.view({...s,permissions:['tenant:settings.read']},tenantId),{code:'FORBIDDEN'},'a pre-existing site-only role must not acquire client configuration privileges');
 assert.deepEqual(applicationCatalog(),[]);assert.equal((await apps.entry(s,{tenantId})).tenant.application,null);
});
