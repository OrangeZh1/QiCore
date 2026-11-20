import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TenantSiteSettings} from '../src/core/tenant-site-settings.mjs';
import {TenantApplications} from '../src/applications/service.mjs';

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}

test('branding starts both independent settings reads before either completes and still fails without platform settings',async()=>{
 const own=deferred(),platform=deferred(),started=[];
 const service=new TenantSiteSettings({tenantSiteSetting:{findUnique:()=>{started.push('tenant');return own.promise}},siteSetting:{findUnique:()=>{started.push('platform');return platform.promise}}});
 const pending=service.values(service.db,{id:'site'});
 try{assert.deepEqual(started,['tenant','platform'])}finally{own.resolve(null);platform.resolve({config:{tenant:{name:'Brand'},copyright:'',filing:{}}})}
 assert.equal((await pending).config.name,'Brand');
 service.db.siteSetting.findUnique=async()=>null;
 await assert.rejects(service.values(service.db,{id:'site'}),{code:'SITE_NOT_READY'});
});

test('tenant entry starts tenant and binding reads together after actor validation',async()=>{
 const tenants=deferred(),bindings=deferred(),started=[];
 const service=new TenantApplications({tenant:{findMany:({where})=>{assert.deepEqual(where.id.in,['site']);started.push('tenants');return tenants.promise}},tenantApplication:{findMany:({where})=>{assert.deepEqual(where.tenantId.in,['site']);started.push('bindings');return bindings.promise}}});
 service.actor=async()=>{started.push('actor');return{role:{permissions:[]},scopes:[{tenantId:'site',enabled:true}]}};
 const pending=service.entry({id:'user'});
 await new Promise(setImmediate);
 try{assert.deepEqual(started,['actor','tenants','bindings'])}finally{tenants.resolve([]);bindings.resolve([])}
 assert.equal((await pending).access,'no-tenants');
 started.length=0;service.actor=async()=>{throw Object.assign(Error('revoked'),{code:'FORBIDDEN'})};
 await assert.rejects(service.entry({id:'user'}),{code:'FORBIDDEN'});assert.deepEqual(started,[]);
});
