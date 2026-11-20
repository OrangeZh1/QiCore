import {maintenanceCatalog,isMaintenanceGrant,ownerGrants} from './standalone-maintenance.mjs';
import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,createHmac} from 'node:crypto';
import {z} from 'zod';
import {TenantSiteSettings} from './tenant-site-settings.mjs';
import {application,applicationCatalog,hasApplicationPermission} from '../applications/registry.mjs';
import {frameworkKey,frameworkGrant} from '../applications/framework.mjs';
import {passwordHash} from './admin-auth.mjs';
import {fail} from './errors.mjs';

const text=max=>z.string().trim().max(max).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符');
const id=z.string().min(1).max(64),version=z.number().int().positive();
const roleFields={name:text(50).min(1),permissions:z.array(z.string().max(100)).max(200).transform(v=>[...new Set(v)].sort()),enabled:z.boolean()};
const query=z.object({q:text(100).default(''),status:z.enum(['all','enabled','disabled']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50,100].includes(v),'须为 10、20、50 或 100').default(20)}).strict();
const memberFields={roleId:id,enabled:z.boolean()};
const accountFields={nickname:text(32).min(1),phone:z.string().trim().max(32).regex(/^[0-9+() -]*$/,'只能包含数字、+、括号、空格和短横线，可留空'),allowMultipleSessions:z.boolean()};
const createMember=z.object({...memberFields,...accountFields,username:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/,'须为 3–32 个英文字母、数字、下划线、点或短横线，以字母或数字开头'),password:z.string().min(6).max(128),requestId:z.string().uuid()}).strict();
const editMember=z.object({...memberFields,version,accountVersion:version,...Object.fromEntries(Object.entries(accountFields).map(([key,value])=>[key,value.optional()]))}).strict();
const roleSelect={id:true,tenantId:true,name:true,permissions:true,enabled:true,version:true,createdAt:true,_count:{select:{members:true}}};
const memberInclude={permissionRole:true,admin:{include:{role:true,scopes:{include:{permissionRole:true}}}}};
const coreCatalog=[['素材管理','materials','素材库'],['系统设置','settings','站点设置'],['系统设置','clientSettings','客户端公共设置'],['用户管理','consumers','公共用户'],['用户管理','entitlements','公共资产'],['权限管理','accounts','管理员'],['权限管理','roles','角色']].flatMap(([group,key,label])=>[{group,key:`tenant:${key}.read`,label:'查看'+label},{group,key:`tenant:${key}.write`,label:'管理'+label}]).concat([{group:'交易管理',key:'tenant:orders.read',label:'查看公共交易'},{group:'交易管理',key:'tenant:orders.manage',label:'管理公共交易'}]);
function parse(schema,value){const parsed=schema.safeParse(value);if(!parsed.success)fail('TENANT_PERMISSION_INPUT_INVALID',formValidationMessage(parsed.error,{name:'角色名称'}));return parsed.data}
const covers=(grants,key)=>key.startsWith('tenant:plugins.')?hasApplicationPermission(grants,frameworkKey,key.slice(7)):key.startsWith('tenant:')?grants.includes(key):applicationCatalog().some(app=>key.startsWith(app.key+':')?hasApplicationPermission(grants,app.key,key.slice(app.key.length+1)):application(app.key).legacyGrants===true&&hasApplicationPermission(grants,app.key,key));
export class TenantPermissions {
 constructor(db,fingerprintKey){this.db=db;this.key=fingerprintKey;this.sites=new TenantSiteSettings(db)}
 async context(db,s,tenantId,permission,lock=false){const ctx=await this.sites.authorize(db,s,tenantId,'tenant:'+permission,lock);ctx.actor.role={...ctx.actor.role,permissions:ownerGrants(s.id,ctx.tenant.ownerAdminId,ctx.actor.role.permissions)};return ctx}
 async catalog(db,tenantId,grants,owner=false){
  const opened=await db.tenantApplication.findMany({where:{tenantId,activeSlot:1,enabled:true,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{applicationKey:true}});
  const apps=applicationCatalog().filter(app=>opened.some(row=>row.applicationKey===app.key)),system=application(frameworkKey);
  const publicPlugins=apps.some(app=>this.sites.apps.licenseAllowed(app.key))?[]:Object.entries(system.permissionLabels||{}).filter(([key])=>key.startsWith('plugins.')).map(([key,label])=>({group:system.pluginPermissions?.find(item=>key.startsWith(item.prefix))?.name||system.name,key:frameworkGrant(key),label}));
  return [...coreCatalog,...maintenanceCatalog,...publicPlugins,...apps.flatMap(app=>{const definition=application(app.key);return Object.entries(definition.permissionLabels||{}).map(([key,label])=>({group:definition.pluginPermissions?.find(item=>key.startsWith(item.prefix))?.name||app.name,key:app.key+':'+key,label}))})].map(p=>({...p,grantable:(!isMaintenanceGrant(p.key)||owner)&&covers(grants,p.key)}));
 }
 ceiling(grants,permissions){if(permissions.some(key=>!covers(grants,key)))fail('TENANT_GRANT_FORBIDDEN','不能管理或授予超出自身范围的权限',403)}
 async audit(db,s,tenantId,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,actor:s.impersonatedBy||s.id,action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
 async revoke(db,ids){await db.adminSession.deleteMany({where:{adminId:{in:ids}}});await db.adminDelegation.deleteMany({where:{targetAdminId:{in:ids}}})}
 async transaction(fn){try{return await this.sites.apps.transaction(fn)}catch(e){if(e.code==='P2002')fail('TENANT_PERMISSION_CONFLICT','角色名称或登录账号已存在，请刷新后重试',409);throw e}}
 async provision(db,s,tenantId,kind,input,fn){
  const payloadHash=createHmac('sha256',this.key()).update(JSON.stringify({tenantId,...input})).digest('hex'),where={actorId_requestId:{actorId:s.id,requestId:input.requestId}},old=await db.adminProvisionRequest.findUnique({where});
  if(old){if(old.kind!==kind||old.payloadHash!==payloadHash)fail('REQUEST_CONFLICT','请求内容已改变，请重新打开表单',409);return old.resultId}
  const resultId=await fn();await db.adminProvisionRequest.create({data:{actorId:s.id,requestId:input.requestId,kind,payloadHash,resultId}});return resultId;
 }
 async roles(s,tenantId,input={},directory=false){
  const permission=directory?'accounts.write':'roles.read',q=parse(query,input),{actor}=await this.context(this.db,s,tenantId,permission),where={tenantId,...(q.q?{name:{contains:q.q}}:{}),...(directory?{enabled:true}:q.status==='all'?{}:{enabled:q.status==='enabled'})};
  const [items,total]=await this.db.$transaction([this.db.tenantRole.findMany({where,select:roleSelect,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.tenantRole.count({where})]);
  const current=await this.context(this.db,s,tenantId,permission),grants=current.actor.role.permissions,own=current.actor.scopes.find(row=>row.tenantId===tenantId)?.permissionRoleId;
  return{items:items.map(row=>({...row,userCount:row._count.members,editable:grants.includes('tenant:roles.write')&&row.id!==own&&(current.tenant.ownerAdminId===s.id||!row.permissions.some(isMaintenanceGrant))&&row.permissions.every(key=>covers(grants,key)),assignable:row.enabled&&(current.tenant.ownerAdminId===s.id||!row.permissions.some(isMaintenanceGrant))&&row.permissions.every(key=>covers(grants,key))})),total,page:q.page,pageSize:q.pageSize,canWrite:grants.includes('tenant:roles.write'),catalog:directory?[]:await this.catalog(this.db,tenantId,grants,current.tenant.ownerAdminId===s.id)};
 }
 async saveRole(s,tenantId,roleId,body){
  const input=parse(z.object({...roleFields,...(roleId?{version}:{requestId:z.string().uuid()})}).strict(),body);
  return this.transaction(async db=>{
   const {actor,tenant}=await this.context(db,s,tenantId,'roles.write',true),grants=actor.role.permissions,catalog=await this.catalog(db,tenantId,grants,tenant.ownerAdminId===s.id),before=roleId?await this.roleTarget(db,s,tenantId,roleId,grants,actor):null;
   if(tenant.ownerAdminId!==s.id&&(input.permissions.some(isMaintenanceGrant)||before?.permissions.some(isMaintenanceGrant)))fail('TENANT_GRANT_FORBIDDEN','只有站点负责人可分配维护权限',403);
   for(const key of input.permissions.filter(isMaintenanceGrant)){
    const read=key.replace(/\.[^.]+$/,'.read');if(!input.permissions.includes(read))fail('TENANT_PERMISSION_INPUT_INVALID','维护操作须同时勾选查看权限');
   }
   if(input.permissions.some(key=>!catalog.some(item=>item.key===key)&&!before?.permissions.includes(key)))fail('TENANT_PERMISSION_INPUT_INVALID','权限不存在或所属应用未开通');
   this.ceiling(grants,input.permissions);
   for(const key of input.permissions){const read=key.replace(/\.(write|manage)$/ ,'.read');if(read!==key&&catalog.some(p=>p.key===read)&&!input.permissions.includes(read))fail('TENANT_PERMISSION_INPUT_INVALID','管理权限必须同时勾选对应查看权限')}
   if(!roleId){const newId=await this.provision(db,s,tenantId,'tenant.role.create',input,async()=>{const row=await db.tenantRole.create({data:{id:randomUUID(),tenantId,name:input.name,permissions:input.permissions,enabled:input.enabled}});await this.audit(db,s,tenantId,'tenant.role.create',{roleId:row.id,name:row.name,permissions:row.permissions,enabled:row.enabled});return row.id});const row=await db.tenantRole.findFirst({where:{id:newId,tenantId},select:roleSelect});if(!row)fail('REQUEST_CONFLICT','原请求已完成，该角色已被删除，请重新读取',409);return row}
   const changed=await db.tenantRole.updateMany({where:{id:roleId,tenantId,version:input.version},data:{name:input.name,permissions:input.permissions,enabled:input.enabled,version:{increment:1}}});
   if(!changed.count)fail('TENANT_ROLE_CONFLICT','角色已变更，请刷新后重试',409);
   const members=await db.adminTenantScope.findMany({where:{tenantId,permissionRoleId:roleId},select:{adminId:true}});await this.revoke(db,members.map(row=>row.adminId));
   await this.audit(db,s,tenantId,'tenant.role.edit',{roleId,before:{name:before.name,permissions:before.permissions,enabled:before.enabled},after:input});return db.tenantRole.findUniqueOrThrow({where:{id:roleId},select:roleSelect});
  });
 }
 async roleTarget(db,s,tenantId,roleId,grants,actor){
  const row=await db.tenantRole.findFirst({where:{id:roleId,tenantId}});if(!row)fail('NOT_FOUND','角色不存在',404);
  if(actor.scopes.some(scope=>scope.tenantId===tenantId&&scope.permissionRoleId===roleId))fail('TENANT_ROLE_PROTECTED','不能修改自己当前使用的角色',403);
  if(row.permissions.some(isMaintenanceGrant)&&(await db.tenant.findUnique({where:{id:tenantId},select:{ownerAdminId:true}}))?.ownerAdminId!==s.id)fail('TENANT_GRANT_FORBIDDEN','只有站点负责人可更改维护角色',403);
  this.ceiling(grants,row.permissions);return row;
 }
 async removeRole(s,tenantId,roleId,body){const input=parse(z.object({version}).strict(),body);return this.transaction(async db=>{
  const {actor}=await this.context(db,s,tenantId,'roles.write',true);await this.roleTarget(db,s,tenantId,roleId,actor.role.permissions,actor);
  if(await db.adminTenantScope.count({where:{permissionRoleId:roleId}}))fail('TENANT_ROLE_IN_USE','角色仍有关联管理员，请先调整管理员角色',409);
  const removed=await db.tenantRole.deleteMany({where:{id:roleId,tenantId,version:input.version}});if(!removed.count)fail('TENANT_ROLE_CONFLICT','角色已变更，请刷新后重试',409);
  await this.audit(db,s,tenantId,'tenant.role.delete',{roleId});return{deleted:true};
 })}
 memberView(row,tenant,actor,s){
  const account=row.admin,owner=tenant.ownerAdminId===account.id,permissions=row.permissionRole?.permissions??account.role.permissions,editable=account.id!==s.id&&!owner&&actor.role.permissions.includes('tenant:accounts.write')&&(!permissions.some(isMaintenanceGrant)||s.id===tenant.ownerAdminId)&&permissions.every(key=>covers(actor.role.permissions,key));
  return{id:account.id,username:account.username,nickname:account.nickname,avatar:account.avatar,phone:account.phone,allowMultipleSessions:account.allowMultipleSessions,createdAt:account.createdAt,accountEnabled:account.enabled,enabled:row.enabled,version:row.version,accountVersion:account.version,roleId:row.permissionRoleId,role:{name:row.permissionRole?.name||account.role.name,enabled:row.permissionRole?.enabled??account.role.enabled},owner,editable,accountEditable:editable&&account.role.systemCode==='tenant-staff'&&account.scopes.length===1};
 }
 async members(s,tenantId,input={}){
  const q=parse(query,input);await this.context(this.db,s,tenantId,'accounts.read');
  const where={tenantId,admin:{deletedAt:null,role:{portal:'tenant'},...(q.q?{OR:[{username:{contains:q.q}},{nickname:{contains:q.q}},{phone:{contains:q.q}}]}:{})},...(q.status==='all'?{}:{enabled:q.status==='enabled'})};
  const [items,total]=await this.db.$transaction([this.db.adminTenantScope.findMany({where,include:memberInclude,orderBy:{adminId:'asc'},skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.adminTenantScope.count({where})]);
  const {tenant,actor}=await this.context(this.db,s,tenantId,'accounts.read');return{items:items.map(row=>this.memberView(row,tenant,actor,s)),total,page:q.page,pageSize:q.pageSize,canWrite:actor.role.permissions.includes('tenant:accounts.write')};
 }
 async assignable(db,tenantId,roleId,grants,actorId){const role=await db.tenantRole.findFirst({where:{id:roleId,tenantId,enabled:true}});if(!role)fail('TENANT_ROLE_UNAVAILABLE','请选择本站已启用的角色',409);if(role.permissions.some(isMaintenanceGrant)&&(await db.tenant.findUnique({where:{id:tenantId},select:{ownerAdminId:true}}))?.ownerAdminId!==actorId)fail('TENANT_GRANT_FORBIDDEN','只有站点负责人可分配维护角色',403);this.ceiling(grants,role.permissions);return role}
 async createMember(s,tenantId,body){
  const input=parse(createMember,body);await this.context(this.db,s,tenantId,'accounts.write');const encrypted=await passwordHash(input.password);
  return this.transaction(async db=>{
   const {tenant,actor}=await this.context(db,s,tenantId,'accounts.write',true);await this.assignable(db,tenantId,input.roleId,actor.role.permissions,s.id);
   const accountId=await this.provision(db,s,tenantId,'tenant.member.create',input,async()=>{
    if(await db.adminAccount.count({where:{username:input.username}}))fail('ACCOUNT_EXISTS','登录账号已存在，请使用其他账号',409);
    const base=await db.adminRole.upsert({where:{systemCode:'tenant-staff'},update:{},create:{id:randomUUID(),name:'租户工作人员',portal:'tenant',systemCode:'tenant-staff',permissions:[]}});
    if(base.portal!=='tenant'||!base.enabled||base.permissions.length)fail('TENANT_ROLE_UNAVAILABLE','工作人员基础角色不可用',409);
    const account=await db.adminAccount.create({data:{id:randomUUID(),username:input.username,nickname:input.nickname,phone:input.phone,allowMultipleSessions:input.allowMultipleSessions,passwordHash:encrypted,roleId:base.id,scopes:{create:{tenantId,permissionRoleId:input.roleId,enabled:input.enabled}}}});
    await this.audit(db,s,tenantId,'tenant.member.create',{adminId:account.id,roleId:input.roleId,enabled:input.enabled});return account.id;
   });
   const row=await db.adminTenantScope.findUnique({where:{adminId_tenantId:{adminId:accountId,tenantId}},include:memberInclude});if(!row)fail('REQUEST_CONFLICT','原请求已完成，该管理员已被移除，请重新读取',409);return this.memberView(row,tenant,actor,s);
  });
 }
 async changeMember(s,tenantId,adminId,body,mode='edit'){
  const input=parse(mode==='edit'?editMember:mode==='password'?z.object({version,accountVersion:version,password:z.string().min(6).max(128)}).strict():z.object({version}).strict(),body);
  await this.context(this.db,s,tenantId,'accounts.write');const encrypted=mode==='password'?await passwordHash(input.password):null;
  return this.transaction(async db=>{
   const {tenant,actor}=await this.context(db,s,tenantId,'accounts.write',true);
   await db.$queryRaw`SELECT id FROM AdminAccount WHERE id=${adminId} FOR UPDATE`;
   const where={adminId_tenantId:{adminId,tenantId}},row=await db.adminTenantScope.findUnique({where,include:memberInclude});if(!row||row.admin.deletedAt||row.admin.role.portal!=='tenant')fail('NOT_FOUND','管理员不存在',404);
   const view=this.memberView(row,tenant,actor,s);if(!view.editable)fail('TENANT_MEMBER_PROTECTED','不能修改负责人、本人或权限超出自身范围的管理员',403);
   if(row.version!==input.version)fail('TENANT_MEMBER_CONFLICT','管理员已变更，请刷新后重试',409);
   if(mode==='remove'){await db.adminTenantScope.delete({where})}
   else {
    if(row.admin.version!==input.accountVersion)fail('TENANT_MEMBER_CONFLICT','账号已变更，请刷新后重试',409);
    if(mode==='password'||Object.keys(accountFields).some(key=>key in input)){
     if(!view.accountEditable)fail('TENANT_ACCOUNT_PROTECTED','共享账号的资料与密码由账号本人或平台管理',403);
     await db.adminAccount.update({where:{id:adminId},data:encrypted?{passwordHash:encrypted,version:{increment:1}}:{...Object.fromEntries(Object.keys(accountFields).filter(key=>key in input).map(key=>[key,input[key]])),version:{increment:1}}});
    }
    if(mode==='edit')await this.assignable(db,tenantId,input.roleId,actor.role.permissions,s.id);
    await db.adminTenantScope.update({where,data:{...(mode==='edit'?{permissionRoleId:input.roleId,enabled:input.enabled}:{}),version:{increment:1}}});
   }
   await this.revoke(db,[adminId]);await this.audit(db,s,tenantId,'tenant.member.'+mode,{adminId,...(mode==='edit'?{roleId:input.roleId,enabled:input.enabled}:{})});return{updated:true};
  });
 }
}
