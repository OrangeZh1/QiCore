import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'

const endpoint=new URL(process.env.QA_API_ORIGIN)
const adminOrigin=new URL(process.env.QA_ADMIN_ORIGIN)
const database=new URL(process.env.DATABASE_URL)
const loopback=v=>['127.0.0.1','localhost','[::1]'].includes(v.hostname)
if(process.env.QA_DISPOSABLE!=='1'||!loopback(endpoint)||!loopback(adminOrigin)||!loopback(database)||
   !/^\/(?:qc_fixture_|qicore_qa_)[a-zA-Z0-9_]+$/.test(database.pathname)){
  throw Error('只允许针对回环地址的一次性 qc_fixture_ 或 qicore_qa_ 数据库执行')
}
const credentials=JSON.parse(await readFile(process.env.QA_OWNER_CREDENTIALS,'utf8'))
const db=new PrismaClient()
let cookie='',csrf=''
async function query(path,method='GET',body,expected=200) {
  const response=await fetch(endpoint.origin+'/api/v1'+path,{
    method,headers:{origin:adminOrigin.origin,'x-console-portal':'tenant',
      ...(cookie?{cookie,'x-csrf-token':csrf}:{}),...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  })
  const json=await response.json()
  assert.equal(response.status,expected,method+' '+path+' '+(json.error?.code||''))
  return {data:json.data,response}
}
try{
  const id=(await db.tenant.findUniqueOrThrow({where:{standaloneSlot:1},select:{id:true,ownerAdminId:true}}))
  const login=await query('/admin/auth/login','POST',{username:credentials.username,password:credentials.password,portal:'tenant'})
  const pair=login.response.headers.getSetCookie().map(v=>v.split(';')[0]).find(v=>v.startsWith('qicore_enterprise_session='))
  assert.ok(pair,'必须使用这个单开实例的企业会话')
  cookie=pair;csrf=login.data.csrfToken
  assert.equal(login.data.id,id.ownerAdminId)
  // Prove the HTTP host actually issued this fresh session in the nominated disposable database.
  const session=await db.adminSession.findUniqueOrThrow({where:{tokenHash:createHash('sha256').update(pair.slice(pair.indexOf('=')+1)).digest('hex')}})
  assert.equal(session.adminId,id.ownerAdminId)
  const entry=(await query('/admin/tenant-entry')).data
  assert.equal(entry.tenant.id,id.id)
  assert.equal(entry.applications.length,0,'仅用于零应用实例')
  for(const key of ['consumers','packages','entitlements','entitlementLedger','pointsLedger','transactions','payments','virtualGoods','recharge','sms','subscriptions','wechatMini','wechatOfficial','h5','decoration']){
    assert.equal(entry.tenant.features[key],true,key)
  }
  const base='/admin/tenants/'+id.id
  const read=async tail=>(await query(base+tail)).data
  const post=async(tail,data,status)=>(await query(base+tail,'POST',data,status)).data
  const marker=randomUUID().replaceAll('-','').slice(0,12),userId='qa'+marker
  await post('/consumers',{applicationKey:'system',userId,nickname:'隔离验收用户 '+marker})
  assert.equal((await read('/consumers?q='+userId)).total,1)
  await read('/consumers/system/'+userId+'/membership')
  await read('/member-levels')
  await read('/member-tags')
  const initial=await read('/packages?applicationKey=system')
  assert.equal(initial.catalog.types[0].key,'service_count')
  const packageId=randomUUID()
  await post('/packages/system',{version:initial.version,requestId:packageId,package:{
    type:'service_count',name:'验收次数包 '+marker,priceCents:0,originalPriceCents:null,image:null,badge:'',enabled:true,benefits:{count:10,validDays:2},
  }})
  const packageList=await read('/packages?q='+marker)
  assert.equal(packageList.items[0].id,packageId)
  const grantRequest={requestId:randomUUID(),userId,packageId,reason:'隔离验收发放'}
  const [a,b]=await Promise.all([post('/entitlements/system/grant',grantRequest),post('/entitlements/system/grant',grantRequest)])
  assert.deepEqual(a,b)
  assert.equal(a.remaining,10)
  await post('/entitlements/system/grant',{...grantRequest,reason:'不同内容'},409)
  const holdingPath='/entitlements/system/'+a.holdingId
  const redeemPath=holdingPath+'/redeem'
  const first={requestId:randomUUID(),count:6,version:a.version,reason:'现场服务'}
  const changed=await post(redeemPath,first)
  assert.equal(changed.remaining,4)
  assert.deepEqual(await post(redeemPath,first),changed)
  await post(redeemPath,{...first,requestId:randomUUID()},409)
  await post(redeemPath,{...first,requestId:randomUUID(),version:changed.version,count:5},409)
  // Distinct requests competing for the same remaining four uses cannot overspend.
  const cmd={count:4,version:changed.version,reason:'完成验收'}
  const competing=await Promise.all([1,2].map(async()=>{
    const res=await fetch(endpoint.origin+'/api/v1'+base+redeemPath,{
      method:'POST',headers:{origin:adminOrigin.origin,'x-console-portal':'tenant',cookie,'x-csrf-token':csrf,'content-type':'application/json'},
      body:JSON.stringify({...cmd,requestId:randomUUID()}),
    })
    return res.status
  }))
  assert.deepEqual(competing.sort(),[200,409])
  const holding=await read(holdingPath+'?page=1&pageSize=10')
  assert.equal(holding.remaining,0);assert.equal(holding.used,10);assert.equal(holding.usage.total,2)
  const entries=await read('/entitlement-ledger?q='+userId)
  assert.equal(entries.total,3);assert.equal(entries.items.reduce((sum,e)=>sum+Number(e.change),0),0)
  assert.equal((await read('/entitlements?q='+userId)).total,1)
  // Expiry is checked by the server clock. Set just this disposable holding's expiry in the past.
  const expired=await post('/entitlements/system/grant',{...grantRequest,requestId:randomUUID()})
  await db.standaloneBenefitHolding.update({where:{tenantId_applicationKey_id:{tenantId:id.id,applicationKey:'system',id:expired.holdingId}},data:{expiresAt:new Date(Date.now()-60000)}})
  await post('/entitlements/system/'+expired.holdingId+'/redeem',{...cmd,count:1,version:1,requestId:randomUUID()},409)
  assert.equal((await read('/entitlements/system/'+expired.holdingId)).remaining,10)
  await post('/entitlements/unloaded/grant',{...grantRequest,requestId:randomUUID()},404)
  const catalog=await read('/packages?q='+marker)
  await query(base+'/packages/system/'+packageId+'/status','PUT',{enabled:false,version:catalog.version})
  await post('/entitlements/system/grant',{...grantRequest,requestId:randomUUID()},409)
  assert.equal((await read(holdingPath)).total,10,'套餐停用不能重写历史发放规格')
  for(const path of ['/points-ledger','/transactions','/recharge','/payment-settings','/payment-methods','/sms-settings','/subscription-settings','/channels','/decoration']){
    const result=await read(path+'?applicationKey=system')
    assert.ok(result,path)
    if(path==='/payment-settings')assert.deepEqual(new Set(result.channels.map(c=>c.provider)),new Set(['wechat','alipay','wechat-virtual']))
  }
  console.log('PASS 零应用企业负责人真实用户、会员、套餐、发放/核销、幂等重放及并发余额，支付/短信/订阅/渠道和装修只读配置')
}finally{
  if(cookie)await query('/admin/auth/logout','POST',{}).catch(()=>{})
  await db.$disconnect()
}
