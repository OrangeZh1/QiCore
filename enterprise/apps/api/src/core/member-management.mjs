import {levelProgress} from './member-level-progress.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {fail} from './errors.mjs';
import {defaultMemberLevel,readDefaultMemberLevel} from './member-defaults.mjs';
import {memberBenefits,memberBenefitsSchema,memberBenefitDefinitions} from './member-benefits.mjs';
export {defaultMemberLevel} from './member-defaults.mjs';

const id=z.string().uuid(),key=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),version=z.number().int().nonnegative();
const name=z.string().trim().min(1).max(32).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const amount=z.number().int().min(0).max(2147483647),reason=z.string().trim().min(1).max(200);
const paging={page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)};
const parse=(schema,input)=>{const p=schema.safeParse(input);if(!p.success)fail('MEMBER_INPUT_INVALID','请检查等级、标签、成长值及操作原因');return p.data};
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey});
const profileWhere=(tenantId,applicationKey,userId)=>({tenantId_applicationKey_userId:{tenantId,applicationKey,userId}});
const conditions=z.object({growth:amount.optional(),paidCents:z.string().regex(/^[1-9][0-9]{0,14}$/).optional(),paidOrders:z.number().int().min(1).max(2147483647).optional()}).strict();
const levelView=(row,fallback=defaultMemberLevel())=>row?{id:row.id,name:row.name,threshold:row.threshold,rank:row.rank??row.threshold,upgradeMode:row.upgradeMode||'all',conditions:row.conditions||{growth:row.threshold},benefits:memberBenefits(row.benefits)}:fallback;
export function upgradeDescription(row){const c=row.conditions||{growth:row.threshold},parts=[];if(c.growth!==undefined)parts.push('成长值达到 '+c.growth);if(c.paidCents!==undefined){const cents=BigInt(c.paidCents);parts.push('累计实付达到 '+(cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0')+' 元')}if(c.paidOrders!==undefined)parts.push('有效订单达到 '+c.paidOrders+' 笔');return parts.join(row.upgradeMode==='any'?' 或 ':' 且 ')}
const memberMetrics=(db,tenantId,k,userId)=>application(k).memberMetrics?.(db,tenantId,userId)||Promise.resolve({paidCents:'0',paidOrders:0});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function upgradedLevel(levels,growth,current=null,metrics={paidCents:'0',paidOrders:0}){
 return levels.filter(l=>{if(current&&(l.rank??l.threshold)<=(current.rank??current.threshold))return false;const c=l.conditions||{growth:l.threshold},checks=[];if(c.growth!==undefined)checks.push(growth>=c.growth);if(c.paidCents!==undefined)checks.push(BigInt(metrics.paidCents)>=BigInt(c.paidCents));if(c.paidOrders!==undefined)checks.push(metrics.paidOrders>=c.paidOrders);return checks.length>0&&(l.upgradeMode==='any'?checks.some(Boolean):checks.every(Boolean))}).sort((a,b)=>(b.rank??b.threshold)-(a.rank??a.threshold))[0]||current;
}
export async function memberOptions(db,tenantId,applicationKey){
 const where=scope(tenantId,applicationKey);
 const [levels,tags]=await Promise.all([db.memberLevel.findMany({where,orderBy:{rank:'asc'},select:{id:true,name:true,threshold:true,rank:true,upgradeMode:true,conditions:true}}),db.memberTag.findMany({where,orderBy:{name:'asc'},select:{id:true,name:true}})]);
 return{levels,tags,defaultLevel:await readDefaultMemberLevel(db,tenantId,applicationKey)};
}
export async function memberSummaries(db,tenantId,applicationKey,userIds){
 const rows=await db.consumerProfile.findMany({where:{...scope(tenantId,applicationKey),userId:{in:userIds},deletedAt:null},select:{userId:true,growth:true,memberLevel:true,memberTags:{include:{tag:true}}}});
 const fallback=await readDefaultMemberLevel(db,tenantId,applicationKey),byId=new Map(rows.map(r=>[r.userId,{growth:r.growth,level:levelView(r.memberLevel,fallback),tags:r.memberTags.map(t=>({id:t.tagId,name:t.tag.name}))}]));
 return new Map(userIds.map(userId=>[userId,byId.get(userId)||{growth:0,level:fallback,tags:[]}]));
}
// Called only for a genuinely new account, inside its existing tenant-locked creation transaction.
export async function initializeMember(db,tenantId,applicationKey,userId){
 const where=scope(tenantId,applicationKey),rule=await db.memberRule.findUnique({where:{tenantId_applicationKey:where}}),growth=rule?.registrationGrowth||0;
 const levels=await db.memberLevel.findMany({where}),level=upgradedLevel(levels,growth);
 if(!growth&&!level)return;
 await db.consumerProfile.update({where:profileWhere(tenantId,applicationKey,userId),data:{growth,memberLevelId:level?.id||null}});
 await db.memberGrowthRecord.create({data:{...where,userId,requestId:'registration',payloadHash:hash({growth,level:level?.id||null}),kind:'registration',before:0,after:growth,levelBefore:{},levelAfter:levelView(level,defaultMemberLevel(rule?.baseLevel)),reason:'新用户注册',actor:'system'}});
}
export async function publicMember(db,tenantId,applicationKey,userId){
 const row=await db.consumerProfile.findUnique({where:profileWhere(tenantId,applicationKey,userId),include:{memberLevel:true}}),growth=row?.growth||0,level=levelView(row?.memberLevel,await readDefaultMemberLevel(db,tenantId,applicationKey));
 const candidates=await db.memberLevel.findMany({where:{tenantId,applicationKey,rank:{gt:level?.rank??-1}},orderBy:{rank:'asc'}}),next=candidates.find(row=>row.conditions===null||Object.keys(row.conditions).length>0);
 const metrics=next?{growth,...await application(applicationKey).memberMetrics?.(db,tenantId,userId)}:{growth};
 return{growth,level,nextState:next?'automatic':candidates.length?'manual':'highest',nextLevel:next?{...levelView(next),description:upgradeDescription(next),criteria:levelProgress(next.conditions??{growth:next.threshold},metrics)}:null};
}
// The trusted application invokes this after settlement in the same tenant-locked transaction.
export async function upgradeMemberFromOrder(db,tenantId,applicationKey,userId,orderId){
 const levels=await db.memberLevel.findMany({where:scope(tenantId,applicationKey)});if(!levels.length)return;
 const where=profileWhere(tenantId,applicationKey,userId),old=await db.consumerProfile.findUnique({where,include:{memberLevel:true}});if(old?.deletedAt||old?.enabled===false)return;
 const metrics=await memberMetrics(db,tenantId,applicationKey,userId),level=upgradedLevel(levels,old?.growth||0,old?.memberLevel,metrics);if(!level||level.id===old?.memberLevelId)return;
 const requestId='order:'+hash(orderId).slice(0,48),operation={...scope(tenantId,applicationKey),userId,requestId};
 if(await db.memberGrowthRecord.findUnique({where:{tenantId_applicationKey_userId_requestId:operation}}))return;
 if(old)await db.consumerProfile.update({where,data:{memberLevelId:level.id,version:{increment:1}}});else await db.consumerProfile.create({data:{...scope(tenantId,applicationKey),userId,nickname:userId,memberLevelId:level.id}});
 await db.memberGrowthRecord.create({data:{...operation,payloadHash:hash({orderId,metrics}),kind:'order',before:old?.growth||0,after:old?.growth||0,levelBefore:levelView(old?.memberLevel,await readDefaultMemberLevel(db,tenantId,applicationKey)),levelAfter:levelView(level),reason:'有效订单满足升级条件',actor:'system'}});
}
export class MemberManagement {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,k){parse(key,tenantId);if(k)parse(key,k);return this.apps.featureContext(db,s,tenantId,k,'consumers','consumers.read')}
 async write(db,s,tenantId,k){if(db!==this.db)await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;const ctx=await this.context(db,s,tenantId,k);if(!ctx.selected)fail('MEMBER_INPUT_INVALID','请选择应用');await this.apps.admin(s,tenantId,k,'consumers.write',db,true);return ctx}
 async audit(db,s,tenantId,k,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:k,actor:s.impersonatedBy||s.id,action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
 model(kind){if(!['levels','tags'].includes(kind))fail('NOT_FOUND','接口不存在',404);return kind==='levels'?'memberLevel':'memberTag'}
 async list(s,tenantId,kind,input={}){
  const model=this.model(kind),q=parse(z.object({applicationKey:key.optional(),q:z.string().trim().max(100).default(''),...paging}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),k=ctx.selected?.key;
  if(!k)return{applicationKey:null,applications:ctx.sources,canWrite:false,items:[],total:0,page:1,pageSize:q.pageSize,rule:{registrationGrowth:0,version:0}};
  const value=await this.db.$transaction(async db=>{
   const base=await readDefaultMemberLevel(db,tenantId,k),builtin=kind==='levels'&&!base.deleted&&base.name.includes(q.q),where={...scope(tenantId,k),...(q.q?{name:{contains:q.q}}:{})},total=await db[model].count({where})+Number(builtin),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize))),offset=(page-1)*q.pageSize;
   const rows=await db[model].findMany({where,orderBy:kind==='levels'?{rank:'asc'}:{createdAt:'desc'},skip:Math.max(0,offset-Number(builtin)),take:q.pageSize-Number(builtin&&page===1),include:{_count:{select:{members:true}}}});
   const items=rows.map(({_count,...row})=>({...row,benefits:kind==='levels'?memberBenefits(row.benefits):undefined,memberCount:_count.members}));
   if(builtin&&page===1){const members=await application(k).consumers.list(db,tenantId,{q:'',levelId:'none',page:1,pageSize:10},[]);const historical=await db.consumerProfile.count({where:{...scope(tenantId,k),memberLevelId:null,deletedAt:{not:null}}});items.unshift({...base,id:'default',memberCount:members.total+historical})}
   const rule=kind==='levels'?await db.memberRule.findUnique({where:{tenantId_applicationKey:scope(tenantId,k)}}):null;
   return{items,total,page,pageSize:q.pageSize,benefitDefinitions:kind==='levels'?memberBenefitDefinitions:[],rule:{registrationGrowth:rule?.registrationGrowth||0,purchaseGrowthPerYuan:rule?.purchaseGrowthPerYuan||0,version:rule?.version||0}};
  },{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,k);return{...value,applicationKey:k,applications:ctx.sources,canWrite:current.permissions.includes('consumers.write')};
 }
 async save(s,tenantId,k,kind,target,input){
  if(kind==='levels'&&target==='default')return this.saveBase(s,tenantId,k,input);
  const model=this.model(kind);parse(id,target);const q=parse(z.object({version,name,description:z.string().trim().max(200).default(''),...(kind==='levels'?{threshold:amount.optional(),rank:amount.optional(),upgradeMode:z.enum(['all','any']).default('all'),conditions:conditions.optional(),benefits:memberBenefitsSchema.optional()}:{})}).strict(),input);
  if(kind==='levels'){q.rank=q.rank??q.threshold;q.conditions=q.conditions||(q.threshold===undefined?undefined:{growth:q.threshold});if(q.rank===undefined||!q.conditions)fail('MEMBER_INPUT_INVALID','请设置等级序号和至少一个升级条件');q.threshold=q.conditions.growth??0;if((q.conditions.paidCents!==undefined||q.conditions.paidOrders!==undefined)&&!application(k).memberMetrics)fail('MEMBER_INPUT_INVALID','当前应用不支持消费升级条件')}
  await this.apps.admin(s,tenantId,k,'consumers.write');
  return this.apps.transaction(async db=>{
   await this.write(db,s,tenantId,k);const where={tenantId_applicationKey_id:{...scope(tenantId,k),id:target}},old=await db[model].findUnique({where});
   const base=kind==='levels'?await readDefaultMemberLevel(db,tenantId,k):null;
   if(base&&!base.deleted&&q.name===base.name&&old?.name!==q.name)fail('MEMBER_DUPLICATE','等级名称已存在',409);
   if((old?.version||0)!==q.version)fail('MEMBER_CONFLICT','内容已变更，请刷新后重试',409);
   if(!old&&await db[model].count({where:scope(tenantId,k)})>=(kind==='levels'?50:200))fail('MEMBER_LIMIT',kind==='levels'?'最多支持 50 个等级':'最多支持 200 个标签');
   const duplicate=await db[model].findFirst({where:{...scope(tenantId,k),id:{not:target},OR:[{name:q.name},...(kind==='levels'?[{rank:q.rank}]:[])]}});
   if(duplicate)fail('MEMBER_DUPLICATE',kind==='levels'?'等级名称或等级序号已存在':'标签名称已存在',409);
   const {version:_,...data}=q;
   const row=await db[model].upsert({where,create:{...scope(tenantId,k),id:target,...data},update:{...data,version:{increment:1}}});
   await this.audit(db,s,tenantId,k,'member.'+kind+'.save',{id:target,version:row.version});return{saved:true};
  });
 }
 async remove(s,tenantId,k,kind,input){

  const model=this.model(kind),q=parse(z.object({items:z.array(z.object({id:kind==='levels'?z.union([id,z.literal('default')]):id,version}).strict()).min(1).max(100).refine(v=>new Set(v.map(x=>x.id)).size===v.length)}).strict(),input);
  return this.apps.transaction(async db=>{await this.write(db,s,tenantId,k);
   for(const item of q.items){
    if(item.id==='default'){await this.removeBase(db,s,tenantId,k,item.version);continue}
    const where={tenantId_applicationKey_id:{...scope(tenantId,k),id:item.id}},old=await db[model].findUnique({where});if(!old||old.version!==item.version)fail('MEMBER_CONFLICT','内容已变更，请刷新后重试',409);
    const assigned=kind==='levels'?await db.consumerProfile.count({where:{...scope(tenantId,k),memberLevelId:item.id}}):await db.consumerTag.count({where:{...scope(tenantId,k),tagId:item.id}});
    if(assigned)fail('MEMBER_IN_USE','仍有用户关联，请先调整用户后删除',409);
    await db[model].delete({where});
   }await this.audit(db,s,tenantId,k,'member.'+kind+'.delete',{ids:q.items.map(x=>x.id)});return{deleted:q.items.length};
  });
 }
 async saveBase(s,tenantId,k,input){
  const q=parse(z.object({version,name,description:z.string().trim().max(200).default(''),rank:z.literal(-1).optional(),upgradeMode:z.literal('all').optional(),conditions:z.object({}).strict().optional(),benefits:memberBenefitsSchema.optional()}).strict(),input);
  return this.apps.transaction(async db=>{
   await this.write(db,s,tenantId,k);const old=await readDefaultMemberLevel(db,tenantId,k);if(old.deleted||old.version!==q.version)fail('MEMBER_CONFLICT','等级已变更，请刷新后重试',409);
   if(await db.memberLevel.count({where:{...scope(tenantId,k),name:q.name}}))fail('MEMBER_DUPLICATE','等级名称已存在',409);
   const baseLevel={name:q.name,description:q.description,benefits:q.benefits||old.benefits,version:old.version+1,updatedAt:new Date().toISOString()};
   await db.memberRule.upsert({where:{tenantId_applicationKey:scope(tenantId,k)},create:{...scope(tenantId,k),baseLevel},update:{baseLevel,version:{increment:1}}});
   await this.audit(db,s,tenantId,k,'member.levels.save',{id:'default',version:baseLevel.version});return{saved:true};
  });
 }
 async removeBase(db,s,tenantId,k,expectedVersion){
  const base=await readDefaultMemberLevel(db,tenantId,k);if(base.deleted||base.version!==expectedVersion)fail('MEMBER_CONFLICT','等级已变更，请刷新后重试',409);
  const members=await application(k).consumers.list(db,tenantId,{q:'',levelId:'none',page:1,pageSize:10},[]);
  if(members.total||await db.consumerProfile.count({where:{...scope(tenantId,k),memberLevelId:null}}))fail('MEMBER_IN_USE','仍有用户关联，请先调整用户后删除',409);
  const baseLevel={...base,deleted:true,version:base.version+1,updatedAt:new Date().toISOString()};
  await db.memberRule.upsert({where:{tenantId_applicationKey:scope(tenantId,k)},create:{...scope(tenantId,k),baseLevel},update:{baseLevel,version:{increment:1}}});
 }
 async saveRule(s,tenantId,k,input){
  const q=parse(z.object({version,registrationGrowth:amount,purchaseGrowthPerYuan:amount.optional()}).strict(),input);
  return this.apps.transaction(async db=>{await this.write(db,s,tenantId,k);const where={tenantId_applicationKey:scope(tenantId,k)},old=await db.memberRule.findUnique({where});if((old?.version||0)!==q.version)fail('MEMBER_CONFLICT','成长规则已更新，请刷新后重试',409);const data={registrationGrowth:q.registrationGrowth,purchaseGrowthPerYuan:q.purchaseGrowthPerYuan??old?.purchaseGrowthPerYuan??0};await db.memberRule.upsert({where,create:{...scope(tenantId,k),...data},update:{...data,version:{increment:1}}});await this.audit(db,s,tenantId,k,'member.rules.save',data);return{saved:true}});
 }
 async view(s,tenantId,k,userId,input={}){
  const q=parse(z.object(paging).strict(),input);await this.context(this.db,s,tenantId,k);
  const value=await this.db.$transaction(async db=>{
   const user=await application(k).consumers.detail(db,tenantId,userId,[]);if(!user)fail('NOT_FOUND','用户不存在',404);
   const profile=await db.consumerProfile.findUnique({where:profileWhere(tenantId,k,userId)}),summary=(await memberSummaries(db,tenantId,k,[userId])).get(userId)||{growth:0,level:defaultMemberLevel(),tags:[]},options=await memberOptions(db,tenantId,k);
   const where={...scope(tenantId,k),userId},total=await db.memberGrowthRecord.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)));
   const records=await db.memberGrowthRecord.findMany({where,orderBy:[{createdAt:'desc'},{requestId:'asc'}],skip:(page-1)*q.pageSize,take:q.pageSize,select:{requestId:true,kind:true,before:true,after:true,levelBefore:true,levelAfter:true,reason:true,createdAt:true}});
   return{userId,user:user.user,version:profile?.version||0,...summary,levels:options.levels,defaultLevel:options.defaultLevel,tagOptions:options.tags,records,total,page,pageSize:q.pageSize};
  },{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,k);return{...value,canWrite:current.permissions.includes('consumers.write')};
 }
 async change(s,tenantId,k,userId,input){
  const common={requestId:id,version,reason};
  const q=parse(z.discriminatedUnion('kind',[
   z.object({...common,kind:z.literal('growth'),delta:z.number().int().min(-2147483647).max(2147483647).refine(n=>n!==0)}).strict(),
   z.object({...common,kind:z.literal('level'),levelId:id.nullable()}).strict(),
   z.object({...common,kind:z.literal('recalculate')}).strict(),
   z.object({...common,kind:z.literal('tags'),tagIds:z.array(id).max(20).refine(v=>new Set(v).size===v.length)}).strict()
  ]),input);
  await this.apps.admin(s,tenantId,k,'consumers.write');
  return this.apps.transaction(async db=>{
   await this.write(db,s,tenantId,k);const user=await application(k).consumers.detail(db,tenantId,userId,[]);if(!user)fail('NOT_FOUND','用户不存在',404);if(!user.enabled)fail('MEMBER_DISABLED','用户已停用，不能调整',409);
   const operation={...scope(tenantId,k),userId,requestId:q.requestId},existing=await db.memberGrowthRecord.findUnique({where:{tenantId_applicationKey_userId_requestId:operation}}),payloadHash=hash(q);
   if(existing){if(existing.payloadHash!==payloadHash)fail('MEMBER_REQUEST_CONFLICT','请求编号已用于其他操作',409);return{saved:true,replayed:true}}
   const where=profileWhere(tenantId,k,userId);let old=await db.consumerProfile.findUnique({where,include:{memberLevel:true}});
   if((old?.version||0)!==q.version)fail('MEMBER_CONFLICT','用户已更新，请重新打开后操作',409);
   if(!old)old=await db.consumerProfile.create({data:{...scope(tenantId,k),userId,nickname:user.user.nickname||userId},include:{memberLevel:true}});
   const before=old.growth,after=q.kind==='growth'?before+q.delta:before;if(after<0||after>2147483647)fail('MEMBER_GROWTH_INVALID','成长值不能小于 0 或超过 2147483647');
   const levels=await db.memberLevel.findMany({where:scope(tenantId,k)});let level=old.memberLevel;
   if(q.kind==='level'){level=q.levelId?levels.find(l=>l.id===q.levelId):null;if(q.levelId&&!level)fail('MEMBER_INPUT_INVALID','所选等级不属于当前应用');}
   else if(q.kind==='growth'||q.kind==='recalculate')level=upgradedLevel(levels,after,level,await memberMetrics(db,tenantId,k,userId));
   if(q.kind==='tags'){
    if(await db.memberTag.count({where:{...scope(tenantId,k),id:{in:q.tagIds}}})!==q.tagIds.length)fail('MEMBER_INPUT_INVALID','所选标签不属于当前应用');
    await db.consumerTag.deleteMany({where:{...scope(tenantId,k),userId}});
    if(q.tagIds.length)await db.consumerTag.createMany({data:q.tagIds.map(tagId=>({...scope(tenantId,k),userId,tagId}))});
   }
   await db.consumerProfile.update({where,data:{growth:after,memberLevelId:level?.id||null,version:{increment:1}}});
   await db.memberGrowthRecord.create({data:{...operation,payloadHash,kind:q.kind,before,after,levelBefore:levelView(old.memberLevel,await readDefaultMemberLevel(db,tenantId,k)),levelAfter:levelView(level,await readDefaultMemberLevel(db,tenantId,k)),reason:q.reason,actor:s.impersonatedBy||s.id}});
   await this.audit(db,s,tenantId,k,'member.'+q.kind,{userId,requestId:q.requestId,before,after,levelBefore:old.memberLevelId,levelAfter:level?.id||null,...(q.kind==='tags'?{tagIds:q.tagIds}:{})});return{saved:true};
  });
 }
}
