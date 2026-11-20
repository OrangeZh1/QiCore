import {levelProgress} from './member-level-progress.mjs';
import {z} from 'zod';
import {ConsumerProfiles} from '../applications/consumer-profiles.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {defaultMemberLevel} from './member-defaults.mjs';
import {readConsumerSettings} from './tenant-consumer-settings.mjs';
import {memberBenefits,memberBenefitDefinitions} from './member-benefits.mjs';
import {fail} from './errors.mjs';

function expose(row,metrics){
 const conditions=row.conditions??{growth:row.threshold},benefits=memberBenefits(row.benefits);
 return{id:row.id,name:row.name,rank:row.rank,description:row.description||'',defined:!row.deleted,upgradeMode:row.upgradeMode||'all',criteria:levelProgress(conditions,metrics),benefits:memberBenefitDefinitions.map(def=>({key:def.key,label:def.label,value:benefits[def.key]/def.scale,unit:def.unit}))};
}
export class ConsumerMemberLevels {
 constructor(db){this.db=db;this.profiles=new ConsumerProfiles(db);this.apps=new TenantApplications(db)}
 async publicView(input){
  const parsed=z.object({tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)}).strict().safeParse(input);
  if(!parsed.success)fail('MEMBER_INPUT_INVALID','站点参数无效');const scope=parsed.data;
  await this.apps.available(scope.tenantId,scope.applicationKey);
  const [rule,rows]=await Promise.all([this.db.memberRule.findUnique({where:{tenantId_applicationKey:scope}}),this.db.memberLevel.findMany({where:scope,orderBy:{rank:'asc'}})]),base=defaultMemberLevel(rule?.baseLevel);
  const result={levels:[...(!base.deleted?[base]:[]),...rows].map(row=>expose(row,{})),growthRules:{registration:rule?.registrationGrowth||0,perYuan:rule?.purchaseGrowthPerYuan||0}};
  await this.apps.available(scope.tenantId,scope.applicationKey);return result;
 }
 async view(s,query={}){
  if(!z.object({}).strict().safeParse(query).success)fail('MEMBER_INPUT_INVALID','等级页面不接受其他用户或站点参数');
  await this.profiles.authorize(s);
  const result=await this.db.$transaction(async db=>{
   await this.profiles.authorize(s,db);
   const scope={tenantId:s.tenantId,applicationKey:s.applicationKey},profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{...scope,userId:s.userId}},include:{memberLevel:true}}),rule=await db.memberRule.findUnique({where:{tenantId_applicationKey:scope}}),base=defaultMemberLevel(rule?.baseLevel),settings=await readConsumerSettings(db,s.tenantId,s.applicationKey);
   const rows=await db.memberLevel.findMany({where:scope,orderBy:{rank:'asc'}}),currentRow=profile?.memberLevel||base;
   const metrics={growth:profile?.growth??0,...await application(s.applicationKey).memberMetrics?.(db,s.tenantId,s.userId)};
   const levels=[...(!base.deleted?[base]:[]),...rows].map(row=>expose(row,metrics)),current=expose(currentRow,metrics),higher=levels.filter(level=>level.rank>current.rank),next=higher.find(level=>level.criteria.length);
   return{current,growth:metrics.growth,levels,nextId:next?.id??null,nextState:next?'automatic':higher.length?'manual':levels.length?'highest':'empty',profile:{name:profile?.nickname||s.userId,avatar:profile?.avatar||settings.config.users.defaultAvatar||null},growthRules:{registration:rule?.registrationGrowth||0,perYuan:rule?.purchaseGrowthPerYuan||0}};
  },{isolationLevel:'RepeatableRead'});
  // A revoked session must not receive data assembled from an older transaction snapshot.
  await this.profiles.authorize(s);
  return result;
 }
}
