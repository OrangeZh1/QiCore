import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {ref,computed} from 'vue';
import {TenantPayments} from '../../api/src/core/tenant-payments.mjs';
import {PaymentClientPolicy} from '../../api/src/payments/client-policy.mjs';
import {PaymentExecution} from '../../api/src/payments/execution.mjs';

test('payment setup reports saved configuration and execution availability without treating unverified live payments as unimplemented',async()=>{
 const source=await readFile(new URL('../app/components/tenant/TenantPaymentSettings.vue',import.meta.url),'utf8');
 const snippet=source.slice(source.indexOf('const paymentNotice='),source.indexOf('const requestUrl='));
 const code=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const channel=ref(null),isWechat=ref(false),isVirtual=ref(false),data=ref(null),notice=new Function('computed','channel','isWechat','isVirtual','data',code+';return paymentNotice')(computed,channel,isWechat,isVirtual,data);
 assert.equal(notice.value,null);
 channel.value={config:{enabled:true}};assert.equal(notice.value.title,'支付能力暂不可用');
 channel.value={config:{enabled:false},execution:{implemented:true,enabled:true,liveVerified:false}};
 assert.equal(notice.value.title,'支付配置不完整');assert.equal(notice.value.color,'warning');
 channel.value.config.enabled=true;channel.value.execution.enabled=false;
 assert.equal(notice.value.title,'支付执行未启用');assert.match(notice.value.description,/当前站点尚未启用支付执行/);
 channel.value.execution.enabled=true;assert.equal(notice.value.title,'支付配置就绪');assert.equal(notice.value.color,'success');assert.match(notice.value.description,/以支付渠道回执和订单状态为准/);
 channel.value.execution.implemented=false;assert.equal(notice.value.title,'支付能力暂不可用');
 isWechat.value=true;data.value={miniProgramSubjectType:'personal'};assert.match(notice.value.title,/个人主体/);assert.equal(notice.value.color,'warning');
 assert.ok(!source.includes('integrationReady'));assert.ok(!source.includes('待真实支付联调'));
});

test('payment execution flags still block execution and are reported separately from merchant configuration',async t=>{
 const old=process.env.PAYMENT_EXECUTION_ENABLED;t.after(()=>{if(old===undefined)delete process.env.PAYMENT_EXECUTION_ENABLED;else process.env.PAYMENT_EXECUTION_ENABLED=old});
 const settings=new TenantPayments({},{}),policy=new PaymentClientPolicy({});
 const row={provider:'alipay',config:{enabled:true,appId:'2026000000000001',sellerId:'2088000000000001'},secretFields:['privateKey','publicKey']};
 process.env.PAYMENT_EXECUTION_ENABLED='false';
 assert.deepEqual(await policy.status({}, {}, 'h5', 'alipay', [row]),{configured:true,reason:'平台尚未启用支付执行'});
 assert.equal(settings.expose('alipay',row).config.enabled,true);assert.equal(settings.expose('alipay',row).execution.enabled,false);
 assert.throws(()=>PaymentExecution.prototype.assertEnabled.call({enabled:false}),error=>error.code==='PAYMENT_INTEGRATION_BLOCKED'&&error.message.includes('尚未启用支付执行'));
 process.env.PAYMENT_EXECUTION_ENABLED='true';
 assert.equal(settings.expose('alipay',row).execution.enabled,true);assert.equal((await policy.status({}, {}, 'h5', 'alipay', [row])).reason,null);
 assert.equal(settings.expose('alipay',null).config.enabled,false);assert.deepEqual(await policy.status({}, {}, 'h5', 'alipay', []),{configured:false,reason:'商户配置不完整'});
 assert.doesNotThrow(()=>PaymentExecution.prototype.assertEnabled.call({enabled:true}));
});
