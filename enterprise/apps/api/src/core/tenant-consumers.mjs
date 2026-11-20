import {formValidationMessage} from './form-validation.mjs';
import {Wallet} from './wallet.mjs';
import {z} from 'zod';
import {memberOptions,memberSummaries,initializeMember,defaultMemberLevel} from './member-management.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {fail} from './errors.mjs';
import {passwordHash} from './admin-auth.mjs';
import {randomUUID} from 'node:crypto';
import {normalizeAccountImage} from './account-image.mjs';
import {nextMemberNumber,readConsumerSettings} from './tenant-consumer-settings.mjs';

const query=z.object({levelId:z.union([z.string().uuid(),z.literal('none')]).optional(),tagId:z.string().uuid().optional(),applicationKey:z.string().max(64).optional(),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50].includes(v),'须为 10、20 或 50').default(20)}).strict();
const identifier=z.string().min(1).max(64).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'不能包含控制字符');
const profileFields={phone:z.string().trim().max(32).refine(value=>!value||/^\+?[0-9][0-9 ()-]{5,30}$/.test(value),'须以数字或 + 开头，号码部分为 6–31 个数字、空格、括号或短横线，可留空').optional(),email:z.union([z.literal(''),z.email().max(254)]).optional(),gender:z.enum(['unknown','male','female']).optional(),enabled:z.boolean().optional(),password:z.string().min(6).max(128).optional(),nickname:z.string().trim().min(1).max(32).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'不能包含控制字符'),avatar:z.string().max(120000).nullable().default(null)};
const userVersion=z.object({userId:identifier,version:z.number().int().nonnegative()}).strict();
const parse=(schema,input)=>{const result=schema.safeParse(input);if(!result.success)fail('CONSUMER_INPUT_INVALID',formValidationMessage(result.error,{userId:'账号',nickname:'昵称'}));return result.data};
export class TenantConsumers {
 constructor(db,storage=null){this.db=db;this.storage=storage;this.applications=new TenantApplications(db)}
 async context(db,s,tenantId,key){return this.applications.featureContext(db,s,tenantId,key,'consumers','consumers.read')}
 async list(s,tenantId,input){
  const q=parse(query,input);await this.context(this.db,s,tenantId,q.applicationKey);
  const snapshot=await this.db.$transaction(async db=>{
   const ctx=await this.context(db,s,tenantId,q.applicationKey),result=ctx.selected?await application(ctx.selected.key).consumers.list(db,tenantId,q,ctx.permissions):{items:[],total:0,page:1,pageSize:q.pageSize};
   if(ctx.selected){const summaries=await memberSummaries(db,tenantId,ctx.selected.key,result.items.map(r=>r.userId));result.items=result.items.map(row=>({...row,member:summaries.get(row.userId)||{growth:0,level:defaultMemberLevel(),tags:[]}}));result.memberOptions=await memberOptions(db,tenantId,ctx.selected.key);const avatar=(await readConsumerSettings(db,tenantId,ctx.selected.key)).config.users.defaultAvatar;result.items=result.items.map(row=>({...row,user:{...row.user,defaultAvatar:avatar}}))}
   if(ctx.selected&&ctx.permissions.includes('entitlements.read')&&application(ctx.selected.key).consumerAssets){const balances=await application(ctx.selected.key).consumerAssets.summaries(db,tenantId,result.items.map(r=>r.userId));result.items=result.items.map(row=>({...row,assets:balances.get(row.userId),membership:balances.get(row.userId)?.membership||row.membership}))}
   if(ctx.selected&&ctx.permissions.includes('entitlements.read')&&await db.rechargeSetting.count({where:{tenantId,applicationKey:ctx.selected.key}})){const accounts=await db.walletAccount.findMany({where:{tenantId,applicationKey:ctx.selected.key,userId:{in:result.items.map(r=>r.userId)}}});result.items=result.items.map(row=>({...row,wallet:{points:Number(accounts.find(a=>a.userId===row.userId&&a.asset==='points')?.amount||0),balanceCents:Number(accounts.find(a=>a.userId===row.userId&&a.asset==='balance')?.amount||0)}}))}
   return{value:{...result,canManageAssets:ctx.permissions.includes('entitlements.read')&&ctx.permissions.includes('entitlements.write')&&!!ctx.selected&&!!application(ctx.selected.key).consumerAssets,applicationKey:ctx.selected?.key||null,applications:ctx.sources,canWrite:ctx.permissions.includes('consumers.write')},permissions:ctx.permissions};
  },{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,snapshot.value.applicationKey||q.applicationKey);
  if(snapshot.permissions.some(permission=>!current.permissions.includes(permission)))fail('FORBIDDEN','用户查看权限已变更，请刷新',403);
  return snapshot.value;
 }
 async detail(s,tenantId,key,userId){
  parse(identifier,userId);await this.context(this.db,s,tenantId,key);
  const snapshot=await this.db.$transaction(async db=>{const ctx=await this.context(db,s,tenantId,key);if(!ctx.selected)fail('CONSUMER_INPUT_INVALID','请选择应用');const result=await application(ctx.selected.key).consumers.detail(db,tenantId,userId,ctx.permissions);if(!result)fail('NOT_FOUND','用户不存在',404);result.member=(await memberSummaries(db,tenantId,key,[userId])).get(userId)||{growth:0,level:defaultMemberLevel(),tags:[]};if(ctx.permissions.includes('entitlements.read')&&application(key).consumerAssets){result.assets=await application(key).consumerAssets.read(db,tenantId,userId);result.membership=result.assets.membership;if(await db.rechargeSetting.count({where:{tenantId,applicationKey:key}})){const wallet=await new Wallet(this.db).summary(db,{tenantId,applicationKey:key,userId});result.wallet={points:wallet.points.amount,balanceCents:wallet.balance.amount}}}return{value:{...result,application:ctx.selected},permissions:ctx.permissions}},{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,key);if(snapshot.permissions.some(permission=>!current.permissions.includes(permission)))fail('FORBIDDEN','用户查看权限已变更，请刷新',403);
  snapshot.value.user.defaultAvatar=(await readConsumerSettings(this.db,tenantId,key)).config.users.defaultAvatar;return snapshot.value;
 }
 async writeContext(db,s,tenantId,key){
  // Acquire the tenant write lock before serializable permission reads to avoid lock upgrades during concurrent creation.
  if(db!==this.db)await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;
  const ctx=await this.context(db,s,tenantId,key);if(!ctx.selected||!ctx.permissions.includes('consumers.write'))fail('FORBIDDEN','没有管理用户的权限',403);await this.applications.admin(s,tenantId,key,'consumers.write',db,true);return ctx;
 }
 async audit(db,s,tenantId,key,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
 async create(s,tenantId,input){
  const q=parse(z.object({applicationKey:z.string().min(1).max(64),userId:z.string().regex(/^[a-zA-Z0-9]{3,64}$/,'须为 3–64 个英文字母或数字'),...profileFields}).strict(),input);
  await this.writeContext(this.db,s,tenantId,q.applicationKey);const avatar=await normalizeAccountImage(q.avatar,{storage:this.storage,siteId:tenantId}),secret=q.password?await passwordHash(q.password):undefined;
  return this.applications.transaction(async db=>{await this.writeContext(db,s,tenantId,q.applicationKey);const where={tenantId,applicationKey:q.applicationKey,userId:q.userId};
   if(await db.consumerProfile.count({where})||await application(q.applicationKey).consumers.detail(db,tenantId,q.userId,[]))fail('CONSUMER_EXISTS','用户账号已存在或已删除，不能重复创建',409);
   const memberNumber=await nextMemberNumber(db,tenantId,q.applicationKey);
   await db.consumerProfile.create({data:{...where,memberNumber,nickname:q.nickname,avatar,phone:q.phone||'',email:q.email||'',gender:q.gender||'unknown',enabled:q.enabled??true,passwordHash:secret}});await initializeMember(db,tenantId,q.applicationKey,q.userId);await this.audit(db,s,tenantId,q.applicationKey,'consumer.create',{userId:q.userId,memberNumber});return{created:true};
  });
 }
 async update(s,tenantId,key,userId,input){
  parse(identifier,userId);const q=parse(z.object({version:z.number().int().nonnegative(),...profileFields}).strict(),input);await this.writeContext(this.db,s,tenantId,key);const avatar=await normalizeAccountImage(q.avatar,{storage:this.storage,siteId:tenantId}),secret=q.password?await passwordHash(q.password):undefined;
  return this.applications.transaction(async db=>{await this.writeContext(db,s,tenantId,key);const where={tenantId_applicationKey_userId:{tenantId,applicationKey:key,userId}},old=await db.consumerProfile.findUnique({where});
   if(old?.deletedAt||!await application(key).consumers.detail(db,tenantId,userId,[]))fail('NOT_FOUND','用户不存在',404);
   if((old?.version||0)!==q.version)fail('CONSUMER_CONFLICT','用户资料已更新，请重新打开后编辑',409);
   if(old)await db.consumerProfile.update({where,data:{nickname:q.nickname,avatar,phone:q.phone,email:q.email,gender:q.gender,enabled:q.enabled,passwordHash:secret,version:{increment:1}}});else await db.consumerProfile.create({data:{tenantId,applicationKey:key,userId,nickname:q.nickname,avatar,phone:q.phone||'',email:q.email||'',gender:q.gender||'unknown',enabled:q.enabled??true,passwordHash:secret}});
   if(secret||q.enabled===false)await db.session.deleteMany({where:{tenantId,applicationKey:key,userId,role:'user'}});
   await this.audit(db,s,tenantId,key,'consumer.update',{userId,version:q.version+1,passwordChanged:!!secret,enabled:q.enabled??old?.enabled??true});return{updated:true};
  });
 }
 async remove(s,tenantId,input){
  const q=parse(z.object({applicationKey:z.string().min(1).max(64),users:z.array(userVersion).min(1).max(100).refine(rows=>new Set(rows.map(row=>row.userId)).size===rows.length,'不能重复选择同一用户'),confirm:z.literal('删除用户')}).strict(),input);
  return this.applications.transaction(async db=>{await this.writeContext(db,s,tenantId,q.applicationKey);
   for(const item of q.users){const where={tenantId_applicationKey_userId:{tenantId,applicationKey:q.applicationKey,userId:item.userId}},old=await db.consumerProfile.findUnique({where}),user=await application(q.applicationKey).consumers.detail(db,tenantId,item.userId,[]);
    if(old?.deletedAt||!user)fail('NOT_FOUND','部分用户已不存在，请刷新后重试',404);
    if((old?.version||0)!==item.version)fail('CONSUMER_CONFLICT','部分用户资料已更新，请刷新后重试',409);
    if(old)await db.consumerProfile.update({where,data:{deletedAt:new Date(),version:{increment:1}}});else await db.consumerProfile.create({data:{tenantId,applicationKey:q.applicationKey,userId:item.userId,nickname:user.user.nickname||item.userId,deletedAt:new Date()}});
   }
   await db.session.deleteMany({where:{tenantId,applicationKey:q.applicationKey,userId:{in:q.users.map(row=>row.userId)},role:'user'}});
   await this.audit(db,s,tenantId,q.applicationKey,'consumer.delete',{userIds:q.users.map(row=>row.userId),count:q.users.length});return{deleted:q.users.length};
  });
 }
}
