import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {WechatMiniIdentity} from '../dist/channels/wechat-mini.mjs';
import {WechatConsumerAuth,identityAad} from '../dist/core/wechat-consumer-auth.mjs';
import {ConsumerSmsAuth} from '../dist/core/consumer-sms-auth.mjs';
import {ConsumerProfiles} from '../dist/applications/consumer-profiles.mjs';
import {consumerAccountDisplay} from '../dist/core/consumer-account.mjs';
import {passwordHash} from '../dist/core/admin-auth.mjs';
import {TenantDecoration} from '../dist/core/tenant-decoration.mjs';
import {consumerSettingDefaults} from '../dist/core/tenant-consumer-settings.mjs';
import {setApplicationDefinitions} from '../dist/applications/catalog-state.mjs';
import {basicDecoration} from '../dist/core/decoration-contract.mjs';

setApplicationDefinitions(['phone-guest-fixture','photo'].map(key=>({key,name:'Fixture',permissions:[],decoration:{defaults:()=>basicDecoration.defaults(),targets:[]}})));
const identityFields=new Set(Prisma.dmmf.datamodel.models.find(model=>model.name==='ConsumerExternalIdentity').fields.map(field=>field.name));

const hash=value=>createHash('sha256').update(value).digest('hex'),appId='wx1234567890abcdef',openId='fixture-wechat-subject';
const credential={appId,appSecret:'fixture-only',version:1},phone='13800138000';
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('WeChat phone exchange uses the fixed server endpoint, current OpenID and app watermark',async()=>{
 const calls=[],client=new WechatMiniIdentity(async(url,options)=>{calls.push({url,options});return response(url.endsWith('stable_token')?{access_token:'fixture-token',expires_in:7200}:{errcode:0,phone_info:{purePhoneNumber:phone,countryCode:'86',watermark:{appid:appId}}})});
 assert.equal(await client.phone(credential,'one-time-phone-code',openId),phone);
 assert.equal(calls.length,2);assert.equal(calls[1].url,'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=fixture-token');
 assert.deepEqual(JSON.parse(calls[1].options.body),{code:'one-time-phone-code',openid:openId});assert.equal(calls[1].options.redirect,'error');assert.ok(calls[1].options.signal);
 for(const [value,code] of [[{errcode:40029},'WECHAT_PHONE_CODE_INVALID'],[{errcode:48001},'WECHAT_PHONE_UNAVAILABLE'],[{errcode:0,phone_info:{purePhoneNumber:phone,countryCode:'86',watermark:{appid:'other-app'}}},'WECHAT_PHONE_INVALID'],[{errcode:0,phone_info:{purePhoneNumber:'1234567890',countryCode:'1',watermark:{appid:appId}}},'WECHAT_PHONE_UNSUPPORTED']]){
  client.fetcher=async url=>response(url.endsWith('stable_token')?{access_token:'fixture-token',expires_in:7200}:value);
  await assert.rejects(client.phone(credential,'code',openId),e=>e.code===code);
 }
 client.fetcher=async url=>url.endsWith('stable_token')?response({access_token:'fixture-token',expires_in:7200}):new Response('x'.repeat(17000));
 await assert.rejects(client.phone(credential,'code',openId),e=>e.code==='WECHAT_PHONE_UNAVAILABLE');
});

