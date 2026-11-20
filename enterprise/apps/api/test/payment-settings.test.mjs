import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TenantPayments} from '../src/core/tenant-payments.mjs';
import {paymentDefaults,paymentConfigured,validatePaymentKeys} from '../src/payments/config.mjs';
import {miniSubjectType} from '../src/payments/product-policy.mjs';
import {PaymentClientPolicy} from '../src/payments/client-policy.mjs';

function fixture(){
 const rows=[],audits=[],scope={tenantId:'site-a',applicationKey:'test-app'};
 let appId='wx1234567890abcdef',subjectType='business';
 const db={tenantPaymentRevision:{findFirst:async({where})=>rows.filter(r=>Object.entries(where).every(([k,v])=>r[k]===v)).at(-1)||null,create:async({data})=>rows.push(data)},tenantMiniProgramSetting:{findUnique:async({where})=>{assert.deepEqual(where.tenantId_applicationKey,scope);return{config:{appId,...(subjectType!==undefined?{subjectType}:{})},keyCipher:'fixture'}}},audit:{create:async({data})=>audits.push(data)},$transaction:async fn=>fn(db)};
 const service=new TenantPayments(db,{decrypt:(_aad,value)=>JSON.parse(value),encrypt:(_aad,value)=>JSON.stringify(value),assertExistingKey:async()=>{}});
 const context=async()=>({selected:{key:scope.applicationKey},sources:[],permissions:['settings.read','settings.write']});
 service.context=context;service.writeContext=context;service.apps.transaction=async fn=>fn(db);
 const save=(config,secrets={},version=rows.length,provider='wechat-virtual')=>service.save({id:'admin'},scope.tenantId,scope.applicationKey,provider,{version,config,secrets});
 return{db,service,rows,audits,save,setAppId:value=>appId=value,setSubjectType:value=>subjectType=value,scope};
}

test('partial virtual setup preserves keys when filling identity, uses only the scoped mini AppID and retains drafts across incomplete saves',async()=>{
 const f=fixture(),config={...paymentDefaults['wechat-virtual']};
 await f.save(config,{sandboxAppKey:'sandbox-key',callbackToken:'originalToken'});
 assert.equal(f.rows[0].config.appId,'wx1234567890abcdef');assert.equal(f.rows[0].config.enabled,false);
 await f.save({...config,offerId:'123'});
 assert.equal(f.rows[1].config.enabled,true);assert.equal(f.service.decrypt(f.rows[1]).sandboxAppKey,'sandbox-key');
 await f.save({...f.rows[1].config,env:0});
 assert.equal(f.rows[2].config.enabled,false);assert.equal(f.service.decrypt(f.rows[2]).callbackToken,'originalToken');
 await f.save({...f.rows[2].config},{appKey:'live-key'});
 assert.equal(f.rows[3].config.enabled,true);
 await assert.rejects(f.save(f.rows[3].config,{},0),{code:'PAYMENT_CONFIG_CONFLICT'});
 assert.equal(f.rows.length,4);assert.equal(f.audits.length,4);
});

test('real identity replacement can be saved incomplete without reusing former credentials; old order revision remains intact',async()=>{
 const f=fixture();await f.save({...paymentDefaults['wechat-virtual'],offerId:'123'},{sandboxAppKey:'old-key'});
 await f.save({...f.rows[0].config,offerId:'456'});
 assert.equal(f.rows[1].config.enabled,false);assert.deepEqual(f.rows[1].secretFields,[]);assert.equal(f.service.decrypt(f.rows[0]).sandboxAppKey,'old-key');
 await assert.rejects(f.service.check({id:'admin'},f.scope.tenantId,f.scope.applicationKey,'wechat-virtual',{version:2}),{code:'PAYMENT_CONFIG_INCOMPLETE'});
 f.setAppId('wxabcdef1234567890');
 await assert.rejects(f.save(f.rows[1].config),{code:'MINI_PAYMENT_APPID_MISMATCH'});
 await f.save({...f.rows[1].config,appId:'wxabcdef1234567890'});
 assert.equal(f.rows[2].config.enabled,false);
 f.setAppId('');await f.save({...f.rows[2].config,appId:''});assert.equal(f.rows[3].config.appId,'');assert.equal(f.rows[3].config.enabled,false);
});

test('WeChat partial setup preserves credentials on ordinary edits and accepts an incomplete protocol replacement',async()=>{
 const f=fixture(),config={...paymentDefaults.wechat,apiVersion:'V2',mchId:'123456',appId:'wx1234567890abcdef'};
 await f.save(config,{apiV2Key:'a'.repeat(32)},0,'wechat');
 await f.save({...config,serialNo:'A'.repeat(16)},{},1,'wechat');
 assert.equal(f.service.decrypt(f.rows[1]).apiV2Key,'a'.repeat(32));
 await f.save({...config,apiVersion:'V3'},{},2,'wechat');
 assert.deepEqual(f.rows[2].secretFields,[]);assert.equal(f.rows[2].config.enabled,false);
 assert.equal(f.service.decrypt(f.rows[0]).apiV2Key,'a'.repeat(32));
});

