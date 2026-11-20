import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,createHmac} from 'node:crypto';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {passwordHash} from './admin-auth.mjs';
import {normalizeAccountImage} from './account-image.mjs';
const fields={nickname:z.string().trim().min(1).max(32).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符'),avatar:z.string().max(120000).nullable().default(null),phone:z.string().trim().max(32).regex(/^[0-9+() -]*$/,'只能包含数字、+、括号、空格和短横线，可留空').default(''),roleId:z.string().min(1).max(64),enabled:z.boolean(),allowMultipleSessions:z.boolean()};
const password=z.string().min(6).max(128),version=z.number().int().positive();
const createSchema=z.object({...fields,username:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/,'须为 3–32 个英文字母、数字、下划线、点或短横线，以字母或数字开头'),password,requestId:z.string().uuid()}).strict();
const editSchema=z.object({...fields,version}).strict(),resetSchema=z.object({password,version}).strict(),statusSchema=z.object({enabled:z.boolean(),version}).strict();
const querySchema=z.object({q:z.string().trim().max(100).default(''),status:z.enum(['all','enabled','disabled']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50,100].includes(v),'须为 10、20、50 或 100').default(20)}).strict();
const select={id:true,username:true,nickname:true,avatar:true,phone:true,roleId:true,enabled:true,allowMultipleSessions:true,version:true,createdAt:true,role:{select:{id:true,name:true,systemCode:true,enabled:true,permissions:true}}};
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail('ADMIN_INPUT_INVALID',formValidationMessage(r.error));return r.data};
export class PlatformAdmins{
  constructor(db,fingerprintKey,storage=null){this.db=db;this.storage=storage;this.fingerprintKey=fingerprintKey}
  allow(s,p){if(!s?._admin||s.role!=='root'||!s.permissions.includes(p))fail('FORBIDDEN','没有平台管理员管理权限',403)}
  async transaction(fn){for(let attempt=0;attempt<4;attempt++)try{return await this.db.$transaction(fn,{isolationLevel:'Serializable',maxWait:10000,timeout:15000})}catch(e){if(['P2034','P2002'].includes(e.code)&&attempt<3)continue;if(e.code==='P2002')fail('ACCOUNT_EXISTS','登录账号已存在',409);throw e}}
  async actor(tx,s){
    const actor=await tx.adminAccount.findUnique({where:{id:s.id},include:{role:true}});
    if(!actor?.enabled||actor.deletedAt||actor.role.portal!=='admin'||!actor.role.enabled||!actor.role.permissions.includes('accounts.write'))fail('FORBIDDEN','管理员管理权限已失效',403);
    if(s.tokenHash&&!await tx.adminSession.findFirst({where:{tokenHash:s.tokenHash,adminId:s.id,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','会话已失效，请重新登录',401);
    return actor;
  }
  ceiling(permissions,role){if(role.permissions.some(p=>!permissions.includes(p)))fail('ADMIN_GRANT_FORBIDDEN','不能管理或分配权限高于自己的账号或角色',403)}
  async role(tx,id,actor){const role=await tx.adminRole.findUnique({where:{id}});if(!role||role.portal!=='admin'||!role.enabled||role.systemCode)fail('ROLE_UNAVAILABLE','请选择已启用的自定义平台角色',409);this.ceiling(actor.role.permissions,role);return role}
  output(row,s){const {permissions,...role}=row.role;return{...row,role,editable:s.permissions.includes('accounts.write')&&!role.systemCode&&!row.id.startsWith('dev-demo-')&&row.id!==s.id&&permissions.every(p=>s.permissions.includes(p))}}
  async list(s,input){
    this.allow(s,'accounts.read');const q=parse(querySchema,input),where={deletedAt:null,role:{portal:'admin'},...(q.q?{OR:[{username:{contains:q.q}},{nickname:{contains:q.q}},{phone:{contains:q.q}}]}:{}),...(q.status==='all'?{}:{enabled:q.status==='enabled'})};
    const [items,total]=await this.db.$transaction([this.db.adminAccount.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.adminAccount.count({where})]);return{items:items.map(r=>this.output(r,s)),total};
  }
  async directory(s,input){
    this.allow(s,'accounts.write');const q=parse(z.object({q:z.string().trim().max(100).default('')}).strict(),input);
    const roles=await this.db.adminRole.findMany({where:{portal:'admin',enabled:true,systemCode:null,...(q.q?{name:{contains:q.q}}:{})},select:{id:true,name:true,permissions:true},orderBy:[{name:'asc'},{id:'asc'}]});
    const allowed=roles.filter(r=>r.permissions.every(p=>s.permissions.includes(p)));return{items:allowed.slice(0,50).map(r=>({id:r.id,name:r.name})),total:allowed.length};
  }
  async create(s,body){
    this.allow(s,'accounts.write');const input=parse(createSchema,body),encrypted=await passwordHash(input.password),avatar=await normalizeAccountImage(input.avatar,{storage:this.storage}),payloadHash=createHmac('sha256',this.fingerprintKey()).update(JSON.stringify(input)).digest('hex');
    return this.transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM AdminRole WHERE id=${input.roleId} FOR UPDATE`;
      const actor=await this.actor(tx,s);await this.role(tx,input.roleId,actor);
      const key={actorId:s.id,requestId:input.requestId},old=await tx.adminProvisionRequest.findUnique({where:{actorId_requestId:key}});
      if(old){if(old.kind!=='platform.admin.create'||old.payloadHash!==payloadHash)fail('REQUEST_CONFLICT','请求内容已改变，请重新提交',409);const row=await tx.adminAccount.findUniqueOrThrow({where:{id:old.resultId},select});this.ceiling(actor.role.permissions,row.role);return this.output(row,s)}
      if(await tx.adminAccount.findUnique({where:{username:input.username}}))fail('ACCOUNT_EXISTS','登录账号已存在',409);
      const row=await tx.adminAccount.create({data:{id:randomUUID(),username:input.username,nickname:input.nickname,phone:input.phone,avatar,roleId:input.roleId,enabled:input.enabled,allowMultipleSessions:input.allowMultipleSessions,passwordHash:encrypted},select});
      await tx.adminProvisionRequest.create({data:{...key,kind:'platform.admin.create',payloadHash,resultId:row.id}});
      await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:'__platform__',actor:s.id,action:'platform.admin.create',details:{adminId:row.id,roleId:row.roleId,enabled:row.enabled}}});return this.output(row,s);
    });
  }
  async edit(s,id,body,kind='edit'){
    this.allow(s,'accounts.write');const input=parse(kind==='password'?resetSchema:kind==='status'?statusSchema:editSchema,body);
    const encrypted=kind==='password'?await passwordHash(input.password):undefined,avatar=kind==='edit'?await normalizeAccountImage(input.avatar,{storage:this.storage}):undefined;
    const reference=await this.db.adminAccount.findUnique({where:{id},select:{roleId:true}});
    return this.transaction(async tx=>{
      // Roles are locked before accounts, matching sign-in and role updates.
      for(const roleId of [...new Set([reference?.roleId,input.roleId].filter(Boolean))].sort())await tx.$queryRaw`SELECT id FROM AdminRole WHERE id=${roleId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM AdminAccount WHERE id=${id} FOR UPDATE`;
      const actor=await this.actor(tx,s),row=await tx.adminAccount.findUnique({where:{id},include:{role:true}});
      if(!row||row.deletedAt||row.role.portal!=='admin')fail('ACCOUNT_MISSING','平台管理员不存在',404);
      if(row.roleId!==reference?.roleId)fail('ACCOUNT_CONFLICT','账号角色已修改，请刷新后重试',409);
      if(row.role.systemCode||row.id.startsWith('dev-demo-'))fail('ADMIN_PROTECTED','内置管理员受保护，不允许在此修改',403);
      if(row.id===s.id)fail('ADMIN_SELF_PROTECTED','不能在管理员列表修改自己的账号，请使用个人资料',403);
      this.ceiling(actor.role.permissions,row.role);
      if(row.version!==input.version)fail('ACCOUNT_CONFLICT','账号已被修改，请刷新后重试',409);
      if(kind==='edit')await this.role(tx,input.roleId,actor);
      if(kind==='status'&&input.enabled&&!row.role.enabled)fail('ROLE_UNAVAILABLE','所属角色已停用，请先启用角色或修改角色',409);
      const data=kind==='password'?{passwordHash:encrypted}:kind==='status'?{enabled:input.enabled}:{nickname:input.nickname,phone:input.phone,avatar,roleId:input.roleId,enabled:input.enabled,allowMultipleSessions:input.allowMultipleSessions};
      const changed=await tx.adminAccount.updateMany({where:{id,version:input.version,deletedAt:null},data:{...data,version:{increment:1}}});if(!changed.count)fail('ACCOUNT_CONFLICT','账号已被修改，请刷新后重试',409);
      await tx.adminSession.deleteMany({where:{adminId:id}});await tx.adminDelegation.deleteMany({where:{targetAdminId:id}});
      await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:'__platform__',actor:s.id,action:kind==='password'?'platform.admin.password-reset':'platform.admin.edit',details:{adminId:id,previousRoleId:row.roleId,roleId:input.roleId??row.roleId,enabled:input.enabled??row.enabled,fields:Object.keys(data).filter(k=>k!=='passwordHash'&&k!=='avatar'),sessionsRevoked:true}}});
      return this.output(await tx.adminAccount.findUniqueOrThrow({where:{id},select}),s);
    });
  }
}
