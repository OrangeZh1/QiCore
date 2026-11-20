import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';
import {applicationPermissions} from '../src/applications/installed-runtime.mjs';
import {TenantMiniAds,miniAdDefaults,miniAdConfig} from '../src/core/tenant-mini-ads.mjs';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';
import {application} from '../src/applications/registry.mjs';
import {defaultDecoration,basicDecoration,decorationBlock} from '../src/core/decoration-contract.mjs';
import {canAddDecoration,decorationWarnings} from '../src/core/decoration-components.mjs';
import {validateDecoration} from '../src/core/tenant-decoration.mjs';
const demoConfig={};setApplicationDefinitions([{key:'ads-fixture',name:'广告测试应用',permissions:['settings.read','settings.write'],wechatMini:true,legacyGrants:true,defaultConfig:()=>({}),validateConfig:v=>v}]);
applicationPermissions.push('ads-fixture:settings.read','ads-fixture:settings.write');
const {AdminAuth}=await import('../src/core/admin-auth.mjs');

test('unconfigured mini channels return no ads; configured mismatches and unavailable sites still fail closed',async()=>{
 let mini=null,lookups=0,availableCalls=0;
 const db={tenantMiniProgramSetting:{findUnique:async()=>mini},tenantMiniAdSetting:{findUnique:async()=>{lookups++;return null}},$transaction:fn=>fn(db)};
 const ads=new TenantMiniAds(db);ads.apps.available=async()=>{availableCalls++};
 const query={tenantId:'empty-site',applicationKey:'ads-fixture',appId:'wx1234567890abcdef'};
 const result=await ads.published(query);assert.equal(result.configured,false);assert.equal(result.appId,'');assert.equal(result.homeBanner,'');assert.equal(result.rewarded.configured,false);assert.equal(result.rewarded.grantsReward,false);assert.equal(lookups,0);assert.equal(availableCalls,2);
 mini={config:{appId:'wxabcdef1234567890'}};await assert.rejects(ads.published(query),{code:'MINI_AD_APPID_MISMATCH'});assert.equal(lookups,0);
 mini={config:{appId:query.appId}};assert.equal((await ads.published(query)).appId,query.appId);assert.equal(lookups,1);
 mini=null;ads.apps.available=async()=>{throw Object.assign(Error('disabled'),{code:'TENANT_DISABLED'})};await assert.rejects(ads.published(query),{code:'TENANT_DISABLED'});
});

test('manual ad IDs accept empty placements and reject code, URLs, switches and unknown fields',()=>{
 const config={...miniAdDefaults(),homeBanner:'adunit-1234567890abcdef'};
 assert.deepEqual(miniAdConfig.parse(config),config);
 for(const value of ['https://example.com/ad','<ad unit-id="x"/>','adunit-123','adunit-12345678?token=x',true,123])assert.equal(miniAdConfig.safeParse({...config,homeBanner:value}).success,false);
 assert.equal(miniAdConfig.safeParse({...config,enabled:true}).success,false);
 assert.equal(miniAdConfig.safeParse({...config,homeBannerPosition:'fixed'}).success,false);
});
test('banner decoration is explicit and singleton, with no application business defaults',()=>{
 const scheme=defaultDecoration();assert.ok(!scheme.home.blocks.some(b=>b.type==='wechat-ad'));const ad=decorationBlock('wechat-ad','native-ad');scheme.home.blocks.unshift(ad);
 assert.equal(validateDecoration(scheme,basicDecoration).home.blocks[0].type,'wechat-ad');assert.equal(canAddDecoration(scheme.home.blocks,'wechat-ad'),false);assert.equal(canAddDecoration(scheme.profile.blocks,'wechat-ad'),true);assert.deepEqual(decorationWarnings(scheme),[]);
 scheme.home.blocks.push({...ad,id:'duplicate'});assert.throws(()=>validateDecoration(scheme,basicDecoration),{code:'DECORATION_INVALID'});
});

