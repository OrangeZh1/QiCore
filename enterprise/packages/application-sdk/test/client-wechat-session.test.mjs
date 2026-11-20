import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as h5Routes from '../../../apps/api/src/core/h5-routes.mjs';

const compile=async path=>(await transform((await readFile(new URL(path,import.meta.url),'utf8')).replaceAll('import.meta.env','ENV'),{loader:'ts',format:'cjs',target:'es2022'})).code;
const runtimeCode=await compile('../client/lib/runtime-config.ts'),apiCode=await compile('../client/lib/api.ts');
const appId='wx1234567890abcdef',otherAppId='wxfedcba0987654321';
function client(development=true){
 const env={UNI_PLATFORM:'mp-weixin',DEV:development,VITE_TENANT_ID:'site-a',VITE_API_BASE:'https://fixture.example.com/api/v1'};
 const state={appId,settingsAppId:appId,response:{},switchBeforeResponse:null,missingAccountApi:false,runtime:{appId,siteId:'site-a',apiDomain:'https://fixture.example.com'},missingRuntime:false};
 const storage=new Map(),requests=[];let logins=0;
 const uni={
  getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),
  getAccountInfoSync(){if(state.missingAccountApi)throw Error('unavailable');return{miniProgram:{appId:state.appId}}},
  getFileSystemManager:()=>({readFileSync(){if(state.missingRuntime)throw Error('missing runtime');return JSON.stringify(state.runtime)}}),
  login(options){logins++;options.success({code:'fixture-code'})},navigateTo(){},
  request(options){requests.push(options);if(options.url.includes('/settings?'))options.success({statusCode:200,data:{data:{enabled:true,appId:state.settingsAppId}}});else{state.switchBeforeResponse?.();options.success({statusCode:200,data:{data:{token:'a'.repeat(64),tenantId:'site-a',applicationKey:'app-a',userId:'user-a',authAppId:appId,expiresAt:'2099-01-01T00:00:00Z',...state.response}}})}}
 };
 const runtime={exports:{}};new Function('module','exports','uni','ENV','__QICORE_APPLICATION_KEY__',runtimeCode)(runtime,runtime.exports,uni,env,'app-a');
 function reload(){const module={exports:{}};new Function('module','exports','require','uni','ENV',apiCode)(module,module.exports,name=>name==='./runtime-config'?runtime.exports:h5Routes,uni,env);return module.exports}
 return{api:reload(),reload,runtime:runtime.exports,state,env,storage,requests,logins:()=>logins};
}

test('development WeChat login survives session checks and module reload with the actual runtime AppID',async()=>{
 const c=client();assert.equal(c.runtime.runtimeConfig().appId,appId);
 await c.api.loginWechat();await c.api.ensureSession({redirect:false});assert.equal(await c.api.consumerReady(),true);
 assert.equal(c.api.getToken(),'a'.repeat(64));assert.equal(c.logins(),1);assert.equal(c.requests.length,2);
 const reloaded=c.reload();await reloaded.ensureSession({redirect:false});assert.equal(reloaded.getToken(),c.api.getToken());assert.equal(c.requests.length,2);
 c.state.appId=otherAppId;await assert.rejects(reloaded.ensureSession({redirect:false}),{code:'LOGIN_REQUIRED'});assert.equal(reloaded.getToken(),'');
});

test('mini login rejects mismatched settings, responses and runtime changes before saving a session',async()=>{
 const mismatch=client();mismatch.state.settingsAppId=otherAppId;
 await assert.rejects(mismatch.api.loginWechat(),{code:'MINI_APPID_MISMATCH'});assert.equal(mismatch.logins(),0);assert.equal(mismatch.requests.length,1);assert.equal(mismatch.api.getToken(),'');
 for(const response of [{authAppId:otherAppId},{authAppId:undefined},{tenantId:'site-b'},{applicationKey:'app-b'}]){
  const c=client();c.state.response=response;await assert.rejects(c.api.loginWechat(),{code:'SESSION_CHANGED'});assert.equal(c.storage.size,0);
 }
 for(const change of [c=>c.state.appId=otherAppId,c=>c.env.VITE_TENANT_ID='site-b',c=>c.api.signOut()]){
  const c=client();c.state.switchBeforeResponse=()=>change(c);await assert.rejects(c.api.loginWechat(),{code:'SESSION_CHANGED'});assert.equal(c.api.getToken(),'');
 }
});

