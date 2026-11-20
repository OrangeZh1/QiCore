import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertEnterpriseRequest,assertEnterpriseSession,bindStandaloneEnterprise,
  enterpriseId,productEdition,provisionEnterprise,scopedInput,
} from '../src/core/standalone-edition.mjs'

const company='company-a'
const allowed=(path,method='GET',extra={})=>assertEnterpriseRequest(company,{path,method,...extra})
test('单开版从持久唯一企业读取身份，失效所有者或多行数据阻止启动', async()=>{
  assert.equal(productEdition,'standalone')
  const row={id:company,standaloneSlot:1,ownerAdminId:'owner'}
  let rows=[row], enabled=true
  const db={
    tenant:{findMany:async()=>rows},
    adminTenantScope:{findUnique:async()=>({enabled,admin:{enabled:true,role:{enabled:true,portal:'tenant'}}})},
  }
  assert.throws(()=>enterpriseId(db),/NOT_READY/)
  assert.equal(await bindStandaloneEnterprise(db),company)
  rows=[row,{...row,id:'company-b'}]
  await assert.rejects(bindStandaloneEnterprise(db),/BINDING_REQUIRED/)
  rows=[row];enabled=false
  await assert.rejects(bindStandaloneEnterprise(db),/OWNER_SCOPE_INVALID/)
  enabled=true;rows=[{...row,id:'company-b'}]
  await assert.rejects(bindStandaloneEnterprise(db),/ENTERPRISE_CHANGED/)
})
test('安装在传入事务中分配随机企业 ID，并把初始账号绑定为企业负责人',async()=>{
  const records={}
  const create=name=>async({data})=>records[name]=data
  const tx={
    adminRole:{upsert:async({create})=>({...create,enabled:true})},
    tenant:{count:async()=>0,create:create('company')},adminAccount:{count:async()=>0,create:create('owner')},
    adminTenantScope:{create:create('scope')},audit:{create:create('audit')},
  }
  const id=await provisionEnterprise(tx,{username:'operator',nickname:'初始管理员',passwordHash:'test verifier',permissions:['tenant:accounts.read'],requestId:'test-attempt'})
  assert.equal(records.company.standaloneSlot,1)
  assert.equal(records.company.ownerAdminId,records.owner.id)
  assert.deepEqual(records.scope,{adminId:records.owner.id,tenantId:id})
  assert.equal(records.audit.scope,'tenant')
  tx.tenant.count=async()=>1
  await assert.rejects(provisionEnterprise(tx,{}),/TARGET_NOT_EMPTY/)
})
test('企业后台保留原入口与作用域断言，平台运营和租户生命周期不对外提供',()=>{
  allowed('/api/v1/admin/auth/login','POST',{body:{portal:'tenant'}})
  allowed('/api/v1/admin/auth/me')
  allowed('/api/v1/admin/tenant-entry','GET',{query:{tenantId:company}})
  allowed('/api/v1/admin/tenants/company-a/roles','POST')
  allowed('/api/v1/admin/tenants/company-a/materials/shared/upload','POST')
  for(const [path,method] of [
    ['/api/v1/admin/tenants','POST'],['/api/v1/admin/tenants/company-a','PUT'],
    ['/api/v1/admin/tenants/company-a/login','POST'],['/api/v1/admin/tenants/company-a/applications/app-a','PUT'],
    ['/api/v1/admin/platform-admins','GET'],['/api/v1/admin/materials/upload','POST'],
    ['/api/v1/admin/auth/demo-login','POST'],['/api/v1/dev/session','POST'],['/api/v1/apps/app-a/dev/session','POST'],
  ])assert.throws(()=>allowed(path,method),{status:404},path)
  assert.throws(()=>allowed('/api/v1/admin/auth/login','POST',{body:{portal:'admin'}}),{status:404})
  assert.throws(()=>allowed('/api/v1/admin/auth/me','GET',{headers:{cookie:'qicore_tenant_delegate=archived'}}),{status:403})
})
test('身份边界同时覆盖路径、查询、正文、旧客户端 header、公众号/虚拟支付回调和导航会话',()=>{
  for(const path of ['/api/v1/admin/tenants/other/roles','/api/v1/public/help/other/system','/api/v1/public/wechat-official/other/app','/api/v1/payments/wechat-virtual/other/app/notify']){
    assert.throws(()=>allowed(path),{status:403})
  }
  assert.deepEqual(scopedInput(company,{applicationKey:'system'}),{tenantId:company,applicationKey:'system'})
  assert.throws(()=>scopedInput(company,{tenantId:'other'}),{status:403})
  for(const values of [{query:{tenantId:'other'}},{body:{siteId:'other'}},{headers:{'x-tenant-id':'other'}}]) {
    assert.throws(()=>allowed('/api/v1/consumer/auth/login','POST',values))
  }
  const session={role:'tenant',tenantIds:[company],tenantId:company}
  assertEnterpriseSession(company,session)
  for(const changes of [{role:'root'},{delegated:true},{tenantIds:[company,'other']},{tenantId:'other'}]){
    assert.throws(()=>assertEnterpriseSession(company,{...session,...changes}),{status:401})
  }
})
