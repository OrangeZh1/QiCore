import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {platformPermissions} from './admin-auth.mjs';

export const permissionCatalog=[
  {group:'素材管理',key:'materials.read',label:'查看素材库'},{group:'素材管理',key:'materials.write',label:'上传与管理素材'},
  {group:'工作台',key:'overview.read',label:'查看工作台'},
  {group:'租户管理',key:'tenants.read',label:'查看租户'},{group:'租户管理',key:'tenants.write',label:'管理租户'},
  {group:'账号管理',key:'accounts.read',label:'查看账号'},{group:'账号管理',key:'accounts.write',label:'管理账号与租户代登录'},
  {group:'权限管理',key:'roles.read',label:'查看角色'},{group:'权限管理',key:'roles.write',label:'管理角色'},
  {group:'系统设置',key:'settings.read',label:'查看配置'},{group:'系统设置',key:'settings.write',label:'修改配置'},
  {group:'系统服务',key:'services.read',label:'查看授权、更新与环境'},{group:'系统服务',key:'services.update',label:'执行系统更新'},
  {group:'系统维护',key:'cache.read',label:'查看系统缓存'},{group:'系统维护',key:'cache.clear',label:'清理系统缓存'},{group:'系统维护',key:'tasks.read',label:'查看定时任务'},{group:'系统维护',key:'tasks.write',label:'管理定时任务'},
  {group:'数据安全',key:'backups.read',label:'查看与校验备份'},{group:'数据安全',key:'backups.create',label:'创建数据库备份'},{group:'数据安全',key:'backups.download',label:'下载加密备份'},{group:'数据安全',key:'backups.delete',label:'删除备份'},{group:'数据安全',key:'backups.restore',label:'还原数据库'},
  {group:'审计',key:'audit.read',label:'查看系统日志'},
];
const fields={name:z.string().trim().min(1).max(50).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符'),permissions:z.array(z.enum(platformPermissions)).max(platformPermissions.length).transform(v=>[...new Set(v)].sort()),enabled:z.boolean()};
const createSchema=z.object({...fields,requestId:z.string().uuid()}).strict(),editSchema=z.object({...fields,version:z.number().int().positive()}).strict();
const querySchema=z.object({q:z.string().trim().max(100).default(''),status:z.enum(['all','enabled','disabled']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50,100].includes(v),'须为 10、20、50 或 100').default(20)}).strict();
const select={id:true,name:true,permissions:true,systemCode:true,enabled:true,version:true,createdAt:true,_count:{select:{accounts:{where:{deletedAt:null}}}}};
function parse(schema,value){const r=schema.safeParse(value);if(!r.success)fail('ROLE_INPUT_INVALID',formValidationMessage(r.error,{name:'角色名称'}));return r.data}
export class RoleManagement{
  constructor(db){this.db=db}
  allow(s,p){if(!s?._admin||s.role!=='root'||!s.permissions.includes(p))fail('FORBIDDEN','没有平台角色管理权限',403)}
  async transaction(fn){for(let attempt=0;attempt<4;attempt++)try{return await this.db.$transaction(fn,{isolationLevel:'Serializable',maxWait:10000,timeout:15000})}catch(e){if(['P2034','P2002'].includes(e.code)&&attempt<3)continue;throw e}}
  async actor(tx,s){
    const actor=await tx.adminAccount.findUnique({where:{id:s.id},include:{role:true}});
    if(!actor?.enabled||actor.deletedAt||!actor.role.enabled||actor.role.portal!=='admin'||!actor.role.permissions.includes('roles.write'))fail('FORBIDDEN','角色管理权限已变更，请重新登录',403);
    if(s.tokenHash&&!await tx.adminSession.findFirst({where:{tokenHash:s.tokenHash,adminId:s.id,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','会话已失效，请重新登录',401);
    return actor;
  }
  grant(actor,permissions){if(permissions.some(p=>!actor.role.permissions.includes(p)))fail('ROLE_GRANT_FORBIDDEN','不能管理或授予超出自身范围的权限',403)}
  async list(s,input){
    this.allow(s,'roles.read');const q=parse(querySchema,input),where={portal:'admin',...(q.q?{name:{contains:q.q}}:{}),...(q.status==='all'?{}:{enabled:q.status==='enabled'})};
    const [items,total]=await this.db.$transaction([this.db.adminRole.findMany({where,select,orderBy:[{createdAt:'asc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.adminRole.count({where})]);
    const own=await this.db.adminAccount.findUnique({where:{id:s.id},select:{roleId:true}});
    return{items:items.map(r=>({...r,userCount:r._count.accounts,editable:!r.systemCode&&r.id!==own?.roleId&&s.permissions.includes('roles.write')&&r.permissions.every(p=>s.permissions.includes(p))})),total,catalog:permissionCatalog.map(p=>({...p,grantable:s.permissions.includes(p.key)}))};
  }
  async create(s,body){
    this.allow(s,'roles.write');const input=parse(createSchema,body),payloadHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(async tx=>{
      const actor=await this.actor(tx,s);this.grant(actor,input.permissions);
      const key={actorId:s.id,requestId:input.requestId},old=await tx.adminProvisionRequest.findUnique({where:{actorId_requestId:key}});
      if(old){if(old.kind!=='role.create'||old.payloadHash!==payloadHash)fail('REQUEST_CONFLICT','请求内容已改变，请重新提交',409);return tx.adminRole.findUniqueOrThrow({where:{id:old.resultId},select})}
      if(await tx.adminRole.findFirst({where:{portal:'admin',name:input.name}}))fail('ROLE_NAME_EXISTS','角色名称已存在',409);
      const row=await tx.adminRole.create({data:{id:randomUUID(),portal:'admin',name:input.name,permissions:input.permissions,enabled:input.enabled},select});
      await tx.adminProvisionRequest.create({data:{...key,kind:'role.create',payloadHash,resultId:row.id}});
      await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:'__platform__',actor:s.id,action:'role.create',details:{roleId:row.id,name:row.name,permissions:row.permissions,enabled:row.enabled}}});return row;
    });
  }
  async edit(s,id,body){
    this.allow(s,'roles.write');const input=parse(editSchema,body);
    return this.transaction(async tx=>{
      // Same role-first lock ordering as sign-in, so revocation cannot miss a concurrent new session.
      await tx.$queryRaw`SELECT id FROM AdminRole WHERE id=${id} FOR UPDATE`;
      const actor=await this.actor(tx,s),role=await tx.adminRole.findUnique({where:{id}});
      if(!role||role.portal!=='admin')fail('NOT_FOUND','角色不存在',404);
      if(role.systemCode)fail('ROLE_PROTECTED','内置角色不允许修改或停用',403);
      if(role.id===actor.roleId)fail('ROLE_SELF_PROTECTED','不能修改自己当前使用的角色',403);
      this.grant(actor,role.permissions);this.grant(actor,input.permissions);
      if(role.version!==input.version)fail('ROLE_CONFLICT','角色已被修改，请刷新后重试',409);
      if(await tx.adminRole.findFirst({where:{portal:'admin',name:input.name,id:{not:id}}}))fail('ROLE_NAME_EXISTS','角色名称已存在',409);
      const updated=await tx.adminRole.updateMany({where:{id,version:input.version},data:{name:input.name,permissions:input.permissions,enabled:input.enabled,version:{increment:1}}});
      if(!updated.count)fail('ROLE_CONFLICT','角色已被修改，请刷新后重试',409);
      await tx.adminSession.deleteMany({where:{admin:{roleId:id}}});
      await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:'__platform__',actor:s.id,action:'role.edit',details:{roleId:id,before:{name:role.name,permissions:role.permissions,enabled:role.enabled},after:{name:input.name,permissions:input.permissions,enabled:input.enabled}}}});
      return tx.adminRole.findUniqueOrThrow({where:{id},select});
    });
  }
}