test('missing, placeholder or invalid runtime AppIDs never authorize a cached mini session',async()=>{
 for(const value of ['',undefined,'wx0000000000000000','wxnot-a-real-appid','wxgggggggggggggggg']){
  const c=client();c.state.appId=value;assert.equal(c.runtime.runtimeConfig().appId,'');
  await assert.rejects(c.api.loginWechat(),{code:'WECHAT_ENV_REQUIRED'});assert.equal(c.requests.length,0);
  c.storage.set(c.api.sessionStorageKey('zjz-token'),'untrusted-token');c.storage.set(c.api.sessionStorageKey('zjz-session'),{...c.runtime.runtimeConfig(),mode:'wechat',expiresAt:'2099-01-01T00:00:00Z'});
  await assert.rejects(c.api.ensureSession({redirect:false}),{code:'LOGIN_REQUIRED'});assert.equal(c.api.getToken(),'');
 }
 const missing=client();missing.state.missingAccountApi=true;await assert.rejects(missing.api.loginWechat(),{code:'WECHAT_ENV_REQUIRED'});assert.equal(missing.requests.length,0);
});

test('restored mini sessions still require matching site, application, endpoint, mode and expiry',async()=>{
 for(const invalid of [{tenantId:'site-b'},{applicationKey:'app-b'},{apiBase:'https://other.example.com/api/v1'},{mode:'official'},{expiresAt:'2000-01-01T00:00:00Z'}]){
  const c=client();await c.api.loginWechat();const key=c.api.sessionStorageKey('zjz-session');c.storage.set(key,{...c.storage.get(key),...invalid});
  await assert.rejects(c.api.ensureSession({redirect:false}),{code:'LOGIN_REQUIRED'});assert.equal(c.api.getToken(),'');
 }
});

test('native password and SMS sessions survive reload while keeping AppID, site and endpoint isolation',async()=>{
 for(const mode of ['password','sms']){
  const c=client();c.state.response={authAppId:undefined};
  if(mode==='password')await c.api.loginPassword('fixture','test12');else await c.api.loginSms('13800138000','123456');
  assert.equal(c.storage.get(c.api.sessionStorageKey('zjz-session')).mode,mode);
  assert.equal(c.storage.get(c.api.sessionStorageKey('zjz-session')).appId,appId);
  await c.reload().ensureSession({redirect:false});assert.equal(await c.api.consumerReady(),true);assert.equal(c.logins(),0);
  c.state.appId=otherAppId;await assert.rejects(c.api.ensureSession({redirect:false}),{code:'LOGIN_REQUIRED'});assert.equal(c.api.getToken(),'');
  const changed=client();changed.state.switchBeforeResponse=()=>{changed.state.appId=otherAppId};
  await assert.rejects(mode==='password'?changed.api.loginPassword('fixture','test12'):changed.api.loginSms('13800138000','123456'),{code:'SESSION_CHANGED'});assert.equal(changed.api.getToken(),'');
 }
});

test('production mini configuration still requires the issued AppID, valid site and public HTTPS endpoint',async()=>{
 const valid=client(false);await valid.api.loginWechat();await valid.api.ensureSession({redirect:false});assert.equal(valid.api.getToken(),'a'.repeat(64));
 for(const invalid of [{appId:otherAppId},{appId:'wx0000000000000000'},{siteId:''},{apiDomain:'http://fixture.example.com'},{apiDomain:'https://private.local'}]){
  const c=client(false);Object.assign(c.state.runtime,invalid);assert.throws(()=>c.runtime.runtimeConfig());await assert.rejects(c.api.loginWechat());assert.equal(c.requests.length,0);
 }
 const missing=client(false);missing.state.missingRuntime=true;assert.throws(()=>missing.runtime.runtimeConfig(),/发布配置缺失/);
 const changed=client(false);changed.state.appId=otherAppId;assert.throws(()=>changed.runtime.runtimeConfig(),/发布配置不一致/);
});