test('native ad config is scoped, versioned, tied to AppID and exposes playback configuration without granting rewards',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t),{db:peerDb}=await isolatedDatabase(t);
 const prefix='ads-'+randomUUID().slice(0,8),a=prefix+'a',b=prefix+'b',appId='wx1234567890abcdef',newAppId='wxabcdef1234567890';
 for(const [installation,tenantId] of [[db,a],[peerDb,b]]){await installation.tenant.create({data:{id:tenantId,name:tenantId,applications:{create:{applicationKey:'ads-fixture',config:demoConfig}}}});await installation.tenantMiniProgramSetting.create({data:{tenantId,applicationKey:'ads-fixture',config:{appId}}})}
 await db.adminRole.create({data:{id:prefix,name:prefix,portal:'tenant',permissions:['ads-fixture:settings.read','ads-fixture:settings.write']}});
 const account=await db.adminAccount.create({data:{id:prefix,username:prefix,nickname:prefix,passwordHash:'unused',roleId:prefix,scopes:{create:[{tenantId:a}]}},include:{role:true,scopes:true}}),auth=new AdminAuth(db,{});auth.csrfKey=randomBytes(32);
 const login=await auth.issueSession(account,'admin.login'),s=await auth.session(login.cookie,'tenant'),ads=new TenantMiniAds(db),query={tenantId:a,applicationKey:'ads-fixture',appId};
 assert.equal((await ads.view(s,a,'ads-fixture')).version,0);assert.equal((await ads.published(query)).homeBanner,'');
 const config={...miniAdDefaults(),mode:'manual',homeBanner:'adunit-1234567890abcdef',homeInterstitial:'adunit-abcdef1234567890',rewarded:'adunit-0123456789abcdef'};
 const saved=await ads.save(s,a,'ads-fixture',{version:0,appId,config});assert.equal(saved.version,1);assert.equal(saved.liveVerified,false);assert.equal(saved.rewarded.grantsReward,false);
 const published=await ads.published(query);assert.equal(published.homeBanner,config.homeBanner);assert.equal(published.rewarded.grantsReward,false);assert.equal(published.rewarded.configured,true);assert.equal(published.rewarded.adUnitId,config.rewarded);assert.equal(published.rewarded.verification,'client-event');
 const peerAds=new TenantMiniAds(peerDb);
 assert.equal((await peerAds.published({...query,tenantId:b})).homeBanner,'','the second installation must retain its unconfigured ad units for the same AppID');
 await assert.rejects(ads.published({...query,tenantId:b}),{code:'TENANT_MISSING'});
 await assert.rejects(peerAds.published(query),{code:'TENANT_MISSING'});
 await assert.rejects(ads.view(s,b,'ads-fixture'),{code:'FORBIDDEN'});await assert.rejects(ads.save(s,b,'ads-fixture',{version:0,appId,config}),{code:'FORBIDDEN'});
 await assert.rejects(ads.published({...query,appId:newAppId}),{code:'MINI_AD_APPID_MISMATCH'});await assert.rejects(ads.save(s,a,'ads-fixture',{version:0,appId,config}),{code:'MINI_AD_CONFLICT'});
 const race=await Promise.allSettled([ads.save(s,a,'ads-fixture',{version:1,appId,config}),ads.save(s,a,'ads-fixture',{version:1,appId,config:miniAdDefaults()})]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.code,'MINI_AD_CONFLICT');
 await db.tenantMiniProgramSetting.update({where:{tenantId_applicationKey:{tenantId:a,applicationKey:'ads-fixture'}},data:{config:{appId:newAppId}}});
 assert.equal((await ads.view(s,a,'ads-fixture')).appIdChanged,true);assert.equal((await ads.published({...query,appId:newAppId})).homeBanner,'');
 await assert.rejects(ads.save(s,a,'ads-fixture',{version:2,appId,config}),{code:'MINI_AD_APPID_CHANGED'});
 await ads.save(s,a,'ads-fixture',{version:2,appId:newAppId,config:miniAdDefaults()});assert.equal((await ads.view(s,a,'ads-fixture')).appIdChanged,false);
 const managed=await ads.save(s,a,'ads-fixture',{version:3,appId:newAppId,config:{...config,mode:'wechat-managed'}});assert.equal(managed.config.homeBanner,config.homeBanner);const hidden=await ads.published({...query,appId:newAppId});assert.equal(hidden.mode,'wechat-managed');assert.equal(hidden.homeBanner,'');assert.equal(hidden.homeInterstitial,'');
 application('ads-fixture').wechatMini=false;await assert.rejects(ads.published({...query,appId:newAppId}),{code:'MINI_NOT_SUPPORTED'});application('ads-fixture').wechatMini=true;
 await db.adminRole.update({where:{id:prefix},data:{permissions:['ads-fixture:settings.read']}});assert.equal((await ads.view(s,a,'ads-fixture')).canWrite,false);await assert.rejects(ads.save(s,a,'ads-fixture',{version:3,appId:newAppId,config}),{code:'FORBIDDEN'});
 await db.tenant.update({where:{id:a},data:{enabled:false}});await assert.rejects(ads.published({...query,appId:newAppId}),{code:'TENANT_DISABLED'});
 assert.equal(await db.audit.count({where:{tenantId:a,action:'mini.ads.save'}}),4);
});
