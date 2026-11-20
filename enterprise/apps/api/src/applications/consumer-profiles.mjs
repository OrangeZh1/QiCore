import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from './service.mjs';
import {normalizeAccountImage} from '../core/account-image.mjs';
import {assertConsumerActive} from '../core/consumer-lifecycle.mjs';
import {fail} from '../core/errors.mjs';
import {consumerAccountDisplay} from '../core/consumer-account.mjs';
import {readConsumerSettings} from '../core/tenant-consumer-settings.mjs';
export const consumerIdentity=(userId,profiles)=>({id:userId,nickname:profiles.get(userId)?.nickname||null,avatar:profiles.get(userId)?.avatar||null,...(profiles.defaultAvatar?{defaultAvatar:profiles.defaultAvatar}:{})});
export async function consumerIdentities(db,tenantId,userIds,applicationKey){if(typeof applicationKey!=='string'||!applicationKey)fail('APPLICATION_REQUIRED','请选择应用',400);if(!userIds.length)return new Map();const rows=await db.consumerProfile.findMany({where:{tenantId,applicationKey,userId:{in:[...new Set(userIds)]}},select:{userId:true,nickname:true,avatar:true}});const result=new Map(rows.map(row=>[row.userId,row]));result.defaultAvatar=(await readConsumerSettings(db,tenantId,applicationKey)).config.users.defaultAvatar;return result}
export class ConsumerProfiles {
 constructor(db,storage=null){this.db=db;this.storage=storage;this.applications=new TenantApplications(db)}
 async authorize(s,db=this.db,lock=false){if(s?.role!=='user'||typeof s.applicationKey!=='string'||typeof s.token!=='string'||!await db.session.findFirst({where:{token:s.token,tenantId:s.tenantId,userId:s.userId,applicationKey:s.applicationKey,role:'user',expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','用户会话已失效',401);await this.applications.available(s.tenantId,s.applicationKey,db,lock);await assertConsumerActive(db,s.tenantId,s.applicationKey,s.userId)}
 where(s){return{tenantId_applicationKey_userId:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId}}}
 async expose(s,row,db=this.db){return{id:s.userId,...await consumerAccountDisplay(db,s),nickname:row?.nickname||'',avatar:row?.avatar||null,phone:row?.phone||'',email:row?.email||'',gender:row?.gender||'unknown',memberNumber:row?.memberNumber||null,hasPassword:!!row?.passwordHash,version:row?.version||0}}
 async view(s){await this.authorize(s);const settings=await readConsumerSettings(this.db,s.tenantId,s.applicationKey);return{...await this.expose(s,await this.db.consumerProfile.findUnique({where:this.where(s)})),defaultAvatar:settings.config.users.defaultAvatar}}
 async save(s,input){
  await this.authorize(s);const parsed=z.object({version:z.number().int().nonnegative(),nickname:z.string().trim().max(32).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)),avatar:z.string().max(120000).nullable(),phone:z.string().trim().max(32).refine(v=>!v||/^\+?[0-9][0-9 ()-]{5,30}$/.test(v)).optional(),email:z.union([z.literal(''),z.email().max(254)]).optional(),gender:z.enum(['unknown','male','female']).optional()}).strict().safeParse(input);if(!parsed.success)fail('PROFILE_INPUT_INVALID','请检查昵称、头像和联系方式');const q=parsed.data,avatar=await normalizeAccountImage(q.avatar,{storage:this.storage,siteId:s.tenantId});
  return this.applications.transaction(async db=>{await this.authorize(s,db,true);const where=this.where(s),old=await db.consumerProfile.findUnique({where});if((old?.version||0)!==q.version)fail('PROFILE_CONFLICT','用户资料已更新，请重新读取',409);const row=old?await db.consumerProfile.update({where,data:{nickname:q.nickname,avatar,phone:q.phone,email:q.email,gender:q.gender,version:{increment:1}}}):await db.consumerProfile.create({data:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId,nickname:q.nickname,avatar,phone:q.phone,email:q.email,gender:q.gender}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:s.tenantId,applicationKey:s.applicationKey,actor:'consumer:'+createHash('sha256').update(s.userId).digest('hex').slice(0,48),action:'consumer.profile.update',details:{userId:s.userId,version:row.version,nicknameChanged:old?.nickname!==q.nickname,avatarChanged:old?.avatar!==avatar}}});return this.expose(s,row,db)});
 }
}
