import {test} from 'node:test';
import assert from 'node:assert/strict';
import {miniProgramDomains} from '../src/channels/mini-domains.mjs';
import {TenantMiniUpload} from '../dist/core/tenant-mini-upload.mjs';

test('mini domains use the installed public origin without inventing a development address',t=>{
 const keys=['PUBLIC_API_ORIGIN','PUBLIC_WEB_ORIGIN','ADMIN_ORIGIN'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]});
 for(const k of keys)delete process.env[k];
 assert.equal(miniProgramDomains().request,'');
 process.env.ADMIN_ORIGIN='https://qicore.mcent.cn';
 assert.equal(miniProgramDomains().available,true);assert.equal(miniProgramDomains().request,'https://qicore.mcent.cn');
 process.env.PUBLIC_API_ORIGIN='https://api.mcent.cn';
 assert.equal(miniProgramDomains().request,'https://api.mcent.cn');assert.equal(miniProgramDomains().business,'qicore.mcent.cn');
 process.env.PUBLIC_WEB_ORIGIN='https://client.mcent.cn';assert.equal(miniProgramDomains().business,'client.mcent.cn');
 assert.equal(miniProgramDomains('http://127.0.0.1:3501').available,false);
 assert.equal(miniProgramDomains('https://user:secret@qicore.mcent.cn').request,'');
});

test('mini catalog accepts License component names while retaining identity and package checks',async()=>{
 const project={projectId:'project',templateId:'template',version:'0.1.0',artifactSha256:'a'.repeat(64),name:'应用',componentPackageKey:'app_fixture',componentName:'组件'};
 let response={schema:'qiadmin-mini-program-catalog-v1',instanceId:'instance',workerPublicKey:'a'.repeat(43),projects:[project]};
 const service=new TenantMiniUpload({}, {apps:{}}, {identity:()=>({instanceId:'instance'}),status:()=>({state:'active'}),machine:async()=>response});
 let checks=0;service.authorize=async()=>{checks++};service.packageKey=()=> 'app_fixture';
 assert.equal((await service.catalog({},'site','fixture')).ready,true);assert.equal(checks,2);
 response={...response,instanceId:'other'};await assert.rejects(service.catalog({},'site','fixture'),e=>e.code==='MINI_CATALOG_UNAVAILABLE');
 response={...response,instanceId:'instance',projects:[{...project,componentPackageKey:'other'}]};await assert.rejects(service.catalog({},'site','fixture'),e=>e.code==='MINI_CATALOG_UNAVAILABLE');
});

test('mini task detail recovers exact history with read permission and tenant/application isolation',async()=>{
 const id='45b961f4-5c5d-4785-8ede-4fce4afc87b1';
 const task={id,tenantId:'site',applicationKey:'fixture',selection:{version:'0.1.2',action:'preview'},payload:{appId:'wx1234567890abcdef'},status:'SUCCEEDED',progress:100,qrCode:'qr',createdAt:new Date()};
 let current=task,checks=0;
 const service=new TenantMiniUpload({tenantMiniUploadTask:{findUnique:async()=>current}},{apps:{}},{});
 service.authorize=async(_session,tenant,key,write)=>{assert.equal(write,undefined);assert.equal(tenant,'site');assert.equal(key,'fixture');checks++};
 assert.equal((await service.detail({},'site','fixture',id)).qrCode,'qr');assert.equal(checks,2);
 for(const row of [{...task,tenantId:'other'},{...task,applicationKey:'other'},{...task,deletedAt:new Date()},null]){current=row;await assert.rejects(service.detail({},'site','fixture',id),e=>e.code==='MINI_TASK_MISSING');}
});
