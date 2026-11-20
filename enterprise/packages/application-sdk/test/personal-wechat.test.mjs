import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setImmediate as flush} from 'node:timers/promises';
import {transform} from 'esbuild';

async function page(t,isH5=false){
 const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc');
 const source=await readFile(new URL('../client/pages/personal/index.vue',import.meta.url),'utf8'),{descriptor}=compiler.parse(source),script=compiler.compileScript(descriptor,{id:'personal-native'});
 const {code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}},requests=[],images=[],hooks={};let token='token-a';
 const bridge={isH5,isClientPreview:false,isDevelopmentLogin:false,isSignedOut:()=>false,getToken:()=>token,identityScope:()=> 'site:app:user',ensureSession:async()=>{},message:e=>e.message,api:(path,method='GET',body)=>new Promise((resolve,reject)=>requests.push({path,method,body,resolve,reject})),useMaintenanceReload(){},runtimeConfig:()=>({}),clientImageUrl:v=>v||'',frameworkAsset:v=>v,profileAvatar:path=>new Promise((resolve,reject)=>images.push({path,resolve,reject}))};
 const uni={getStorageSync:()=>'',showToast(){},enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},chooseImage:()=>{throw Error('Native avatar must not call chooseImage')}};
 new Function('require','module','exports','uni','window',code)(name=>name==='vue'?{...vue,onMounted(){},getCurrentInstance:()=>({proxy:{}})}:name==='@dcloudio/uni-app'?{onShow:fn=>hooks.show=fn,onUnload:fn=>hooks.unload=fn}:bridge,module,module.exports,uni,{removeEventListener(){}});
 const scope=vue.effectScope(),state=scope.run(()=>module.exports.default.setup({},{expose(){}}));t.after(()=>{hooks.unload();scope.stop()});
 const read=state.load();await flush();requests.shift().resolve({id:'wx-internal',account:null,accountKind:'wechat',nickname:'旧昵称',avatar:null,memberNumber:'HY000001',phone:'',email:'',gender:'unknown',version:1,hasPassword:false});await read;requests.shift().resolve({phone:null});await flush();
 return{state,requests,images,source,changeIdentity:()=>{token='token-b'},unload:hooks.unload};
}

test('WeChat avatar and nickname use native events while keeping save explicit and ignoring late identity results',async t=>{
 const {state:s,images,requests,source,changeIdentity}=await page(t);
 assert.equal(s.accountLabel.value,'微信账号');assert.match(source,/open-type="isH5\?undefined:'chooseAvatar'"/);assert.match(source,/:type="isH5\?'text':'nickname'"/);assert.doesNotMatch(source,/\{\{profile.id\}\}/);
 await s.chooseWechatAvatar({detail:{}});assert.equal(images.length,0);assert.equal(s.action.value,'');
 const first=s.chooseWechatAvatar({detail:{avatarUrl:'wxfile://first'}});assert.equal(s.action.value,'avatar');assert.equal(requests.length,0);await s.chooseWechatAvatar({detail:{avatarUrl:'wxfile://duplicate'}});assert.equal(images.length,1);
 images.shift().resolve('data:image/jpeg;base64,first');await first;assert.equal(s.form.avatar,'data:image/jpeg;base64,first');assert.equal(s.action.value,'');assert.equal(requests.length,0);
 s.nicknameChanged({detail:{value:'微信昵称'}});assert.equal(s.form.nickname,'微信昵称');assert.equal(s.profileDirty.value,true);
 const late=s.chooseWechatAvatar({detail:{avatarUrl:'wxfile://late'}});changeIdentity();images.shift().resolve('data:image/jpeg;base64,late');await late;assert.equal(s.form.avatar,'data:image/jpeg;base64,first');
});

test('WeChat phone authorization is explicit, handles refusal and preserves unknown results without replaying a code',async t=>{
 const {state:s,requests,source}=await page(t);s.openPhone();await s.bindWechatPhone({detail:{errMsg:'getPhoneNumber:fail user deny'}});assert.equal(requests.length,0);assert.equal(s.action.value,'');
 s.profile.value.hasPassword=true;await s.bindWechatPhone({detail:{code:'unused-code'}});assert.equal(requests.length,0);assert.equal(s.nativePhoneError.value,'请输入当前账号密码');
 s.nativePhonePassword.value='password-fixture';const binding=s.bindWechatPhone({detail:{code:'one-time-code'}});assert.equal(s.action.value,'phone');assert.deepEqual(requests[0].body,{code:'one-time-code',password:'password-fixture'});assert.equal(requests[0].path,'/phone/wechat');assert.equal(requests[0].method,'PUT');
 await s.bindWechatPhone({detail:{code:'duplicate'}});assert.equal(requests.length,1);requests.shift().reject(Object.assign(Error('response lost'),{code:'NETWORK_UNKNOWN'}));await binding;
 assert.equal(s.nativePhoneUnknown.value,true);assert.equal(s.nativePhonePassword.value,'');assert.equal(s.action.value,'');await s.bindWechatPhone({detail:{code:'must-not-replay'}});assert.equal(requests.length,0);
 const reading=s.readWechatPhone();assert.equal(s.action.value,'phone-read');assert.equal(requests[0].method,'GET');requests.shift().resolve({phone:'13800138000'});await reading;assert.equal(s.nativePhoneUnknown.value,false);assert.equal(s.nativePhoneNotice.value,'当前已绑定号码：138****8000');assert.equal(s.verifiedPhone.value,'13800138000');
 assert.match(source,/v-if="phoneOpen&&isH5"/);assert.match(source,/open-type="getPhoneNumber"/);
});

test('H5 never submits native WeChat events and a departed native page ignores a late phone success',async t=>{
 const web=await page(t,true);web.state.openPhone();await web.state.bindWechatPhone({detail:{code:'native-code'}});await web.state.chooseWechatAvatar({detail:{avatarUrl:'wxfile://native'}});assert.equal(web.requests.length,0);assert.equal(web.images.length,0);
 const native=await page(t);native.state.openPhone();const binding=native.state.bindWechatPhone({detail:{code:'pending'}});native.unload();native.requests.shift().resolve({bound:true,phone:'13800138000'});await binding;assert.equal(native.state.verifiedPhone.value,null);assert.equal(native.state.nativePhoneNotice.value,'');
});

test('malformed successful phone responses and HTTP timeouts require a read instead of replaying authorization',async t=>{
 for(const failure of [{code:'API_RESPONSE_INVALID',status:200},{code:'HTTP_ERROR',status:408}]){
  const {state:s,requests}=await page(t);s.openPhone();const binding=s.bindWechatPhone({detail:{code:'one-time'}});requests.shift().reject(Object.assign(Error('unconfirmed'),failure));await binding;assert.equal(s.nativePhoneUnknown.value,true);await s.bindWechatPhone({detail:{code:'second'}});assert.equal(requests.length,0);
 }
 const {state:s,requests}=await page(t);s.openPhone();const binding=s.bindWechatPhone({detail:{code:'not-wechat-session'}});requests.shift().reject(Object.assign(Error('请先使用微信登录'),{code:'WECHAT_LOGIN_REQUIRED',status:403}));await binding;assert.ok(s.profile.value);assert.equal(s.nativePhoneError.value,'请先使用微信登录');assert.equal(s.nativePhoneUnknown.value,false);
});
