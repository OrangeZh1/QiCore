import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentProductKind,assertMiniPaymentProduct,miniSubjectType,assertPaymentClient} from '../src/payments/product-policy.mjs';

test('virtual goods use virtual pay for both personal and business mini-programs',async()=>{
 for(const subject of ['personal','business']){
  const scope={tenantId:'site-a',applicationKey:'app-a'},db={tenantMiniProgramSetting:{findUnique:async({where})=>{assert.deepEqual(where.tenantId_applicationKey,scope);return{config:{appId:'wx1234567890abcdef',subjectType:subject}}}}};
  assert.equal(await miniSubjectType(db,scope),subject);
  const kind=paymentProductKind({paymentKind:()=> 'virtual'},{product:{paymentKind:'physical'}});
  assert.doesNotThrow(()=>assertMiniPaymentProduct(kind,'wechat-virtual'));
  assert.throws(()=>assertMiniPaymentProduct(kind,'wechat'),{code:'PAYMENT_PRODUCT_UNSUPPORTED',status:409});
 }
});
test('physical goods and unclassified goods cannot bypass product routing',()=>{
 assert.doesNotThrow(()=>assertMiniPaymentProduct('physical','wechat'));
 assert.throws(()=>assertMiniPaymentProduct('physical','wechat-virtual'),{code:'PAYMENT_PRODUCT_UNSUPPORTED'});
 const kind=paymentProductKind({},{product:{paymentKind:'physical'},kind:'physical'});
 assert.equal(kind,'unknown');
 for(const provider of ['wechat','wechat-virtual'])assert.throws(()=>assertMiniPaymentProduct(kind,provider),{code:'PAYMENT_PRODUCT_UNSUPPORTED'});
 assert.doesNotThrow(()=>assertMiniPaymentProduct(kind,'balance'));
});
test('a trusted mini-program identity cannot claim an H5 or official-account payment client',()=>{
 for(const client of ['h5','official'])assert.throws(()=>assertPaymentClient({authProvider:'wechat'},client),{code:'PAYMENT_CLIENT_MISMATCH'});
 assert.doesNotThrow(()=>assertPaymentClient({authProvider:'wechat'},'mini'));
 assert.doesNotThrow(()=>assertPaymentClient({authProvider:'password'},'h5'));
 assert.doesNotThrow(()=>assertPaymentClient({authProvider:'wechat-official'},'official'));
});
test('legacy subject declarations only carry over for the same mini-program AppID',async()=>{
 const scope={tenantId:'site-a',applicationKey:'app-a'},mini={config:{appId:'wx1234567890abcdef'}},db={tenantMiniProgramSetting:{findUnique:async()=>mini}};
 assert.equal(await miniSubjectType(db,scope,[]),'unknown');
 assert.equal(await miniSubjectType(db,scope,[{provider:'wechat-virtual',config:{appId:'wx0000000000000001',subjectType:'personal'}}]),'unknown');
 assert.equal(await miniSubjectType(db,scope,[{provider:'wechat-virtual',config:{appId:mini.config.appId,subjectType:'personal'}}]),'personal');
 mini.config.subjectType='unknown';assert.equal(await miniSubjectType(db,scope,[{provider:'wechat-virtual',config:{appId:mini.config.appId,subjectType:'personal'}}]),'unknown');
 mini.config.subjectType='business';assert.equal(await miniSubjectType(db,scope,[{provider:'wechat-virtual',config:{appId:mini.config.appId,subjectType:'personal'}}]),'business');
});
