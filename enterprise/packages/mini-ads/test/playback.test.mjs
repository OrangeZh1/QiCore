import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {adPlacements,createRewardedVideoPlayer,createInterstitialPlayer} from '../index.mjs';
const appId='wx1234567890abcdef',config={appId,mode:'manual',homeBanner:'adunit-banner001',profileBanner:'adunit-banner002',homeInterstitial:'adunit-insert001',rewarded:{adUnitId:'adunit-reward001'}};
function fixture({failShow=0,failLoad=false}={}){
 let scope='api|tenant|application|appId|user',shows=0,loads=0,created=0,destroyed=0;const events={};
 const ad={onClose:fn=>events.close=fn,offClose:()=>delete events.close,onError:fn=>events.error=fn,offError:()=>delete events.error,destroy:()=>destroyed++,show:()=>{shows++;return shows<=failShow?Promise.reject({errCode:1004}):Promise.resolve()},load:()=>{loads++;return failLoad?Promise.reject({errCode:1004}):Promise.resolve()}};
 const player=createRewardedVideoPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createRewardedVideoAd:options=>{created++;assert.equal(options.adUnitId,config.rewarded.adUnitId);return ad}},config,appId,getScope:()=>scope});
 return{player,events,changeScope:()=>scope='other',counts:()=>({shows,loads,created,destroyed})};
}
test('managed display ads and native reward placement stay independent; invalid identities/IDs are rejected',()=>{
 assert.equal(adPlacements({...config,mode:'wechat-managed'},appId).homeBanner,'');assert.equal(adPlacements({...config,mode:'wechat-managed'},appId).rewarded,config.rewarded.adUnitId);
 assert.throws(()=>adPlacements(config,'wx0000000000000000'),{code:'AD_APPID_MISMATCH'});assert.equal(adPlacements({...config,homeBanner:'https://bad'},appId).homeBanner,'');
 assert.throws(()=>createRewardedVideoPlayer({wx:{},config,appId,getScope:()=>''}),{code:'AD_UNSUPPORTED'});
});
test('complete, partial and missing close results stay unverified; repeated play reuses one page instance',async()=>{
 const f=fixture();for(const isEnded of [true,false,undefined]){const p=f.player.play();await assert.rejects(f.player.play(),{code:'AD_BUSY'});await tick();assert.equal(f.player.state,'showing');f.events.close(isEnded===undefined?undefined:{isEnded});assert.deepEqual(await p,{status:isEnded===true?'completed':'closed',completed:isEnded===true,source:'wechat-client',verified:false});assert.equal(f.player.state,'idle')}
 assert.equal(f.counts().created,1);f.player.dispose();assert.deepEqual(f.events,{});assert.equal(f.counts().destroyed,1);
});
test('show failure retries load once; no inventory and runtime errors reject without granting or looping',async()=>{
 const recovered=fixture({failShow:1}),p=recovered.player.play();await tick();assert.equal(recovered.counts().shows,2);assert.equal(recovered.counts().loads,1);recovered.events.close({isEnded:true});assert.equal((await p).verified,false);recovered.player.dispose();
 for(const options of [{failShow:2},{failShow:1,failLoad:true}]){const f=fixture(options);await assert.rejects(f.player.play(),{code:'AD_NO_INVENTORY'});assert.equal(f.counts().loads,1);assert.equal(f.player.state,'idle');assert.deepEqual(f.events,{})}
 const failed=fixture(),watch=failed.player.play();await tick();failed.events.error({errCode:1002});await assert.rejects(watch,{code:'AD_PLAY_FAILED'});
});
test('changed scope, disposed pages and late callbacks never produce a completed result',async()=>{
 const f=fixture(),p=f.player.play();await tick();const late=f.events.close;f.changeScope();late({isEnded:true});await assert.rejects(p,{code:'AD_CONTEXT_CHANGED'});assert.deepEqual(f.events,{});await assert.rejects(f.player.play(),{code:'AD_CONTEXT_CHANGED'});
 const d=fixture(),pending=d.player.play();const old=d.events.close;d.player.dispose();await assert.rejects(pending,{code:'AD_DISPOSED'});old({isEnded:true});await tick();assert.equal(d.player.state,'disposed');await assert.rejects(d.player.play(),{code:'AD_CONTEXT_CHANGED'});
});
test('interstitial retries and hidden pages never re-open a native popup',async()=>{
 for(const failed of [true,false]){let calls=0,destroyed=0;const ad={onError(){},offError(){},onClose(){},offClose(){},destroy(){destroyed++},show:()=>failed?Promise.reject(Error()):Promise.resolve()},p=createInterstitialPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createInterstitialAd:()=>{calls++;return ad}},config,appId,getScope:()=> 'scope'});assert.equal(await p.show(),!failed);assert.equal(await p.show(),false);p.dispose();assert.equal(await p.show(),false);assert.equal(calls,1);assert.equal(destroyed,1)}
});
test('native interstitial error wins even if show resolves later',async()=>{
 let error,resolveShow,destroyed=0;const ad={onError:fn=>error=fn,offError(){},onClose(){},offClose(){},destroy:()=>destroyed++,show:()=>new Promise(resolve=>resolveShow=resolve)},p=createInterstitialPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createInterstitialAd:()=>ad},config,appId,getScope:()=> 'scope'});
 const pending=p.show();error({errCode:1004});resolveShow();assert.equal(await pending,false);assert.equal(destroyed,1);assert.equal(await p.show(),false);
});
test('an old queued close callback cannot finish a later play',async()=>{
 const f=fixture(),first=f.player.play();await tick();const stale=f.events.close;stale({isEnded:true});await first;const second=f.player.play();await tick();stale({isEnded:true});assert.equal(f.player.state,'showing');f.events.close({isEnded:false});assert.equal((await second).completed,false);f.player.dispose();
});
test('a hanging native show times out and releases listeners',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const events={};let destroyed=false;const ad={show:()=>new Promise(()=>{}),load:async()=>{},onClose:fn=>events.close=fn,offClose:()=>delete events.close,onError:fn=>events.error=fn,offError:()=>delete events.error,destroy:()=>destroyed=true};
 const p=createRewardedVideoPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createRewardedVideoAd:()=>ad},config,appId,getScope:()=> 'scope'}),waiting=p.play(),rejected=assert.rejects(waiting,{code:'AD_LOAD_TIMEOUT'});t.mock.timers.tick(15000);await rejected;assert.equal(destroyed,true);assert.deepEqual(events,{});
});

