import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WechatConsumerAuth} from '../src/core/wechat-consumer-auth.mjs';

test('native WeChat login validates current policy versions before exchanging a one-use code',async()=>{
 const policies=[{kind:'terms',title:'协议',currentVersion:2},{kind:'privacy',title:'隐私',currentVersion:3}],reads=[],credentials=[];
 const db={tenantPolicyDocument:{findMany:async({where})=>{reads.push(where);return policies}}},redis={eval:async()=>1},settings={credentials:async(...args)=>{credentials.push(args);throw Error('credential boundary')}};
 const service=new WechatConsumerAuth(db,redis,settings),input={tenantId:'site-a',applicationKey:'app-a',code:'one-time-code'};
 for(const consent of [undefined,{terms:1,privacy:3}])await assert.rejects(service.login({...input,...(consent?{consent}:{})},'fixture'),{code:'POLICY_CONSENT_REQUIRED'});
 assert.equal(credentials.length,0);assert.equal(reads[0].tenantId,'site-a');assert.equal(reads[0].applicationKey,'app-a');
 await assert.rejects(service.login({...input,consent:{terms:2,privacy:3}},'fixture'),/credential boundary/);assert.equal(credentials.length,1);
});
