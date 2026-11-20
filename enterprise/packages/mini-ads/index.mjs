const unit=value=>typeof value==='string'&&/^adunit-[a-zA-Z0-9]{8,64}$/.test(value)?value:'';
const fault=(code,message)=>Object.assign(Error(message),{code});
const nativeIdentity=(wx,appId)=>{if(wx?.getAccountInfoSync?.().miniProgram?.appId!==appId)throw fault('AD_APPID_MISMATCH','广告配置与当前小程序不一致')};

/** Public configuration is scoped by the host; callers must use their actual WeChat AppID. */
export function adPlacements(config,appId){
 if(!/^wx[a-fA-F0-9]{16}$/.test(appId)||appId==='wx0000000000000000'||config?.appId!==appId)throw fault('AD_APPID_MISMATCH','广告配置与当前小程序不一致');
 return{homeBanner:config.mode==='manual'?unit(config.homeBanner):'',profileBanner:config.mode==='manual'?unit(config.profileBanner):'',homeInterstitial:config.mode==='manual'?unit(config.homeInterstitial):'',rewarded:unit(config.rewarded?.adUnitId)};
}

/** An optional interstitial is attempted once per page, even when inventory is unavailable. */
export function createInterstitialPlayer({wx,config,appId,getScope}){
 nativeIdentity(wx,appId);
 const adUnitId=adPlacements(config,appId).homeInterstitial,scope=getScope();let attempted=false,disposed=false,failed=false,ad=null;
 if(!scope)throw fault('AD_SCOPE_REQUIRED','广告调用缺少当前站点上下文');
 const release=()=>{const old=ad;ad=null;if(old){old.offError(onError);old.offClose(release);old.destroy?.()}};
 const onError=()=>{failed=true;release()};
 return{async show(){if(attempted||disposed||scope!==getScope()||!adUnitId||typeof wx?.createInterstitialAd!=='function')return false;attempted=true;try{ad=wx.createInterstitialAd({adUnitId});ad.onError(onError);ad.onClose(release);await ad.show();return !failed&&!disposed&&scope===getScope()}catch{release();return false}},dispose(){disposed=true;release()}};
}

/** One instance per page. Results are client observations, never a verified reward receipt. */
export function createRewardedVideoPlayer({wx,config,appId,getScope}){
 const adUnitId=adPlacements(config,appId).rewarded;
 if(!adUnitId)throw fault('AD_NOT_CONFIGURED','激励视频广告位尚未配置');
 if(typeof wx?.createRewardedVideoAd!=='function')throw fault('AD_UNSUPPORTED','当前环境不支持微信激励视频');
 nativeIdentity(wx,appId);
 if(typeof getScope!=='function'||!getScope())throw fault('AD_SCOPE_REQUIRED','广告调用缺少当前站点上下文');
 const scope=getScope();let ad=null,pending=null,disposed=false,state='idle';
 const current=()=>!disposed&&scope===getScope();
 function release(){const old=ad;ad=null;old?.destroy?.()}
 function settle(error,result){const p=pending;if(!p)return;pending=null;clearTimeout(p.timer);if(ad){ad.offClose(p.close);ad.offError(p.error)}state=disposed?'disposed':'idle';if(error)p.reject(error);else p.resolve(result)}
 function changed(){if(current())return false;settle(fault('AD_CONTEXT_CHANGED','页面或登录状态已变化'));release();return true}
 function onClose(result){if(!pending||changed())return;if(pending.nativeError){settle(fault('AD_PLAY_FAILED','广告播放失败，请稍后重试'));release();return}settle(null,{status:result?.isEnded===true?'completed':'closed',completed:result?.isEnded===true,source:'wechat-client',verified:false})}
 function onError(error){if(!pending||changed())return;if(state==='loading'){pending.nativeError=error||fault('AD_LOAD_FAILED','广告加载失败');return}settle(fault(error?.errCode===1004?'AD_NO_INVENTORY':'AD_PLAY_FAILED',error?.errCode===1004?'暂时没有可播放的广告':'广告播放失败，请稍后重试'));release()}
 function show(p){
  if(pending!==p||changed())return Promise.resolve();
  p.nativeError=null;
  let result;try{result=ad.show()}catch(error){result=Promise.reject(error)}
  return Promise.resolve(result).then(()=>{if(pending!==p||changed())return;if(p.nativeError)throw p.nativeError;clearTimeout(p.timer);state='showing'});
 }
 function play(){
  if(!current())return Promise.reject(fault('AD_CONTEXT_CHANGED','页面或登录状态已变化'));
  if(pending)return Promise.reject(fault('AD_BUSY','广告正在处理中'));
  return new Promise((resolve,reject)=>{
   const p={resolve,reject,timer:null,nativeError:null,close:result=>{if(pending===p)onClose(result)},error:error=>{if(pending===p)onError(error)}};pending=p;state='loading';
   p.timer=setTimeout(()=>{if(pending===p){settle(fault('AD_LOAD_TIMEOUT','广告加载超时，请重试'));release()}},15000);
   try{if(!ad)ad=wx.createRewardedVideoAd({adUnitId});ad.onClose(p.close);ad.onError(p.error)}catch{settle(fault('AD_UNSUPPORTED','广告组件创建失败'));release();return}
   // Match WeChat's documented flow: show first, then one explicit load/show retry.
   show(p).catch(async()=>{if(pending!==p||changed())return;p.nativeError=null;await ad.load();if(pending===p&&!changed()){if(p.nativeError)throw p.nativeError;await show(p)}}).catch(error=>{
    if(pending!==p||changed())return;
    settle(fault(error?.errCode===1004?'AD_NO_INVENTORY':'AD_LOAD_FAILED',error?.errCode===1004?'暂时没有可播放的广告':'广告加载失败，请稍后重试'));release();
   });
  });
 }
 function dispose(){if(disposed)return;disposed=true;settle(fault('AD_DISPOSED','广告页面已关闭'));state='disposed';release()}
 return{play,dispose,get state(){return state}};
}
