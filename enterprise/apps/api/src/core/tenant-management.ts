import {createHmac,randomInt,randomUUID} from 'node:crypto';
import {domainToASCII} from 'node:url';
import {isIP} from 'node:net';
import {normalizeAccountImage} from './account-image.mjs';
import {z} from 'zod';
import type {PrismaClient,Prisma} from '@prisma/client';
import {fail} from './errors.mjs';
import {passwordHash,ensureTenantAdministratorRole} from './admin-auth.mjs';
import {canonicalJson} from '../license/contracts.js';
import {TenantApplications} from '../applications/service.mjs';
import {applicationCatalog} from '../applications/registry.mjs';
import {isRetryableTransactionError,waitForTransactionRetry} from './transaction-errors.mjs';

const tenantId=z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/);
const username=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/);
const nickname=z.string().trim().min(1).max(32),password=z.string().min(6).max(128);
const contact={name:z.string().trim().min(1).max(128),contactName:z.string().trim().max(64).default(''),contactPhone:z.string().trim().max(32).regex(/^[0-9+() -]*$/).default('')};
const image=z.string().max(120000).nullable();
const phone=z.string().trim().max(32).regex(/^[0-9+() -]*$/);
const domain=z.string().trim().max(253).transform(value=>value?domainToASCII(value.replace(/\.$/,'').toLowerCase()):null).refine(value=>value===null||value.length<=253&&!isIP(value)&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value));
const settings={logo:image.default(null),enabled:z.boolean().default(true),storageMode:z.enum(['platform','tenant']).default('platform'),remark:z.string().trim().max(1000).default(''),customDomain:domain.default(null),expiresAt:z.iso.datetime({offset:true}).nullable().default(null),ownerAdminId:z.string().min(1).max(64).optional()};
const account=z.object({username,nickname,password,avatar:image.default(null),phone:phone.default(''),allowMultipleSessions:z.boolean().default(true),enabled:z.boolean().default(true)}).strict();
const applicationKey=z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).nullable();
const createTenantSchema=z.object({requestId:z.string().uuid(),applicationKey:applicationKey.optional(),...contact,...settings,administrator:account.optional()}).strict();
const editTenantSchema=z.object({...contact,applicationKey:applicationKey.optional(),logo:image.optional(),storageMode:z.enum(['platform','tenant']).optional(),remark:z.string().trim().max(1000).optional(),customDomain:domain.optional(),expiresAt:z.iso.datetime({offset:true}).nullable().optional(),ownerAdminId:z.string().min(1).max(64).optional(),enabled:z.boolean(),version:z.number().int().positive()}).strict();
const createAccountSchema=account.extend({requestId:z.string().uuid(),tenantId:tenantId.optional()}).strict();
const editAccountSchema=z.object({nickname,avatar:image.optional(),phone:phone.optional(),allowMultipleSessions:z.boolean().optional(),enabled:z.boolean(),version:z.number().int().positive()}).strict();
const resetSchema=z.object({password,version:z.number().int().positive()}).strict();
const querySchema=z.object({q:z.string().trim().max(100).default(''),status:z.enum(['all','enabled','disabled']).default('all'),tenantId:z.string().max(64).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50,100].includes(v)).default(20)}).strict();
const tenantSelect={id:true,name:true,contactName:true,contactPhone:true,enabled:true,createdAt:true,version:true,logo:true,storageMode:true,remark:true,customDomain:true,expiresAt:true,ownerAdminId:true,applications:{where:{activeSlot:1},select:{applicationKey:true,enabled:true,expiresAt:true}},_count:{select:{adminScopes:true}}} as const;
const accountSelect={id:true,username:true,nickname:true,avatar:true,phone:true,allowMultipleSessions:true,enabled:true,version:true,createdAt:true,scopes:{select:{tenant:{select:{id:true,name:true,enabled:true,expiresAt:true}}}}} as const;
type Session={id:string;role:string;_admin?:boolean;permissions:string[];tokenHash?:string};
const fieldRules:Record<string,string>={
  username:'登录账号须为 3–32 个字符，以英文字母或数字开头，只能包含英文字母、数字、下划线、点和短横线',
  nickname:'名称须为 1–32 个字符',password:'密码须为 6–128 个字符',
  phone:'手机号最多 32 个字符，只能包含数字、+、括号、空格和短横线，可留空',
  contactPhone:'联系电话最多 32 个字符，只能包含数字、+、括号、空格和短横线，可留空',
  name:'租户名称须为 1–128 个字符',contactName:'联系人最多 64 个字符',
  tenantId:'租户编号须为 3–64 个小写字母、数字、下划线或短横线，以字母或数字开头',
  customDomain:'自定义域名须为有效域名，最多 253 个字符，不含协议、路径、端口或 IP 地址',
  expiresAt:'到期时间格式无效，请重新选择有效日期与时间，长期有效请留空',
  applicationKey:'应用标识须为 1–64 个小写字母、数字或短横线，以字母或数字开头',
  ownerAdminId:'负责人编号须为 1–64 个字符',avatar:'头像须为有效图片地址或图片内容，最多 120000 个字符',logo:'Logo 须为有效图片地址或图片内容，最多 120000 个字符',
  enabled:'启用状态须为是或否',allowMultipleSessions:'多处登录设置须为是或否',
  storageMode:'存储方式须选择平台存储或租户存储',remark:'备注最多 1000 个字符',
  requestId:'提交请求标识无效，请重新打开表单后提交',version:'记录版本须为正整数，请刷新后重试',
  q:'搜索内容最多 100 个字符',status:'账号状态须为全部、启用或停用',page:'页码须为 1–100000 的整数',pageSize:'每页条数须为 10、20、50 或 100',administrator:'初始管理员须为有效的账号信息'
};
function parse<T>(schema:z.ZodType<T>,value:unknown):T{
  const r=schema.safeParse(value);
  if(!r.success){const issue=r.error.issues[0]!,field=String(issue.path.at(-1)||''),rule=(schema as z.ZodType)===querySchema&&field==='tenantId'?'租户编号筛选最多 64 个字符':fieldRules[field];fail('FORM_INVALID',issue.code==='unrecognized_keys'?'提交内容包含不支持的表单字段':(issue.path[0]==='administrator'&&issue.path.length>1?'初始管理员：':'')+(rule||'提交内容须为有效的表单对象'))}
  return r.data!;
}
export class TenantManagement {
  constructor(readonly db:PrismaClient,readonly fingerprintKey:()=>Buffer,readonly storage:any=null){}
  protected nextTenantId(){return randomInt(36**5).toString(36).padStart(5,'0')}
  private tenantView(row:Prisma.TenantGetPayload<{select:typeof tenantSelect}>){
    const {applications,...tenant}=row,entry=applications.length===1?applications[0]:null;
    const registered=entry?applicationCatalog().find(app=>app.key===entry.applicationKey):null;
    return {...tenant,application:entry?{key:entry.applicationKey,name:registered?.name||'应用未加载',enabled:entry.enabled,expiresAt:entry.expiresAt}:null,applicationConflict:applications.length>1};
  }
  async applicationChoices(s:Session){this.allow(s,'tenants.write');await this.actor(this.db,s,['tenants.write']);return new TenantApplications(this.db).assignable()}
  private allow(s:Session,p:string){if(!s._admin||s.role!=='root'||!s.permissions.includes(p))fail('FORBIDDEN','需要平台管理权限',403)}
  private async actor(tx:Prisma.TransactionClient,s:Session,required:string[]){
    const actor=await tx.adminAccount.findUnique({where:{id:s.id},include:{role:true}}),grants=actor?.role.permissions;
    if(!actor?.enabled||actor.deletedAt||actor.role.portal!=='admin'||!actor.role.enabled||!Array.isArray(grants)||required.some(p=>!grants.includes(p)))fail('FORBIDDEN','平台管理权限已变更，请重新登录',403);
    if(s.tokenHash&&!await tx.adminSession.findFirst({where:{tokenHash:s.tokenHash,adminId:s.id,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','会话已失效，请重新登录',401);
  }
  private async transaction<T>(action:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    for(let attempt=0;attempt<4;attempt++)try{return await this.db.$transaction(action,{isolationLevel:'Serializable',maxWait:10000,timeout:15000})}catch(error:any){if(isRetryableTransactionError(error)&&attempt<3){await waitForTransactionRetry(attempt);continue}if(error.code==='P2002')fail('ACCOUNT_CONFLICT','租户编号、客户域名或登录账号已存在',409);throw error}throw Error('TRANSACTION_FAILED');
  }
  private async provision(s:Session,input:{requestId:string},kind:string,create:(tx:Prisma.TransactionClient)=>Promise<string>){
    const payloadHash=createHmac('sha256',this.fingerprintKey()).update(canonicalJson(input)).digest('hex');
    return this.transaction(async tx=>{
      await this.actor(tx,s,kind==='tenant.create'?['tenants.write','accounts.write']:['accounts.write']);
      const key={actorId:s.id,requestId:input.requestId},old=await tx.adminProvisionRequest.findUnique({where:{actorId_requestId:key}});
      if(old){if(old.kind!==kind||old.payloadHash!==payloadHash)fail('REQUEST_CONFLICT','请求内容已改变，请重新提交',409);return old.resultId}
      const resultId=await create(tx);await tx.adminProvisionRequest.create({data:{...key,kind,payloadHash,resultId}});return resultId;
    });
  }
  private audit(tx:Prisma.TransactionClient,s:Session,tenantId:string,action:string,details:Prisma.InputJsonObject){return tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId,actor:s.id,action,details}})}
  private async role(tx:Prisma.TransactionClient){
    const role=await ensureTenantAdministratorRole(tx);
    if(role.portal!=='tenant'||!role.enabled)fail('ROLE_UNAVAILABLE','租户管理员角色当前不可用',409);return role;
  }
  private async checkH5Domain(tx:Prisma.TransactionClient,value:string|null|undefined){
    if(value&&await tx.tenantH5Setting.findFirst({where:{entryUrl:'https://'+value},select:{tenantId:true}}))fail('DOMAIN_RESERVED','该域名已绑定 H5 站点',409);
  }
  private checkDomain(value:string|null){
    if(value&&value===new URL(process.env.ADMIN_ORIGIN||'http://127.0.0.1:3400').hostname)fail('DOMAIN_RESERVED','不能将平台管理域名绑定给租户');
  }
  private async owner(tx:Prisma.TransactionClient,id:string){
    const user=await tx.adminAccount.findFirst({where:{id,enabled:true,deletedAt:null,role:{portal:'tenant',enabled:true}}});
    if(!user)fail('OWNER_INVALID','请选择已启用的 SaaS 用户');return user;
  }
  async tenants(s:Session,input:unknown){
    this.allow(s,'tenants.read');const q=parse(querySchema,input),where={...(q.q?{OR:[{id:{contains:q.q}},{name:{contains:q.q}},{contactName:{contains:q.q}}]}:{}),...(q.status==='all'?{}:{enabled:q.status==='enabled'})};
    const [items,total]=await this.db.$transaction([this.db.tenant.findMany({where,select:tenantSelect,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.tenant.count({where})]);return{items:items.map(row=>this.tenantView(row)),total,page:q.page,pageSize:q.pageSize};
  }
  async createTenant(s:Session,body:unknown){
    this.allow(s,'tenants.write');const input=parse(createTenantSchema,body);if(input.administrator||input.ownerAdminId)this.allow(s,'accounts.write');
    if(input.administrator&&input.ownerAdminId)fail('OWNER_INVALID','请选择已有用户或创建初始管理员，不能同时提交');
    if(!input.administrator&&!input.ownerAdminId)fail('OWNER_REQUIRED','请选择关联的 SaaS 用户');
    this.checkDomain(input.customDomain);
    const logo=await normalizeAccountImage(input.logo,{storage:this.storage});
    const encrypted=input.administrator?await passwordHash(input.administrator.password):null;
    const id=await this.provision(s,input,'tenant.create',async tx=>{
      await this.checkH5Domain(tx,input.customDomain);
      if(input.ownerAdminId)await this.owner(tx,input.ownerAdminId);
      // Generated inside the transaction: a unique-key collision retries with a fresh ID,
      // while requestId replay returns the committed tenant without allocating another slot.
      const tenantId=this.nextTenantId();
      await tx.tenant.create({data:{id:tenantId,name:input.name,contactName:input.contactName,contactPhone:input.contactPhone,logo,enabled:input.enabled,storageMode:input.storageMode,remark:input.remark,customDomain:input.customDomain,expiresAt:input.expiresAt?new Date(input.expiresAt):null,ownerAdminId:input.ownerAdminId??null}});
      if(input.applicationKey)await new TenantApplications(this.db).bindTenant(tx,tenantId,input.applicationKey);
      if(input.ownerAdminId)await tx.adminTenantScope.create({data:{adminId:input.ownerAdminId,tenantId}});
      if(input.administrator){const role=await this.role(tx);if(await tx.adminAccount.findUnique({where:{username:input.administrator.username}}))fail('ACCOUNT_EXISTS','登录账号已存在',409);const admin=await tx.adminAccount.create({data:{id:randomUUID(),username:input.administrator.username,nickname:input.administrator.nickname,phone:input.administrator.phone,avatar:await normalizeAccountImage(input.administrator.avatar,{storage:this.storage}),allowMultipleSessions:input.administrator.allowMultipleSessions,enabled:input.administrator.enabled,passwordHash:encrypted!,roleId:role.id,scopes:{create:{tenantId}}}});await tx.tenant.update({where:{id:tenantId},data:{ownerAdminId:admin.id}});await this.audit(tx,s,tenantId,'tenant.admin.create',{adminId:admin.id})}
      await this.audit(tx,s,tenantId,'tenant.create',{name:input.name,applicationKey:input.applicationKey??null});return tenantId;
    });
    return this.tenantView(await this.db.tenant.findUniqueOrThrow({where:{id},select:tenantSelect}));
  }
  async editTenant(s:Session,id:string,body:unknown){
    this.allow(s,'tenants.write');const input=parse(editTenantSchema,body);if(input.ownerAdminId)this.allow(s,'accounts.write');if(input.customDomain!==undefined)this.checkDomain(input.customDomain);
    const logo=input.logo===undefined?undefined:await normalizeAccountImage(input.logo,{storage:this.storage});
    return this.transaction(async tx=>{
      await this.actor(tx,s,input.ownerAdminId?['tenants.write','accounts.write']:['tenants.write']);
      await this.checkH5Domain(tx,input.customDomain);
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${id} FOR UPDATE`;
      const before=await tx.tenant.findUnique({where:{id}});if(!before||before.version!==input.version)fail('TENANT_CONFLICT','租户已修改或不存在，请刷新后重试',409);
      const binding=await tx.tenantApplication.findFirst({where:{tenantId:id,activeSlot:1},select:{applicationKey:true}});
      const selected=input.applicationKey===undefined?binding?.applicationKey??null:input.applicationKey;
      if(input.applicationKey!==undefined)await new TenantApplications(this.db).selectTenant(tx,id,selected);
      if(input.ownerAdminId&&input.ownerAdminId!==before?.ownerAdminId){
        await this.owner(tx,input.ownerAdminId);
        await tx.adminTenantScope.upsert({where:{adminId_tenantId:{adminId:input.ownerAdminId,tenantId:id}},create:{adminId:input.ownerAdminId,tenantId:id},update:{}});
        if(before?.ownerAdminId){await tx.adminTenantScope.deleteMany({where:{adminId:before.ownerAdminId,tenantId:id}});await tx.adminSession.deleteMany({where:{adminId:before.ownerAdminId}})}
      }
      const changed=await tx.tenant.updateMany({where:{id,version:input.version},data:{name:input.name,contactName:input.contactName,contactPhone:input.contactPhone,enabled:input.enabled,logo,storageMode:input.storageMode,remark:input.remark,customDomain:input.customDomain,expiresAt:input.expiresAt===undefined?undefined:input.expiresAt?new Date(input.expiresAt):null,ownerAdminId:input.ownerAdminId,version:{increment:1}}});
      if(!changed.count)fail('TENANT_CONFLICT','租户已修改或不存在，请刷新后重试',409);
      if(!input.enabled){const accounts=await tx.adminTenantScope.findMany({where:{tenantId:id},select:{adminId:true}});await tx.adminSession.deleteMany({where:{adminId:{in:accounts.map(a=>a.adminId)}}})}
      if(!input.enabled||input.expiresAt&&Date.parse(input.expiresAt)<=Date.now())await tx.session.deleteMany({where:{tenantId:id}});
      await this.audit(tx,s,id,'tenant.edit',{enabled:input.enabled,applicationKey:selected,previousApplicationKey:binding?.applicationKey??null});return this.tenantView(await tx.tenant.findUniqueOrThrow({where:{id},select:tenantSelect}));
    });
  }
  async accounts(s:Session,input:unknown){
    this.allow(s,'accounts.read');const q=parse(querySchema,input),where={deletedAt:null,role:{portal:'tenant'},...(q.q?{OR:[{id:{contains:q.q}},{username:{contains:q.q}},{nickname:{contains:q.q}},{phone:{contains:q.q}}]}:{}),...(q.status==='all'?{}:{enabled:q.status==='enabled'}),...(q.tenantId?{scopes:{some:{tenantId:q.tenantId}}}:{})};
    const [items,total]=await this.db.$transaction([this.db.adminAccount.findMany({where,select:accountSelect,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.adminAccount.count({where})]);return{items,total,page:q.page,pageSize:q.pageSize};
  }
  async createAccount(s:Session,body:unknown){
    this.allow(s,'accounts.write');const input=parse(createAccountSchema,body),encrypted=await passwordHash(input.password);
    const id=await this.provision(s,input,'tenant.admin.create',async tx=>{
      if(input.tenantId){const tenant=await tx.tenant.findUnique({where:{id:input.tenantId}});if(!tenant?.enabled||tenant.expiresAt&&tenant.expiresAt.getTime()<=Date.now())fail('TENANT_UNAVAILABLE','请选择已启用且未到期的租户',409)}
      if(await tx.adminAccount.findUnique({where:{username:input.username}}))fail('ACCOUNT_EXISTS','登录账号已存在',409);
      const role=await this.role(tx),account=await tx.adminAccount.create({data:{id:randomUUID(),username:input.username,nickname:input.nickname,phone:input.phone,avatar:await normalizeAccountImage(input.avatar,{storage:this.storage}),allowMultipleSessions:input.allowMultipleSessions,enabled:input.enabled,passwordHash:encrypted,roleId:role.id,...(input.tenantId?{scopes:{create:{tenantId:input.tenantId}}}:{})}});
      await this.audit(tx,s,input.tenantId??'__platform__','tenant.admin.create',{adminId:account.id});return account.id;
    });return this.db.adminAccount.findUniqueOrThrow({where:{id},select:accountSelect});
  }
  async editAccount(s:Session,id:string,body:unknown,reset=false){
    this.allow(s,'accounts.write');const input=reset?parse(resetSchema,body):parse(editAccountSchema,body),encrypted='password' in input?await passwordHash(input.password):null;
    return this.transaction(async tx=>{
      await this.actor(tx,s,['accounts.write']);
      const before=await tx.adminAccount.findFirst({where:{id,deletedAt:null,role:{portal:'tenant'}},select:accountSelect});if(!before)fail('ACCOUNT_MISSING','租户管理员不存在',404);
      const edit=input as z.infer<typeof editAccountSchema>;
      const data=encrypted?{passwordHash:encrypted,version:{increment:1}}:{nickname:edit.nickname,enabled:edit.enabled,phone:edit.phone,avatar:edit.avatar===undefined?undefined:await normalizeAccountImage(edit.avatar,{storage:this.storage}),allowMultipleSessions:edit.allowMultipleSessions,version:{increment:1}};
      const changed=await tx.adminAccount.updateMany({where:{id,deletedAt:null,version:input.version,role:{portal:'tenant'}},data});if(!changed.count)fail('ACCOUNT_CONFLICT','账号已被修改，请刷新后重试',409);
      await tx.adminSession.deleteMany({where:{adminId:id}});await tx.adminDelegation.deleteMany({where:{targetAdminId:id}});
      await this.audit(tx,s,before!.scopes[0]?.tenant.id??'__platform__',reset?'tenant.admin.password-reset':'tenant.admin.edit',{adminId:id});
      return tx.adminAccount.findUniqueOrThrow({where:{id},select:accountSelect});
    });
  }
  async deleteAccount(s:Session,id:string,body:unknown){
    this.allow(s,'accounts.write');const input=parse(z.object({version:z.number().int().positive()}).strict(),body);
    return this.transaction(async tx=>{
      await this.actor(tx,s,['accounts.write']);
      const user=await tx.adminAccount.findFirst({where:{id,role:{portal:'tenant'}},select:{id:true,deletedAt:true,version:true}});
      if(!user)fail('ACCOUNT_MISSING','SaaS用户不存在',404);
      if(user!.deletedAt)return{deleted:true};
      if(await tx.tenant.count({where:{ownerAdminId:id}}))fail('ACCOUNT_IN_USE','用户仍是租户负责人，请先更换负责人',409);
      const changed=await tx.adminAccount.updateMany({where:{id,version:input.version,deletedAt:null,role:{portal:'tenant'}},data:{deletedAt:new Date(),enabled:false,version:{increment:1}}});
      if(!changed.count)fail('ACCOUNT_CONFLICT','用户已修改，请刷新后重试',409);
      await tx.adminTenantScope.deleteMany({where:{adminId:id}});
      await tx.adminSession.deleteMany({where:{adminId:id}});await tx.adminDelegation.deleteMany({where:{targetAdminId:id}});await this.audit(tx,s,'__platform__','tenant.admin.delete',{adminId:id});return{deleted:true};
    });
  }
}
