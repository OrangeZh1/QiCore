import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {fail} from './errors.mjs';
const identifier=z.string().min(1).max(64).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const common={requestId:z.uuid(),version:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(200).refine(v=>!/[\u0000-\u001f\u007f]/.test(v))};
const date=z.iso.datetime({offset:true});
const schema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('points.add'),amount:z.number().int().min(1).max(1000000),expiresAt:date.nullable().default(null)}).strict(),
 z.object({...common,kind:z.literal('points.deduct'),amount:z.number().int().min(1).max(1000000),expiresAt:z.null().default(null)}).strict(),
 z.object({...common,kind:z.literal('membership.set'),enabled:z.boolean(),amount:z.number().int().min(0).max(1000000),expiresAt:date.nullable()}).strict().refine(v=>v.enabled||v.amount===0&&v.expiresAt===null)
]);
const parse=(type,input)=>{const result=type.safeParse(input);if(!result.success)fail('ASSET_INPUT_INVALID','请检查积分、会员有效期和操作原因');return result.data};
export class ConsumerAssets {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 adapter(key){const value=application(key).consumerAssets;if(!value)fail('ASSET_UNSUPPORTED','该应用未接入积分与会员管理');return value}
 async context(db,s,tenantId,key,userId,write=false){parse(identifier,userId);await this.apps.admin(s,tenantId,key,'consumers.read',db,write);await this.apps.admin(s,tenantId,key,write?'entitlements.write':'entitlements.read',db);if(write)await this.apps.admin(s,tenantId,key,'entitlements.read',db);if(!await application(key).consumers.detail(db,tenantId,userId,[]))fail('NOT_FOUND','用户不存在',404);if(write)await assertConsumerActive(db,tenantId,key,userId)}
 async view(s,tenantId,key,userId){await this.context(this.db,s,tenantId,key,userId);const assets=await this.adapter(key).read(this.db,tenantId,userId),user=await application(key).consumers.detail(this.db,tenantId,userId,[]);await this.context(this.db,s,tenantId,key,userId);return{...assets,user:user.user,userId}}
 async change(s,tenantId,key,userId,input){
  const q=parse(schema,input),payloadHash=createHash('sha256').update(JSON.stringify({tenantId,key,userId,...q})).digest('hex');
  return this.apps.transaction(async db=>{
   await this.context(db,s,tenantId,key,userId,true);const existing=await db.consumerAssetOperation.findUnique({where:{tenantId_applicationKey_requestId:{tenantId,applicationKey:key,requestId:q.requestId}}});
   if(existing){if(existing.payloadHash!==payloadHash)fail('ASSET_REQUEST_CONFLICT','该操作编号已用于其他内容，请查询原结果',409);return{operationId:existing.id,duplicate:true,assets:await this.adapter(key).read(db,tenantId,userId)}}
   if(q.expiresAt&&(Date.parse(q.expiresAt)<=Date.now()||Date.parse(q.expiresAt)>=Date.now()+3650*86400000))fail('ASSET_INPUT_INVALID','到期时间须晚于当前时间且在十年以内');
   const id=randomUUID(),result=await this.adapter(key).apply(db,tenantId,userId,id,q),field=q.kind.startsWith('points.')?'points':'memberPoints',before=result.before[field],after=result.after[field];
   const actor=await this.apps.actor(db,s,'tenant',tenantId);await db.consumerAssetOperation.create({data:{id,tenantId,applicationKey:key,userId,requestId:q.requestId,payloadHash,kind:q.kind,assetType:q.kind.startsWith('points.')?'pack':'member',delta:BigInt(after-before),beforeAmount:BigInt(before),afterAmount:BigInt(after),grantId:result.grantId,reason:q.reason,actorId:s.impersonatedBy||s.id,actorName:s.delegated?'平台代操作':actor.nickname||actor.username,membershipBefore:JSON.parse(JSON.stringify(result.before.membership)),membershipAfter:JSON.parse(JSON.stringify(result.after.membership))}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'consumer.'+q.kind,details:{userId,operationId:id,reason:q.reason,before:result.before,after:result.after,affectedBatches:result.snapshot,...(s.delegated?{targetAdminId:s.id}:{})}}});
   return{operationId:id,duplicate:false,assets:result.after};
  });
 }
}
