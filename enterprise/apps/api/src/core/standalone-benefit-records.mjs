const types=[{key:'service_count',label:'服务次数包'}]
const states=[{key:'active',label:'可使用'},{key:'exhausted',label:'已用完'},{key:'expired',label:'已过期'}]
const changes=[{key:'grant',label:'发放'},{key:'redeem',label:'核销'}]
const consumer={select:{nickname:true,avatar:true,enabled:true,deletedAt:true}}
function displayUser(row) {return {id:row.userId,nickname:row.consumer.nickname,avatar:row.consumer.avatar}}

function holdingView(row,at) {
  const status=row.remaining===0?'exhausted':row.expiresAt&&row.expiresAt<=at?'expired':'active'
  return {
    id:row.id,packageId:row.packageId,version:row.version,userId:row.userId,user:displayUser(row),
    userStatus:row.consumer.deletedAt?'已删除':row.consumer.enabled?'启用':'停用',
    name:row.packageName,type:'service_count',typeLabel:'服务次数包',unit:'次',total:row.total,remaining:row.remaining,
    used:row.total-row.remaining,acquiredAt:row.createdAt,expiresAt:row.expiresAt,sourceLabel:'管理员发放',
    status,statusLabel:states.find(s=>s.key===status).label,
  }
}
function ledgerView(row) {
  const h=row.holding,change=changes.find(x=>x.key===row.kind)
  return {id:row.id,holdingId:h.id,packageId:h.packageId,userId:row.userId,user:displayUser(h),
    name:h.packageName,type:row.kind,typeLabel:change.label,status:'posted',statusLabel:'已记账',unit:'次',
    change:String(row.delta),beforeAmount:String(row.afterAmount-row.delta),afterAmount:String(row.afterAmount),
    remaining:row.afterAmount,occurredAt:row.createdAt,reason:row.reason,actorName:row.actor,reference:h.id,sourceLabel:change.label}
}
export function frameworkBenefitRecords(key,ledger=false) {
  const catalog=ledger?{types:changes,statuses:[{key:'posted',label:'已记账'}]}:{types,statuses:states}
  const include=ledger?{holding:{include:{consumer}}}:{consumer}
  return {catalog,
    async list(db,tenantId,q){
      const now=new Date(),where={tenantId,applicationKey:key}
      const table=ledger?db.standaloneBenefitEntry:db.standaloneBenefitHolding
      if(q.start||q.end)where.createdAt={...(q.start?{gte:q.start}:{}),...(q.end?{lt:q.end}:{})}
      if(q.q){
        const text={contains:q.q}
        const filters=[{packageName:text},{consumer:{nickname:text}}]
        where.OR=[{userId:text},{id:text},...filters.map(p=>ledger?{holding:p}:p)]
      }
      if(ledger&&q.type!=='all')where.kind=q.type
      if(!ledger&&q.status!=='all'){
        if(q.status==='exhausted')where.remaining=0
        else{
          where.remaining={gt:0}
          if(q.status==='expired')where.expiresAt={lte:now}
          else where.AND=[{OR:[{expiresAt:null},{expiresAt:{gt:now}}]}]
        }
      }
      const total=await table.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)))
      const rows=await table.findMany({where,include,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(page-1)*q.pageSize,take:q.pageSize})
      return {items:rows.map(row=>ledger?ledgerView(row):holdingView(row,now)),total,page,pageSize:q.pageSize}
    },
    async detail(db,tenantId,id,q){
      const scope={tenantId,applicationKey:key}
      const row=await (ledger?db.standaloneBenefitEntry:db.standaloneBenefitHolding).findUnique({where:{tenantId_applicationKey_id:{...scope,id}},include})
      if(!row||ledger)return row?ledgerView(row):null
      const where={...scope,holdingId:id,kind:'redeem'}
      const total=await db.standaloneBenefitEntry.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)))
      const entries=await db.standaloneBenefitEntry.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(page-1)*q.pageSize,take:q.pageSize})
      return {...holdingView(row,new Date()),usage:{items:entries.map(e=>({id:e.id,amount:-e.delta,createdAt:e.createdAt})),total,page,pageSize:q.pageSize}}
    },
  }
}
