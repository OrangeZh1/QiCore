import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';

test('client login, registration and password recovery identify missing or malformed fields independently',async()=>{
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const {descriptor}=compiler.parse(await readFile(new URL('../client/pages/login/index.vue',import.meta.url),'utf8'));
 const script=compiler.compileScript(descriptor,{id:'auth-field-validation'}),{code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}},requests=[];
 const runtime={apiBase:'/api/v1',tenantId:'fixture',applicationKey:'fixture',registration:{passwordLoginEnabled:true,smsLoginEnabled:true},policies:[{kind:'terms',version:1},{kind:'privacy',version:1}]};
 const bridge={isH5:false,message:e=>e.message,api:async path=>{requests.push(path);return {account:'fixture'}},loginPassword:async()=>requests.push('password'),loginSms:async()=>requests.push('sms')};
 const scope=vue.effectScope();let state;
 new Function('require','module','exports','setInterval','clearInterval','uni',code)(name=>name==='vue'?{...vue,onBeforeUnmount(){}}:name.includes('runtime-config')?{runtimeConfig:()=>runtime}:name==='@dcloudio/uni-app'?{onLoad(){}}:name.endsWith('/api')?bridge:{},module,module.exports,()=>1,()=>{}, {reLaunch(){}});
 scope.run(()=>{state=module.exports.default.setup({},{expose(){}})});
 try{
  const set=(mode,values={})=>{state.changeMode(mode);Object.assign(state.runtime,runtime);state.agreed.value=true;state.account.value='fixture';state.phone.value='13800138000';state.password.value='test12';state.confirmation.value='test12';state.code.value='123456';for(const [key,value] of Object.entries(values))state[key].value=value};
  for(const [mode,values,expected] of [
   ['password',{account:''},'请输入账号'],['password',{password:''},'请输入密码'],
   ['register',{password:'12345',confirmation:'12345'},'密码须为 6–128 个字符'],
   ['sms',{phone:'invalid'},'手机号须为有效的 11 位手机号'],['sms',{code:'abc'},'验证码须为 6 位数字'],
   ['reset',{code:'abc'},'验证码须为 6 位数字']
  ]){set(mode,values);await state.submit();assert.equal(state.error.value,expected);assert.equal(state.action.value,'');assert.equal(requests.length,0)}
  set('register');await state.submit();assert.deepEqual(requests,['password']);
  set('reset');await state.submit();assert.equal(requests.at(-1),'/consumer/auth/sms/reset');assert.equal(state.error.value,'');
 }finally{scope.stop()}
});