test('unknown mini subjects save unusable drafts without promoting a client default or losing compatible keys',async()=>{
 for(const subject of [undefined,'unknown']){
  const f=fixture();f.setSubjectType(subject);
  const config={...paymentDefaults['wechat-virtual'],offerId:'123'};
  const result=await f.save(config,{sandboxAppKey:'draft-key'});
  assert.equal(f.rows[0].config.subjectType,'unknown');assert.equal(f.rows[0].config.enabled,false);
  assert.equal(result.channels.find(row=>row.provider==='wechat-virtual').config.enabled,false);
  assert.equal(await miniSubjectType(f.db,f.scope),'unknown');
  assert.equal(paymentConfigured('wechat-virtual',f.rows[0].config,f.rows[0].secretFields),false);
  assert.throws(()=>validatePaymentKeys('wechat-virtual',f.rows[0].config,f.service.decrypt(f.rows[0]),true),{code:'PAYMENT_CONFIG_INCOMPLETE'});
  await assert.rejects(f.service.check({id:'admin'},f.scope.tenantId,f.scope.applicationKey,'wechat-virtual',{version:1}),{code:'MINI_SUBJECT_REQUIRED'});
  await assert.rejects(new PaymentClientPolicy(f.db).product(f.db,f.scope,'mini','wechat-virtual',{paymentKind:()=> 'virtual'},{}),{code:'MINI_SUBJECT_REQUIRED'});
  await f.save(config);assert.equal(await miniSubjectType(f.db,f.scope),'unknown');assert.equal(f.service.decrypt(f.rows[1]).sandboxAppKey,'draft-key');
  f.setSubjectType('business');
  await assert.rejects(f.save(f.rows[1].config),{code:'MINI_SUBJECT_CHANGED'});
  await f.save({...f.rows[1].config,subjectType:'business'});
  assert.equal(f.rows[2].config.enabled,true);assert.equal(f.service.decrypt(f.rows[2]).sandboxAppKey,'draft-key');
  f.setAppId('');f.setSubjectType('unknown');await f.save({...f.rows[2].config,appId:''});
  assert.equal(f.rows[3].config.subjectType,'unknown');assert.equal(f.rows[3].config.enabled,false);
 }
});

test('current subject changes disable old revisions and block self-check without rewriting historical credentials',async()=>{
 const f=fixture();await f.save({...paymentDefaults['wechat-virtual'],offerId:'123'},{sandboxAppKey:'old-key'});
 for(const [subject,code] of [['personal','MINI_SUBJECT_CHANGED'],['unknown','MINI_SUBJECT_REQUIRED']]){
  f.setSubjectType(subject);const result=await f.service.view({id:'admin'},f.scope.tenantId,{applicationKey:f.scope.applicationKey});
  assert.equal(result.channels.find(row=>row.provider==='wechat-virtual').config.enabled,false);
  await assert.rejects(f.service.check({id:'admin'},f.scope.tenantId,f.scope.applicationKey,'wechat-virtual',{version:1}),{code});
 }
 assert.equal(f.rows[0].config.subjectType,'business');assert.equal(f.rows[0].config.enabled,true);assert.equal(f.service.decrypt(f.rows[0]).sandboxAppKey,'old-key');
 f.setSubjectType('personal');await f.save({...f.rows[0].config,subjectType:'personal',env:0},{appKey:'live-key'});
 assert.equal(f.rows[1].config.enabled,false);
 await f.save(f.rows[1].config,{callbackToken:'personalToken',encodingAESKey:Buffer.alloc(32,1).toString('base64').replace(/=$/,'')});
 assert.equal(f.rows[2].config.enabled,true);assert.equal(f.rows[2].config.env,0);
});

test('same-AppID legacy subject revisions remain readable and checkable until the channel declares a new subject',async()=>{
 const f=fixture();await f.save({...paymentDefaults['wechat-virtual'],offerId:'123'},{sandboxAppKey:'legacy-key'});f.setSubjectType(undefined);
 assert.equal(await miniSubjectType(f.db,f.scope),'business');
 const result=await f.service.view({id:'admin'},f.scope.tenantId,{applicationKey:f.scope.applicationKey});
 assert.equal(result.channels.find(row=>row.provider==='wechat-virtual').config.enabled,true);
 assert.equal((await f.service.check({id:'admin'},f.scope.tenantId,f.scope.applicationKey,'wechat-virtual',{version:1})).version,1);
 f.setSubjectType('unknown');assert.equal(await miniSubjectType(f.db,f.scope),'unknown');
});
