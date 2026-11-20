import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { frameworkKey } from '../applications/framework.mjs'
import { TenantApplications } from '../applications/service.mjs'
import { fail } from './errors.mjs'
import { systemBenefitCatalog } from './standalone-benefit-store.mjs'

const request={requestId:z.uuid(),reason:z.string().trim().min(1).max(200)}
const grant=z.object({...request,userId:z.string().min(1).max(64),packageId:z.uuid()}).strict()
const redeem=z.object({...request,count:z.number().int().min(1).max(1000000),version:z.number().int().positive()}).strict()
function assertMember(profile) {
  if(!profile||profile.deletedAt||!profile.enabled)fail('BENEFIT_USER_UNAVAILABLE','用户不存在或已停用',409)
}
function receipt(entry){return {holdingId:entry.holdingId,entryId:entry.id,remaining:entry.afterAmount,version:entry.holdingVersion}}

export class StandaloneBenefits {
  constructor(db){this.db=db;this.apps=new TenantApplications(db)}
  async change(s,tenantId,key,holdingId,body){
    if(key!==frameworkKey)fail('NOT_FOUND','接口不存在',404)
    if(holdingId!==null&&!z.uuid().safeParse(holdingId).success)fail('BENEFIT_INPUT_INVALID','权益记录编号无效')
    const parsed=(holdingId===null?grant:redeem).safeParse(body)
    if(!parsed.success)fail('BENEFIT_INPUT_INVALID','请检查用户、套餐、操作原因及次数')
    const input=parsed.data,scope={tenantId,applicationKey:key},kind=holdingId===null?'grant':'redeem'
    const hash=createHash('sha256').update(JSON.stringify([kind,holdingId,s.id,input])).digest('hex')
    return this.apps.transaction(async db=>{
      // Keep the host's tenant → application lock ordering for every entitlement mutation.
      await this.apps.admin(s,tenantId,key,'entitlements.read',db,true)
      await this.apps.admin(s,tenantId,key,'entitlements.write',db)
      const old=await db.standaloneBenefitEntry.findUnique({where:{tenantId_applicationKey_requestId:{...scope,requestId:input.requestId}}})
      if(old){
        if(old.payloadHash!==hash)fail('BENEFIT_REQUEST_CONFLICT','请求内容已改变，请重新发起',409)
        return receipt(old)
      }
      const now=new Date()
      let holding,delta
      if(kind==='grant'){
        const catalog=await systemBenefitCatalog(db,tenantId,key)
        const pkg=catalog.config.packages.find(row=>row.id===input.packageId&&row.enabled)
        if(!pkg)fail('BENEFIT_PACKAGE_UNAVAILABLE','套餐不存在或已停用',409)
        const profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{...scope,userId:input.userId}}})
        assertMember(profile)
        delta=pkg.benefits.count
        holding=await db.standaloneBenefitHolding.create({data:{...scope,id:randomUUID(),userId:profile.userId,
          packageId:pkg.id,packageName:pkg.name,total:delta,remaining:delta,
          expiresAt:pkg.benefits.validDays?new Date(now.getTime()+pkg.benefits.validDays*86400000):null}})
      }else{
        const where={tenantId_applicationKey_id:{...scope,id:holdingId}}
        const original=await db.standaloneBenefitHolding.findUnique({where,include:{consumer:{select:{enabled:true,deletedAt:true}}}})
        if(!original)fail('NOT_FOUND','权益记录不存在',404)
        assertMember(original.consumer)
        if(original.expiresAt&&original.expiresAt<=now)fail('BENEFIT_EXPIRED','权益已过期',409)
        if(original.version!==input.version)fail('BENEFIT_CONFLICT','权益已变更，请刷新后核销',409)
        if(original.remaining<input.count)fail('BENEFIT_INSUFFICIENT','可用次数不足',409)
        delta=-input.count
        const changed=await db.standaloneBenefitHolding.updateMany({where:{...scope,id:holdingId,userId:original.userId,version:input.version,
          remaining:{gte:input.count},OR:[{expiresAt:null},{expiresAt:{gt:now}}]},data:{remaining:{decrement:input.count},version:{increment:1}}})
        if(!changed.count)fail('BENEFIT_CONFLICT','权益已变更，请刷新后核销',409)
        holding=await db.standaloneBenefitHolding.findUniqueOrThrow({where})
      }
      const entry=await db.standaloneBenefitEntry.create({data:{...scope,id:randomUUID(),requestId:input.requestId,payloadHash:hash,
        kind,holdingId:holding.id,userId:holding.userId,delta,afterAmount:holding.remaining,holdingVersion:holding.version,actor:s.id,reason:input.reason}})
      await db.audit.create({data:{...scope,id:randomUUID(),scope:'tenant',actor:s.id,action:'benefit.'+kind,
        details:{entryId:entry.id,holdingId:holding.id,packageId:holding.packageId,userId:holding.userId,delta,afterAmount:holding.remaining}}})
      return receipt(entry)
    })
  }
}
