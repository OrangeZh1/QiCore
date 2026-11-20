import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TenantManagement} from '../dist/core/tenant-management.js';
const session={id:'test-admin',_admin:true,role:'root',permissions:['accounts.write','tenants.write']};
const valid={requestId:'323894ac-2a62-4618-bb6f-1dac380bac84',username:'test-user',nickname:'中文名称',password:'test12',phone:''};
test('expiring a tenant preserves console identity while disabling it still revokes console and consumer sessions',async()=>{
 const deleted=[],tenant={id:'site',name:'站点',enabled:true,version:1,applications:[],_count:{adminScopes:1}};
 const db={$transaction:fn=>fn(db),$queryRaw:async()=>[],adminAccount:{findUnique:async()=>({enabled:true,role:{portal:'admin',enabled:true,permissions:session.permissions}})},tenant:{findUnique:async()=>tenant,updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>tenant},tenantApplication:{findFirst:async()=>null},adminTenantScope:{findMany:async()=>[{adminId:'owner'}]},adminSession:{deleteMany:async value=>deleted.push({kind:'console',...value})},session:{deleteMany:async value=>deleted.push({kind:'consumer',...value})},audit:{create:async()=>{}}};
 const service=new TenantManagement(db,()=>Buffer.alloc(32));
 await service.editTenant(session,'site',{name:'站点',enabled:true,version:1,expiresAt:'2000-01-01T00:00:00Z'});
 assert.deepEqual(deleted,[{kind:'consumer',where:{tenantId:'site'}}]);deleted.length=0;
 await service.editTenant(session,'site',{name:'站点',enabled:false,version:1});
 assert.deepEqual(deleted,[{kind:'console',where:{adminId:{in:['owner']}}},{kind:'consumer',where:{tenantId:'site'}}]);
});
test('tenant ID filters report their own length rule instead of the account-creation identifier policy',async()=>{
 const service=new TenantManagement({},()=>Buffer.alloc(32));
 await assert.rejects(service.accounts({...session,permissions:['accounts.read']},{tenantId:'x'.repeat(65)}),/租户编号筛选最多 64 个字符/);
});
test('account validation names the failing field and keeps the existing account, password and optional phone rules',async()=>{
 const service=new TenantManagement({},()=>Buffer.alloc(32));
 for(const [input,message] of [
  [{username:'中文账号'},/登录账号须为 3–32/],
  [{username:'_bad'},/以英文字母或数字开头/],
  [{password:'12345'},/密码须为 6–128/],
  [{password:'x'.repeat(129)},/密码须为 6–128/],
  [{nickname:''},/名称须为 1–32/],
  [{phone:'abc'},/手机号最多 32/]
 ])await assert.rejects(service.createAccount(session,{...valid,...input}),e=>e.code==='FORM_INVALID'&&message.test(e.message));
 await assert.rejects(service.createTenant(session,{requestId:valid.requestId,name:'测试租户',administrator:{username:'中文账号',nickname:'中文名称',password:'test12'}}),/初始管理员：登录账号/);
 await assert.rejects(service.editAccount(session,'test',{password:'12345',version:1},true),/密码须为 6–128/);
 // Stop after validation/hash preparation: no database or production account is used.
 let parsed;
 service.provision=async(_s,input)=>{parsed=input;return 'validated'};
 service.db.adminAccount={findUniqueOrThrow:async()=>({id:'validated'})};
 for(const password of ['test12','x'.repeat(128)]){
  assert.equal((await service.createAccount(session,{...valid,username:'Test-User',password})).id,'validated');
  assert.equal(parsed.username,'test-user');assert.equal(parsed.nickname,'中文名称');assert.equal(parsed.phone,'');assert.equal(parsed.password,password);
 }
});