function fixture(){
 const s={tenantId:'site-a',applicationKey:'photo',userId:'wx'+'a'.repeat(32),token:'session-a',role:'user',authProvider:'wechat',authAppId:appId,expiresAt:new Date(Date.now()+3600000)};
 const profile={...s,nickname:'微信用户',enabled:true,deletedAt:null,passwordHash:null,memberNumber:'HY00000001',version:1};
 let identities=[],audits=[],sessions=[{...s}],currentCredential={...credential},exchange=async()=>phone,failCreate=false;
 const profiles=[profile],store=new Map(),counts=new Map(),calls=[],availability=[];
 const match=(row,where)=>Object.entries(where).every(([k,v])=>k==='expiresAt'?row.expiresAt>v.gt:row[k]===v);
 const secrets={assertExistingKey:async()=>{},encrypt:(aad,value)=>JSON.stringify({aad,value}),decrypt:(aad,cipher)=>{const x=JSON.parse(cipher);assert.equal(aad,x.aad);return x.value}};
 const db={tenantConsumerSetting:{findUnique:async()=>null},consumerProfile:{findUnique:async({where})=>profiles.find(row=>match(row,where.tenantId_applicationKey_userId))||null},session:{findFirst:async({where})=>sessions.find(row=>match(row,where))||null},consumerExternalIdentity:{
  findFirst:async({where,select})=>{
   for(const field of Object.keys(select||{}))assert.ok(identityFields.has(field),'Unknown ConsumerExternalIdentity field: '+field);
   const row=identities.find(row=>match(row,where));
   return row&&select?Object.fromEntries(Object.keys(select).filter(field=>select[field]).map(field=>[field,row[field]])):row||null;
  },
  findUnique:async({where})=>identities.find(row=>match(row,where.tenantId_applicationKey_provider_appId_subjectHash))||null,
  create:async({data})=>{if(failCreate)throw Error('fixture database failed');const row={...data};identities.push(row);return row},
  deleteMany:async({where})=>{identities=identities.filter(row=>!match(row,where))}
 },audit:{create:async({data})=>{audits.push(data);return data}}};
 const apps={available:async(tenantId,applicationKey,_db,lock)=>{availability.push({tenantId,applicationKey,lock});if(!['site-a','site-b'].includes(tenantId)||!['photo','other'].includes(applicationKey))throw Error('scope unavailable')},transaction:async fn=>{const before=structuredClone(identities),beforeAudit=structuredClone(audits);try{return await fn(db)}catch(error){identities=before;audits=beforeAudit;throw error}}};
 const redis={set:async(key,value,_ex,_ttl,nx)=>{if(nx==='NX'&&store.has(key))return null;store.set(key,value);return'OK'},eval:async(_script,_keys,key)=>{const count=(counts.get(key)||0)+1;counts.set(key,count);return count}};
 const sms={secrets,digest:(tenant,key,value)=>hash(JSON.stringify([tenant,key,value]))};
 const phoneAuth=new ConsumerSmsAuth(db,redis,sms);phoneAuth.apps=apps;
 const settings={apps,secrets,credentials:async(tenant,key)=>{await apps.available(tenant,key);return {...currentCredential}}};
 const wechat=new WechatConsumerAuth(db,redis,settings,{client:{phone:async(...args)=>{calls.push(args);return exchange(...args)}}});
 function addWechat(identity=s){const row={tenantId:identity.tenantId,applicationKey:identity.applicationKey,userId:identity.userId,provider:'wechat',appId:identity.authAppId,subjectHash:hash(openId)};row.identityCipher=secrets.encrypt(identityAad(row),{openId});identities.push(row)}
 addWechat();
 return{s,profile,db,apps,phoneAuth,wechat,calls,availability,profiles,addWechat,get identities(){return identities},get audits(){return audits},get store(){return store},set credential(v){currentCredential=v},set exchange(fn){exchange=fn},set sessions(v){sessions=v},set failCreate(v){failCreate=v},addPhone:async(number,userId=s.userId,scope=s)=>phoneAuth.bind(db,{...scope,phone:number},userId)};
}

test('native authorization binds the current scoped member and a read recovers a lost response',async()=>{
 const f=fixture(),result=await f.wechat.bindPhone(f.s,{code:'authorized'},f.phoneAuth);
 assert.deepEqual(result,{bound:true,phone});assert.deepEqual(await f.phoneAuth.binding(f.s),{phone});
 assert.equal(f.calls[0][2],openId);assert.equal(f.profile.userId,f.s.userId);assert.equal(f.profile.memberNumber,'HY00000001');
 assert.equal(f.audits.at(-1).details.source,'wechat');assert.ok(!JSON.stringify(f.audits).includes(phone));assert.ok(f.availability.some(row=>row.lock===true));
 await assert.rejects(f.wechat.bindPhone(f.s,{code:'authorized'},f.phoneAuth),e=>e.code==='WECHAT_PHONE_CODE_INVALID');assert.equal(f.calls.length,1);
});

