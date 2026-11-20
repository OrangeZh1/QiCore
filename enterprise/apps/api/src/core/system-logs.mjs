import {needMaintenance,maintenanceAudit} from './standalone-maintenance.mjs';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {permissionCatalog} from './role-management.mjs';

export const logActions=[
  ['material.upload','上传素材','素材管理'],['material.select','选择素材','素材管理'],['material.rename','重命名素材','素材管理'],['material.move','移动素材','素材管理'],['material.delete.requested','请求删除素材','素材管理'],['material.delete','删除素材','素材管理'],['material.group.create','创建素材分组','素材管理'],['material.group.rename','重命名素材分组','素材管理'],['material.group.delete','删除素材分组','素材管理'],
  ['cache.clear','清理系统缓存','系统维护'],['task.create','创建定时任务','系统维护'],['task.edit','修改定时任务','系统维护'],['task.delete','删除定时任务','系统维护'],['task.execute','执行定时任务','系统维护'],
  ['admin.bootstrap','账号初始化','账号与登录'],['admin.login','账号登录','账号与登录'],['admin.demo-login','开发演示登录','账号与登录'],['admin.profile','修改个人资料','账号与登录'],['admin.password','修改本人密码','账号与登录'],
  ['tenant.create','创建租户','租户管理'],['tenant.edit','修改租户','租户管理'],['tenant.admin.create','创建 SaaS 用户','租户管理'],['tenant.admin.edit','修改 SaaS 用户','租户管理'],['tenant.admin.password-reset','重置 SaaS 用户密码','租户管理'],['tenant.admin.delete','删除 SaaS 用户','租户管理'],['tenant.impersonation.start','开始租户代登录','租户管理'],['tenant.impersonation.end','结束租户代登录','租户管理'],
  ['role.create','创建角色','权限管理'],['role.edit','修改角色','权限管理'],['platform.admin.create','创建管理员','权限管理'],['platform.admin.edit','修改管理员','权限管理'],['platform.admin.password-reset','重置管理员密码','权限管理'],
  ['site.asset.upload','上传站点图片','系统设置'],['site.settings.save','保存网站设置','系统设置'],['storage.config.save','保存存储配置','系统设置'],['storage.default.change','切换默认存储','系统设置'],['storage.connection.test','检测存储连接','系统设置'],
  ['backup.create','创建数据库备份','数据安全'],['backup.verify','校验备份','数据安全'],['backup.download','下载加密备份','数据安全'],['backup.delete.requested','请求删除备份','数据安全'],['backup.delete','删除备份','数据安全'],['backup.restore','还原数据库','数据安全'],['backup.restore.rollback','还原失败回退','数据安全'],['backup.restore.recovery','离线恢复数据库','数据安全'],
].map(([value,label,group])=>({value,label,group}));
const actionKeys=logActions.map(a=>a.value),date=z.union([z.literal(''),z.iso.date()]).default('');
export const logQuerySchema=z.object({actor:z.string().trim().max(100).default(''),action:z.enum(['all','other',...actionKeys]).default('all'),start:date,end:date,page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50,100].includes(v)).default(20)}).strict();
const idValue=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(v)?v:null;
const text=(v,max=128)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):null;
const providerNames={local:'本地存储',qiniu:'七牛云',oss:'阿里云 OSS',cos:'腾讯云 COS'};
const lookup=(map,key)=>typeof key==='string'&&Object.hasOwn(map,key)?map[key]:null;
const fieldNames={nickname:'昵称',avatar:'头像',phone:'手机号',roleId:'所属角色',enabled:'启用状态',allowMultipleSessions:'多处登录'};
const permissionNames=values=>Array.isArray(values)?values.filter(v=>typeof v==='string').flatMap(key=>{const p=permissionCatalog.find(p=>p.key===key);return p?[p.label]:[]}):[];
export function logDateRange(start,end){
  if(start&&end&&start>end)fail('LOG_QUERY_INVALID','开始日期不能晚于结束日期');
  return{...(start?{gte:new Date(start+'T00:00:00+08:00')} :{}),...(end?{lt:new Date(Date.parse(end+'T00:00:00+08:00')+86400000)}:{})};
}
export async function logWhere(db,q,s=null){
  const matches=q.actor?await db.adminAccount.findMany({where:{OR:[{username:{contains:q.actor}},{nickname:{contains:q.actor}}]},select:{id:true}}):[];
  return{...(s?.role==='tenant'?maintenanceAudit(s):{scope:'platform'}),...(q.actor?{OR:[{actor:{contains:q.actor}},{actor:{in:matches.map(u=>u.id)}}]}:{}),...(q.action==='all'?{}:{action:q.action==='other'?{notIn:actionKeys}:q.action}),...((q.start||q.end)?{createdAt:logDateRange(q.start,q.end)}:{})};
}
export function logCsvCell(value){
  let text=String(value??'').replace(/\r\n?/g,'\n');
  if(/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
// Never serialize raw audit JSON. Each action exposes only the fields actually recorded for it.
export function logFields(action,details){
  if(!actionKeys.includes(action))return{fields:[],changes:[]};
  const d=details&&typeof details==='object'&&!Array.isArray(details)?details:{},fields=[],changes=[];
  const add=(label,value)=>{if(typeof value==='string')fields.push({label,value})};
  const boolean=(label,value)=>{if(typeof value==='boolean')add(label,value?'是':'否')};
  const state=value=>typeof value==='boolean'?(value?'启用':'停用'):null;
  const roles=v=>({name:text(v?.name,50),enabled:state(v?.enabled),permissions:Array.isArray(v?.permissions)?permissionNames(v.permissions).join('、')||'未分配权限':null});
  if(action.startsWith('backup.')&&typeof d.backupId==='string'&&/^backup-[a-zA-Z0-9_-]{16,64}$/.test(d.backupId))add('备份编号',d.backupId);
  if(action==='cache.clear'||action.startsWith('task.')){add('任务名称',text(d.name,60));add('执行结果',({started:'执行中',completed:'完成',success:'成功',error:'失败',failed:'未完成'})[d.status]??null);if(Number.isSafeInteger(d.cleared))add('清理数量',String(d.cleared));if(Number.isSafeInteger(d.durationMs))add('耗时',d.durationMs+' ms');add('命令',text(d.command,64));add('规则',text(d.rule,100));add('任务状态',state(d.enabled))}
  if(action.startsWith('material.')){add('素材名称',text(d.name,180));add('素材编号',idValue(d.materialId));add('分组编号',idValue(d.groupId));if(Number.isSafeInteger(d.count))add('数量',String(d.count));add('来源',lookup(providerNames,d.provider))}
  if(action==='role.edit'){
    const before=roles(d.before),after=roles(d.after);
    for(const [key,label] of [['name','角色名称'],['enabled','角色状态'],['permissions','功能权限']])if(before[key]!==null||after[key]!==null)changes.push({label,before:before[key]??'未记录',after:after[key]??'未记录'});
  }else if(action==='role.create'){add('角色名称',text(d.name,50));add('角色状态',state(d.enabled));if(Array.isArray(d.permissions))add('功能权限',permissionNames(d.permissions).join('、')||'未分配权限')}
  if(['tenant.create','tenant.edit'].includes(action)){add('租户名称',text(d.name));add('租户状态',state(d.enabled))}
  if(action==='admin.bootstrap')add('登录账号',text(d.username,32));
  if(['admin.login','admin.demo-login'].includes(action)&&d.portal==='admin')add('登录入口','平台后台');
  if(['admin.profile','platform.admin.edit'].includes(action)&&Array.isArray(d.fields))add('修改字段',d.fields.flatMap(key=>typeof key==='string'&&Object.hasOwn(fieldNames,key)?[fieldNames[key]]:[]).join('、')||'未记录可展示字段');
  if(action.startsWith('platform.admin.')){add('记录的账号状态',state(d.enabled));add('原角色编号',idValue(d.previousRoleId));add('角色编号',idValue(d.roleId))}
  if(['admin.password','platform.admin.password-reset','platform.admin.edit'].includes(action))boolean('已撤销原会话',d.sessionsRevoked);
  if(action==='site.asset.upload')add('图片类型',({icon:'网站图标',logo:'网站 Logo',login:'登录页配图',avatar:'默认头像'})[d.kind]??null);
  if(action==='site.settings.save'&&Number.isSafeInteger(d.version)&&d.version>0)add('配置版本',String(d.version));
  if(action.startsWith('storage.'))add('存储服务',lookup(providerNames,d.provider)??null);
  if(action==='storage.config.save'){add('启用状态',state(d.enabled));boolean('凭据已更换',d.credentialsChanged)}
  if(action==='storage.connection.test'&&typeof d.passed==='boolean')add('检测结果',d.passed?'通过':'未通过');
  if(action.startsWith('tenant.impersonation.')){add('代登录用户编号',idValue(d.targetAdminId));if(typeof d.expiresAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(d.expiresAt)&&Number.isFinite(Date.parse(d.expiresAt)))add('代登录有效期（北京时间）',new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(d.expiresAt)))}
  return{fields,changes};
}
export class SystemLogs{
  constructor(db){this.db=db}
  allow(s,key='audit.read'){needMaintenance(s,key)}
  async present(rows,includeDetails=false){
    const userIds=new Set(rows.map(r=>r.actor)),tenantIds=new Set();
    for(const row of rows){if(row.tenantId!=='__platform__')tenantIds.add(row.tenantId);const target=idValue(row.details?.adminId);if(target)userIds.add(target)}
    const [users,tenants]=await Promise.all([this.db.adminAccount.findMany({where:{id:{in:[...userIds]}},select:{id:true,username:true,nickname:true,deletedAt:true}}),this.db.tenant.findMany({where:{id:{in:[...tenantIds]}},select:{id:true,name:true}})]);
    const accounts=new Map(users.map(u=>[u.id,u])),tenantMap=new Map(tenants.map(t=>[t.id,t]));
    return rows.map(row=>{
      const type=logActions.find(a=>a.value===row.action),action=type?.value||'',user=accounts.get(row.actor),d=row.details??{},targetUser=accounts.get(idValue(d.adminId)),tenant=tenantMap.get(row.tenantId);
      let target='平台',targetId=null;
      if(action.startsWith('tenant.admin.')||action.startsWith('platform.admin.')){targetId=idValue(d.adminId);target=targetUser?.nickname||targetUser?.username||'账号'}
      else if(action.startsWith('tenant.')){targetId=idValue(row.tenantId);target=tenant?.name||'租户'}
      else if(action.startsWith('role.')){targetId=idValue(d.roleId);target=text(d.name,50)||text(d.after?.name,50)||'角色'}
      else if(action.startsWith('storage.'))target=lookup(providerNames,d.provider)||'存储设置';
      else if(action.startsWith('site.'))target='网站设置';
      else if(action.startsWith('backup.')){target='数据库备份';targetId=typeof d.backupId==='string'&&/^backup-[a-zA-Z0-9_-]{16,64}$/.test(d.backupId)?d.backupId:null}
      else if(action.startsWith('admin.')){targetId=idValue(row.actor);target=user?.nickname||'本人账号'}
      return{id:row.id,action:type?.value??'other',actionLabel:type?.label??'其他操作',group:type?.group??'其他',createdAt:row.createdAt,actor:{id:row.actor,username:user?.username??null,name:user?.nickname??'历史账号',deleted:!!user?.deletedAt},target:{name:target,id:targetId},...(includeDetails?logFields(row.action,d):{})};
    });
  }
  async list(s,input){
    this.allow(s);const parsed=logQuerySchema.safeParse(input);if(!parsed.success)fail('LOG_QUERY_INVALID','请检查操作类型、日期及分页条件');const q=parsed.data,where=await logWhere(this.db,q,s);
    const [rows,total]=await this.db.$transaction([this.db.audit.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.audit.count({where})]);
    return{items:await this.present(rows),total,actions:[...logActions,{value:'other',label:'其他操作',group:'其他'}]};
  }
  async detail(s,id){this.allow(s);if(!idValue(id))fail('NOT_FOUND','日志不存在',404);const row=await this.db.audit.findFirst({where:{id,...(s.role==='tenant'?maintenanceAudit(s):{scope:'platform'})}});if(!row)fail('NOT_FOUND','日志不存在',404);return(await this.present([row],true))[0]}
  async export(s,input){
    this.allow(s,'audit.export');const parsed=logQuerySchema.omit({page:true,pageSize:true}).safeParse(input);if(!parsed.success)fail('LOG_QUERY_INVALID','请检查导出筛选条件');
    const rows=await this.db.audit.findMany({where:await logWhere(this.db,parsed.data,s),orderBy:[{createdAt:'desc'},{id:'desc'}],take:10001});
    if(rows.length>10000)fail('LOG_EXPORT_LIMIT','单次最多导出 10000 条日志，请缩小筛选范围');
    const items=await this.present(rows,true),formatTime=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
    const csv=[['日志编号','操作人','登录账号','操作人编号','操作类型','操作对象','对象编号','操作时间（北京时间）','记录内容']];
    for(const r of items)csv.push([r.id,r.actor.name,r.actor.username??'',r.actor.id,r.actionLabel,r.target.name,r.target.id??'',formatTime(r.createdAt),[...r.fields.map(f=>f.label+'：'+f.value),...r.changes.map(c=>c.label+'：'+c.before+' → '+c.after)].join('；')]);
    const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    return{filename:'系统日志_'+day+'.csv',content:'\uFEFF'+csv.map(row=>row.map(logCsvCell).join(',')).join('\r\n')+'\r\n',total:items.length};
  }
}
