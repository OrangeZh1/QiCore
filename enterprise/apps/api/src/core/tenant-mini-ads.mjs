import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {fail} from './errors.mjs';

const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),appId=z.string().regex(/^wx[a-fA-F0-9]{16}$/);
const unit=z.string().trim().max(71).refine(value=>!value||/^adunit-[a-zA-Z0-9]{8,64}$/.test(value));
export const miniAdDefaults=()=>({mode:'wechat-managed',homeBanner:'',profileBanner:'',homeInterstitial:'',rewarded:''});
// Existing manual configurations keep their meaning; a new configuration defaults to managed ads.
export const miniAdConfig=z.object({mode:z.enum(['wechat-managed','manual']).default('manual'),homeBanner:unit,profileBanner:unit,homeInterstitial:unit,rewarded:unit}).strict();
const scope=(tenantId,applicationKey)=>({tenantId_applicationKey:{tenantId,applicationKey}});
const parse=(schema,input)=>{const value=schema.safeParse(input);if(!value.success)fail('MINI_AD_INPUT_INVALID','请填写有效的广告位 ID，并检查配置版本');return value.data};
// This describes playback capability only. Applications own their reward policies.
const rewarded=adUnitId=>({adUnitId,configured:!!adUnitId,playbackImplemented:true,verification:'client-event',grantsReward:false});

export class TenantMiniAds {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,key){parse(identifier,tenantId);parse(identifier,key);return this.apps.featureContext(db,s,tenantId,key,'wechatMini','settings.read')}
 async view(s,tenantId,key){
  return this.db.$transaction(async db=>{
   await this.context(db,s,tenantId,key);
   const where=scope(tenantId,key),mini=await db.tenantMiniProgramSetting.findUnique({where}),row=await db.tenantMiniAdSetting.findUnique({where});
   const current=mini?.config?.appId||'',changed=!!row&&row.appId!==current,ctx=await this.context(db,s,tenantId,key);
   return{applicationKey:key,appId:current,boundAppId:row?.appId||'',appIdChanged:changed,version:row?.version||0,config:row?miniAdConfig.parse(row.config):miniAdDefaults(),canWrite:ctx.permissions.includes('settings.write'),updatedAt:row?.updatedAt||null,rewarded:{...rewarded(!changed&&current?row?.config?.rewarded||'':''),message:'使用微信原生激励视频。框架提供播放结果，奖励规则由应用处理。'},liveVerified:false};
  },{isolationLevel:'RepeatableRead'});
 }
 async save(s,tenantId,key,input){
  const q=parse(z.object({version:z.number().int().nonnegative(),appId,config:miniAdConfig}).strict(),input);
  await this.context(this.db,s,tenantId,key);
  await this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,key,'settings.write',db,true);await this.context(db,s,tenantId,key);
   const where=scope(tenantId,key),mini=await db.tenantMiniProgramSetting.findUnique({where}),old=await db.tenantMiniAdSetting.findUnique({where});
   if(!mini?.config?.appId||mini.config.appId!==q.appId)fail('MINI_AD_APPID_CHANGED','小程序 AppID 已变化，请重新读取后配置广告',409);
   if((old?.version||0)!==q.version)fail('MINI_AD_CONFLICT','广告配置已更新，请重新读取后保存',409);
   const data={appId:q.appId,config:q.config,version:q.version+1};
   if(old)await db.tenantMiniAdSetting.update({where,data});else await db.tenantMiniAdSetting.create({data:{tenantId,applicationKey:key,...data}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'mini.ads.save',details:{version:data.version,appId:q.appId,mode:q.config.mode,placements:['homeBanner','profileBanner','homeInterstitial','rewarded'].filter(k=>q.config[k]),...(s.delegated?{targetAdminId:s.id}:{})}}});
  });
  return this.view(s,tenantId,key);
 }
 async published(input){
  const q=parse(z.object({tenantId:identifier,applicationKey:identifier,appId}).strict(),input);
  if(!application(q.applicationKey).wechatMini)fail('MINI_NOT_SUPPORTED','该应用未开放微信小程序',403);
  return this.db.$transaction(async db=>{
   await this.apps.available(q.tenantId,q.applicationKey,db);
   const where=scope(q.tenantId,q.applicationKey),mini=await db.tenantMiniProgramSetting.findUnique({where});
   if(!mini?.config?.appId){
    await this.apps.available(q.tenantId,q.applicationKey,db);
    return{appId:'',configured:false,mode:'wechat-managed',homeBanner:'',profileBanner:'',homeInterstitial:'',rewarded:rewarded('')};
   }
   if(mini.config.appId!==q.appId)fail('MINI_AD_APPID_MISMATCH','广告配置与当前小程序不一致',403);
   const row=await db.tenantMiniAdSetting.findUnique({where}),config=row?.appId===q.appId?miniAdConfig.parse(row.config):miniAdDefaults();
   // An ad unit ID and a client close event are not trusted reward evidence.
   await this.apps.available(q.tenantId,q.applicationKey,db);
   return{appId:q.appId,mode:config.mode,homeBanner:config.mode==='manual'?config.homeBanner:'',profileBanner:config.mode==='manual'?config.profileBanner:'',homeInterstitial:config.mode==='manual'?config.homeInterstitial:'',rewarded:rewarded(config.rewarded)};
  },{isolationLevel:'RepeatableRead'});
 }
}