test('cancelled, forged and cross-context requests never exchange a phone code',async()=>{
 for(const body of [{},{code:''},{code:'ok',phone},{code:'ok',tenantId:'site-b'},{code:'ok',appId:'other'},{code:'ok',userId:'victim'}]){
  const f=fixture();await assert.rejects(f.wechat.bindPhone(f.s,body,f.phoneAuth),e=>e.code==='WECHAT_PHONE_INPUT');assert.equal(f.calls.length,0);
 }
 for(const patch of [{authProvider:'sms'},{authAppId:'wxabcdef1234567890'},{applicationKey:'other'},{tenantId:'site-b'},{userId:'victim'},{role:'admin'}]){
  const f=fixture();await assert.rejects(f.wechat.bindPhone({...f.s,...patch},{code:'scope-test'},f.phoneAuth));assert.equal(f.calls.length,0);
 }
 const disabled=fixture();disabled.profile.enabled=false;await assert.rejects(disabled.wechat.bindPhone(disabled.s,{code:'disabled'},disabled.phoneAuth),e=>e.code==='CONSUMER_DISABLED');assert.equal(disabled.calls.length,0);
});

test('concurrent callbacks spend one code once; uncertain exchange is never automatically replayed',async()=>{
 const f=fixture();let done;f.exchange=()=>new Promise(resolve=>done=resolve);
 const first=f.wechat.bindPhone(f.s,{code:'concurrent'},f.phoneAuth);while(!done)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(f.wechat.bindPhone(f.s,{code:'concurrent'},f.phoneAuth),e=>e.code==='WECHAT_PHONE_CODE_INVALID');assert.equal(f.calls.length,1);
 done(phone);await first;assert.equal(f.identities.filter(row=>row.provider==='sms').length,1);
 const unknown=fixture();unknown.exchange=async()=>{throw Error('fixture transport timeout')};await assert.rejects(unknown.wechat.bindPhone(unknown.s,{code:'unknown'},unknown.phoneAuth));
 await assert.rejects(unknown.wechat.bindPhone(unknown.s,{code:'unknown'},unknown.phoneAuth),e=>e.code==='WECHAT_PHONE_CODE_INVALID');assert.equal(unknown.calls.length,1);assert.deepEqual(await unknown.phoneAuth.binding(unknown.s),{phone:null});
});

test('failed password checks are rate limited before spending a WeChat code or calling upstream',async()=>{
 const f=fixture();let passwords=0;f.phoneAuth.bindingPassword=async()=>{passwords++;throw Object.assign(Error('invalid password'),{code:'PASSWORD_INVALID'})};
 for(let i=0;i<10;i++)await assert.rejects(f.wechat.bindPhone(f.s,{code:'unspent',password:'wrong'},f.phoneAuth),e=>e.code==='PASSWORD_INVALID');
 await assert.rejects(f.wechat.bindPhone(f.s,{code:'unspent',password:'wrong'},f.phoneAuth),e=>e.code==='WECHAT_PHONE_LIMIT');assert.equal(passwords,10);assert.equal(f.calls.length,0);assert.equal(f.store.size,0);
});