test('reward errors before a resolved show or load cannot leave the player busy or report completion',async()=>{
 for(const failDuring of ['show','load']){
  const events={};let shows=0,loads=0,destroyed=0;
  const ad={onClose:fn=>events.close=fn,offClose:()=>delete events.close,onError:fn=>events.error=fn,offError:()=>delete events.error,destroy:()=>destroyed++,
   show(){shows++;if(failDuring==='show'){events.error({errCode:1004});return Promise.resolve()}return Promise.reject({errCode:1004})},
   load(){loads++;if(failDuring==='load')events.error({errCode:1004});return Promise.resolve()}};
  const player=createRewardedVideoPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createRewardedVideoAd:()=>ad},config,appId,getScope:()=> 'scope'});
  await assert.rejects(player.play(),{code:'AD_NO_INVENTORY'});assert.equal(player.state,'idle');assert.equal(loads,1);assert.equal(shows,failDuring==='show'?2:1);assert.equal(destroyed,1);assert.deepEqual(events,{});
  await assert.rejects(player.play(),{code:'AD_NO_INVENTORY'});assert.equal(player.state,'idle');player.dispose();
 }
});

test('an initial native error still permits one successful explicit load/show retry',async()=>{
 const events={};let shows=0,loads=0;
 const ad={onClose:fn=>events.close=fn,offClose:()=>delete events.close,onError:fn=>events.error=fn,offError:()=>delete events.error,destroy(){},
  show(){shows++;if(shows===1){events.error({errCode:1004});return Promise.reject({errCode:1004})}return Promise.resolve()},load:async()=>{loads++}};
 const player=createRewardedVideoPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createRewardedVideoAd:()=>ad},config,appId,getScope:()=> 'scope'});
 const result=player.play();await tick();assert.equal(shows,2);assert.equal(loads,1);events.close({isEnded:true});assert.equal((await result).completed,true);player.dispose();
});

test('a close event cannot turn an unresolved native error into a completed playback',async()=>{
 const events={};let resolveShow;
 const ad={onClose:fn=>events.close=fn,offClose:()=>delete events.close,onError:fn=>events.error=fn,offError:()=>delete events.error,destroy(){},show:()=>new Promise(resolve=>resolveShow=resolve),load:async()=>{}};
 const player=createRewardedVideoPlayer({wx:{getAccountInfoSync:()=>({miniProgram:{appId}}),createRewardedVideoAd:()=>ad},config,appId,getScope:()=> 'scope'});
 const result=player.play();events.error({errCode:1004});events.close({isEnded:true});await assert.rejects(result,{code:'AD_PLAY_FAILED'});resolveShow();await tick();assert.equal(player.state,'idle');player.dispose();
});
