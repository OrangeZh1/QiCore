import {basicDecoration} from '../core/decoration-contract.mjs';
import {frameworkPackages} from '../core/standalone-benefit-catalog.mjs';
import {frameworkBenefitRecords} from '../core/standalone-benefit-records.mjs';
import {frameworkRecords} from './framework-records.mjs';
import {fail} from '../core/errors.mjs';

// Reserved host data scope, never an installed/licensed application or a tenant
// selection. It cannot alias an application's consumers, configuration or grants.
export const frameworkKey='system';
export const frameworkPermissions=['settings.read','settings.write','materials.read','materials.write','consumers.read','consumers.write','entitlements.read','entitlements.write','orders.read','orders.manage'];
export const frameworkGrant=permission=>'tenant:'+permission.replace(/^settings\./,'clientSettings.');
const consumers={
 async list(db,tenantId,q){
  const where={tenantId,applicationKey:frameworkKey,deletedAt:null,...(q.q?{OR:[{userId:{contains:q.q}},{nickname:{contains:q.q}}]}:{}),...(q.levelId?{memberLevelId:q.levelId==='none'?null:q.levelId}:{}),...(q.tagId?{memberTags:{some:{tagId:q.tagId}}}:{})};
  const [items,total]=await Promise.all([db.consumerProfile.findMany({where,orderBy:[{createdAt:'desc'},{userId:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),db.consumerProfile.count({where})]);
  return{items:items.map(consumerView),total,page:q.page,pageSize:q.pageSize};
 },
 async detail(db,tenantId,userId){const profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId,applicationKey:frameworkKey,userId}}});return profile&&!profile.deletedAt?consumerView(profile):null},
};
function consumerView(row){const {passwordHash,...profile}=row;return{...profile,hasPassword:!!passwordHash,user:{id:row.userId,nickname:row.nickname,avatar:row.avatar},profile:{...profile,hasPassword:!!passwordHash}}}
export const frameworkDefinition=Object.freeze({key:frameworkKey,name:'系统自带',permissions:frameworkPermissions,defaultConfig:()=>({}),validateConfig:value=>value,decoration:basicDecoration,consumers,payments:true,helpCenter:true,sms:true,subscriptions:{events:[],fields:[],target:()=>fail('NOT_FOUND','通知场景不存在',404)},virtualGoods:()=>[],packages:frameworkPackages,entitlements:frameworkBenefitRecords(frameworkKey),entitlementLedger:frameworkBenefitRecords(frameworkKey,true),pointsLedger:frameworkRecords(frameworkKey,'points'),transactions:frameworkRecords(frameworkKey,'transactions'),h5:true,wechatMini:true,wechatOfficial:true});