test('phone conflicts never merge members and verified phone identities remain tenant/application scoped',async()=>{
 const f=fixture();await f.addPhone('13900139000');await f.addPhone(phone,'another-user');
 await assert.rejects(f.wechat.bindPhone(f.s,{code:'conflict'},f.phoneAuth),e=>e.code==='PHONE_ALREADY_BOUND');assert.deepEqual(await f.phoneAuth.binding(f.s),{phone:'13900139000'});
 const separate=fixture();await separate.addPhone(phone,'external-user',{...separate.s,tenantId:'site-b'});await separate.addPhone(phone,'external-user',{...separate.s,applicationKey:'other'});
 await separate.wechat.bindPhone(separate.s,{code:'allowed-scope'},separate.phoneAuth);assert.equal(separate.identities.filter(row=>row.provider==='sms').length,3);
 assert.ok(separate.identities.some(row=>row.tenantId==='site-b'&&row.userId==='external-user'));assert.ok(separate.identities.some(row=>row.applicationKey==='other'&&row.userId==='external-user'));
});

test('separate valid WeChat sessions bind within their own domains and cannot reuse another domain code',async()=>{
 const f=fixture(),other={...f.s,tenantId:'site-b',applicationKey:'other',userId:'wx'+'b'.repeat(32),token:'session-b'};
 f.sessions=[f.s,other];f.profiles.push({...f.profile,...other,memberNumber:'HY00000001'});f.addWechat(other);
 await f.wechat.bindPhone(f.s,{code:'first-domain'},f.phoneAuth);
 await assert.rejects(f.wechat.bindPhone(other,{code:'first-domain'},f.phoneAuth),e=>e.code==='WECHAT_PHONE_CODE_INVALID');
 await f.wechat.bindPhone(other,{code:'second-domain'},f.phoneAuth);
 const rows=f.identities.filter(row=>row.provider==='sms');assert.equal(rows.length,2);
 assert.ok(rows.some(row=>row.tenantId===f.s.tenantId&&row.applicationKey===f.s.applicationKey&&row.userId===f.s.userId));
 assert.ok(rows.some(row=>row.tenantId===other.tenantId&&row.applicationKey===other.applicationKey&&row.userId===other.userId));assert.equal(f.calls.length,2);
});

test('the existing SMS binding still consumes its challenge and uses the same verified phone storage',async()=>{
 const f=fixture();let consumed=0;f.phoneAuth.consume=async(q,purpose)=>{consumed++;assert.equal(purpose,'bind');assert.equal(q.code,'123456')};
 await f.phoneAuth.bindPhone(f.s,{phone,code:'123456'});assert.equal(consumed,1);assert.equal(f.audits.at(-1).details.source,'sms');assert.deepEqual(await f.phoneAuth.binding(f.s),{phone});
 await f.wechat.bindPhone(f.s,{code:'same-phone'},f.phoneAuth);assert.equal(f.identities.filter(row=>row.provider==='sms').length,1);
});

test('existing account password, credential changes and revoked sessions protect replacement bindings',async()=>{
 const f=fixture();f.profile.passwordHash=await passwordHash('fixture-current');await f.addPhone('13900139000');
 await assert.rejects(f.wechat.bindPhone(f.s,{code:'password',password:'wrong'},f.phoneAuth),e=>e.code==='PASSWORD_INVALID');assert.equal(f.calls.length,0);
 await f.wechat.bindPhone(f.s,{code:'password',password:'fixture-current'},f.phoneAuth);assert.deepEqual(await f.phoneAuth.binding(f.s),{phone});
 for(const change of [f=>f.credential={...credential,version:2},f=>f.sessions=[],f=>f.identities.find(row=>row.provider==='wechat').subjectHash=hash('changed')]){
  const changed=fixture();await changed.addPhone('13900139000');changed.exchange=async()=>{change(changed);return phone};await assert.rejects(changed.wechat.bindPhone(changed.s,{code:'changed'},changed.phoneAuth));assert.equal(changed.identities.filter(row=>row.provider==='sms').length,1);assert.equal(changed.identities.find(row=>row.provider==='sms').subjectHash,hash(JSON.stringify([changed.s.tenantId,changed.s.applicationKey,'13900139000'])));
 }
 const failed=fixture();await failed.addPhone('13900139000');failed.failCreate=true;await assert.rejects(failed.wechat.bindPhone(failed.s,{code:'database'},failed.phoneAuth));assert.deepEqual(await failed.phoneAuth.binding(failed.s),{phone:'13900139000'});
});

