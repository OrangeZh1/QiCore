import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';

async function fixture(t,registration={passwordLoginEnabled:true,smsLoginEnabled:true,autoRegister:true}){
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),{descriptor}=compiler.parse(await readFile(new URL('../client/pages/login/index.vue',import.meta.url),'utf8'));
 const {code}=await transform(compiler.compileScript(descriptor,{id:'native-login'}).content,{loader:'ts',format:'cjs'}),module={exports:{}},attempts=[],navigations=[],hooks={};
 const runtime={apiBase:'/api/v1',tenantId:'site',applicationKey:'app',registration,policies:[{kind:'terms',version:2},{kind:'privacy',version:3}]};
 const pending=(mode,values,consent)=>new Promise((resolve,reject)=>attempts.push({mode,values,consent,resolve,reject}));
 const bridge={isH5:false,message:e=>e.message,loginWechat:consent=>pending('wechat',[],consent),loginPassword:(account,password,register,consent)=>pending(register?'register':'password',[account,password],consent),loginSms:(phone,code,consent)=>pending('sms',[phone,code],consent)};
 new Function('require','module','exports','setInterval','clearInterval','uni',code)(name=>name==='vue'?{...vue,onBeforeUnmount:fn=>hooks.unmount=fn}:name.includes('runtime-config')?{runtimeConfig:()=>runtime}:name==='@dcloudio/uni-app'?{onLoad:fn=>hooks.load=fn}:name.endsWith('/api')?bridge:{},module,module.exports,()=>1,()=>{}, {reLaunch:options=>navigations.push(options.url)});
 const scope=vue.effectScope(),state=scope.run(()=>module.exports.default.setup({},{expose(){}}));t.after(()=>{hooks.unmount();scope.stop()});
 return{state,attempts,navigations,hooks,runtime};
}
test('native login requires agreement, owns its loading state and returns to the source page',async t=>{
 const f=await fixture(t),s=f.state;await f.hooks.load({returnPath:encodeURIComponent('/pages/profile/index')});
 await s.nativeLogin();assert.equal(f.attempts.length,0);assert.match(s.error.value,/同意/);
 s.agreed.value=true;const login=s.nativeLogin();assert.equal(s.action.value,'wechat');assert.equal(s.sending.value,false);assert.deepEqual(f.attempts[0].consent,{terms:2,privacy:3});await s.nativeLogin();assert.equal(f.attempts.length,1);
 f.attempts.shift().resolve();await login;assert.deepEqual(f.navigations,['/pages/profile/index']);assert.equal(s.action.value,'');
 for(const path of ['https://example.com','//example.com','/pages/login/index','/pages/../index'])assert.equal(s.back(path),'/pages/home/index');
 assert.equal(s.back('/pages/result/index?id=work-1'),'/pages/result/index?id=work-1');
});
test('failed or departed native logins clear loading without navigating another scope',async t=>{
 const f=await fixture(t),s=f.state;s.agreed.value=true;let login=s.nativeLogin();f.attempts.shift().reject(Error('登录未完成'));await login;assert.equal(s.error.value,'登录未完成');assert.equal(s.action.value,'');assert.deepEqual(f.navigations,[]);
 login=s.nativeLogin();f.runtime.tenantId='another-site';f.attempts.shift().resolve();await login;assert.deepEqual(f.navigations,[]);assert.equal(s.action.value,'');
});

test('native login defaults to WeChat regardless of optional password and SMS settings',async t=>{
 for(const registration of [{passwordLoginEnabled:true,smsLoginEnabled:true},{passwordLoginEnabled:false,smsLoginEnabled:false}]){
  const f=await fixture(t,registration);await f.hooks.load({});assert.equal(f.state.mode.value,'wechat');assert.equal(f.state.agreed.value,false);
 }
});

test('native alternate login modes submit the selected credentials and own their loading state',async t=>{
 const f=await fixture(t),s=f.state;await f.hooks.load({returnPath:'/pages/records/index'});s.agreed.value=true;
 for(const mode of ['password','sms']){
  s.changeMode(mode);s.account.value='fixture';s.password.value='test12';s.phone.value='13800138000';s.code.value='123456';
  const login=s.submit();assert.equal(s.action.value,mode);assert.equal(s.sending.value,false);assert.equal(f.attempts.length,1);
  s.changeMode('wechat');assert.equal(s.mode.value,mode);await s.nativeLogin();assert.equal(f.attempts.length,1);
  const attempt=f.attempts.shift();assert.equal(attempt.mode,mode);assert.deepEqual(attempt.values,mode==='password'?['fixture','test12']:['13800138000','123456']);assert.deepEqual(attempt.consent,{terms:2,privacy:3});
  attempt.reject(Error('请重试'));await login;assert.equal(s.action.value,'');assert.equal(s.error.value,'请重试');assert.deepEqual(f.navigations,[]);
 }
 s.changeMode('wechat');assert.equal(s.password.value,'');assert.equal(s.code.value,'');assert.equal(s.error.value,'');
 const login=s.submit();assert.equal(f.attempts[0].mode,'wechat');f.attempts.shift().resolve();await login;assert.deepEqual(f.navigations,['/pages/records/index']);
});