test('automatic WeChat account display never replaces IDs or member numbers, and a prefix alone is insufficient',async()=>{
 const f=fixture(),profiles=new ConsumerProfiles(f.db);profiles.applications=f.apps;
 const view=await profiles.view(f.s);assert.equal(view.id,f.s.userId);assert.equal(view.memberNumber,'HY00000001');assert.equal(view.account,null);assert.equal(view.accountKind,'wechat');
 assert.deepEqual(await consumerAccountDisplay(f.db,{...f.s,applicationKey:'other'}),{account:f.s.userId,accountKind:'account'});
 assert.deepEqual(await consumerAccountDisplay(f.db,{...f.s,tenantId:'site-b'}),{account:f.s.userId,accountKind:'account'});
 assert.deepEqual(await consumerAccountDisplay(f.db,{...f.s,userId:'wx'+'b'.repeat(32)}),{account:'wx'+'b'.repeat(32),accountKind:'account'});
 assert.deepEqual(await consumerAccountDisplay(f.db,{...f.s,userId:'customer-account'}),{account:'customer-account',accountKind:'account'});
 f.identities[0].provider='sms';assert.deepEqual(await consumerAccountDisplay(f.db,f.s),{account:f.s.userId,accountKind:'account'});
});

test('authenticated decoration reads automatic WeChat accounts using real schema fields',async()=>{
 const f=fixture();f.db.tenantDecoration={findUnique:async()=>null};
 const decoration=new TenantDecoration(f.db,{imageUrls:async()=>({})});decoration.apps=f.apps;
 const view=await decoration.published(f.s);
 assert.equal(view.profile.account,null);assert.equal(view.profile.accountKind,'wechat');assert.equal(view.profile.memberNumber,'HY00000001');
 assert.equal(view.profile.nickname,'微信用户');assert.ok(view.scheme.home.blocks.length);
});

test('guest decoration exposes only the current scope default avatar while keeping guest identity null',async()=>{
 const reference='/api/v1/public/site-assets/11111111-1111-4111-8111-111111111111',other='https://cdn.example.com/site-b.png',reads=[];
 const configurations=new Map([['site-a:system',reference],['site-b:system',other],['site-a:phone-guest-fixture',null]]);
 const db={tenantDecoration:{findUnique:async()=>null},tenantConsumerSetting:{findUnique:async({where})=>{const s=where.tenantId_applicationKey;reads.push({...s});const config=consumerSettingDefaults();config.users.defaultAvatar=configurations.get(s.tenantId+':'+s.applicationKey);config.privateOnly='must-not-leak';return{config}}}};
 const decoration=new TenantDecoration(db,{imageUrls:async()=>({})});decoration.apps.available=async(t,a)=>{if(!configurations.has(t+':'+a))throw Error('not available')};
 for(const [key,avatar] of configurations){const [tenantId,applicationKey]=key.split(':');const data=await decoration.publicView({tenantId,applicationKey});assert.equal(data.defaultAvatar,avatar);assert.equal(data.profile,null);assert.equal(data.member,null);assert.ok(!JSON.stringify(data).includes('must-not-leak'));}
 const before=reads.length;await assert.rejects(decoration.publicView({tenantId:'foreign',applicationKey:'system'}));assert.equal(reads.length,before);
 assert.ok(reads.some(s=>s.tenantId==='site-a'&&s.applicationKey==='phone-guest-fixture'));
 const f=fixture(),config=consumerSettingDefaults();config.users.defaultAvatar=reference;f.db.tenantConsumerSetting.findUnique=async()=>({config});f.profile.avatar='https://cdn.example.com/own.png';const profiles=new ConsumerProfiles(f.db);profiles.applications=f.apps;
 const own=await profiles.view(f.s);assert.equal(own.avatar,f.profile.avatar);assert.equal(own.defaultAvatar,reference);f.profile.avatar=null;assert.equal((await profiles.view(f.s)).defaultAvatar,reference);
});
