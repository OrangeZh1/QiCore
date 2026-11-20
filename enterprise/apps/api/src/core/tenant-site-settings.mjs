import {formValidationMessage} from './form-validation.mjs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {normalizeSiteImage} from './site-settings.mjs';
import {fail} from './errors.mjs';

const text=max=>z.string().trim().max(max).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符');
const image=z.string().max(120000).refine(v=>/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v)||v.startsWith('https://')||/^\/api\/v1\/public\/site-assets\/[a-f0-9-]{36}$/.test(v),'须选择已上传的 PNG、JPEG 或 WebP 图片').nullable();
const link=z.string().trim().max(2048).refine(v=>{if(!v)return true;try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}},'须为 HTTP 或 HTTPS 链接，不能包含账号或密码，可留空');
const configSchema=z.object({name:text(30).min(1),logo:image,favicon:image,defaultAvatar:image,copyright:text(160),filing:z.object({icpNumber:text(80),icpLink:link,policeNumber:text(80),policeLink:link}).strict()}).strict();
const input=z.object({version:z.number().int().nonnegative(),config:configSchema}).strict();

export class TenantSiteSettings {
 constructor(db,storage=null){this.db=db;this.storage=storage;this.apps=new TenantApplications(db)}
 async authorize(db,s,tenantId,permission=null,lock=false){
  if(typeof tenantId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(tenantId))fail('TENANT_SITE_INVALID','站点标识无效');
  if(lock)await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;
  const actor=await this.apps.actor(db,s,'tenant',tenantId);
  if(!s.tenantIds?.includes(tenantId)||!actor.scopes.some(row=>row.tenantId===tenantId)||s.delegated&&s.tenantId!==tenantId)fail('FORBIDDEN','没有该站点的访问权限',403);
  if(permission&&(!s.permissions.includes(permission)||!actor.role.permissions.includes(permission)))fail('FORBIDDEN','没有站点设置权限',403);
  const tenant=await db.tenant.findUnique({where:{id:tenantId}});if(!tenant?.enabled||!s.delegated&&tenant.expiresAt&&tenant.expiresAt<=new Date())fail('TENANT_UNAVAILABLE','站点已停用或到期',403);
  return{tenant,actor};
 }
 async values(db,tenant){
  const [row,platform]=await Promise.all([
   db.tenantSiteSetting.findUnique({where:{tenantId:tenant.id}}),
   db.siteSetting.findUnique({where:{id:'platform'}})
  ]);if(!platform)fail('SITE_NOT_READY','网站设置尚未初始化',503);
  // Shared portal branding remains the fallback until this tenant saves its own settings.
  const defaults={name:platform.config.tenant.name,logo:null,favicon:null,defaultAvatar:null,copyright:platform.config.copyright,filing:platform.config.filing};
  return{row,platform,config:row?.config||defaults};
 }
 async brand(s,tenantId){
  const {tenant}=await this.authorize(this.db,s,tenantId),{row,platform,config}=await this.values(this.db,tenant);
  await this.authorize(this.db,s,tenantId);
  return{tenantId,version:row?.version||0,tenant:{...platform.config.tenant,name:config.name,logo:config.logo||platform.config.tenant.logo,favicon:config.favicon||platform.config.tenant.favicon,defaultAvatar:config.defaultAvatar||platform.config.tenant.defaultAvatar},copyright:config.copyright,filing:config.filing};
 }
 async view(s,tenantId){
  const {tenant}=await this.authorize(this.db,s,tenantId,'tenant:settings.read'),{row,platform,config}=await this.values(this.db,tenant);
  const {actor}=await this.authorize(this.db,s,tenantId,'tenant:settings.read');
  return{tenantId,version:row?.version||0,config,canWrite:s.permissions.includes('tenant:settings.write')&&actor.role.permissions.includes('tenant:settings.write'),inherited:!row,updatedAt:row?.updatedAt||null,fallbackImages:{logo:platform.config.tenant.logo||'/brand/qicore.png',favicon:platform.config.tenant.favicon||'/brand/qicore.png',defaultAvatar:platform.config.tenant.defaultAvatar||'/brand/admin-avatar.png'},managed:{name:tenant.name,customDomain:tenant.customDomain,expiresAt:tenant.expiresAt}};
 }
 async save(s,tenantId,value){
  const q=input.safeParse(value);if(!q.success)fail('TENANT_SITE_INPUT_INVALID',formValidationMessage(q.error,{name:'站点名称'}));
  await this.authorize(this.db,s,tenantId,'tenant:settings.write');
  await this.apps.transaction(async db=>{
   await this.authorize(db,s,tenantId,'tenant:settings.read',true);await this.authorize(db,s,tenantId,'tenant:settings.write');
   const old=await db.tenantSiteSetting.findUnique({where:{tenantId}});if((old?.version||0)!==q.data.version)fail('TENANT_SITE_CONFLICT','站点设置已更新，请重新读取后编辑',409);
   const config=structuredClone(q.data.config);
   for(const [field,kind] of [['logo','logo'],['favicon','icon'],['defaultAvatar','avatar']]){
    if(!config[field]||config[field]===old?.config[field])continue;
    if(this.storage&&!config[field].startsWith('data:')){config[field]=await this.storage.imageReference(config[field],tenantId);continue}
    const normalized=await normalizeSiteImage(kind,Buffer.from(config[field].split(',')[1],'base64'));config[field]=this.storage?await this.storage.saveImage(normalized.data,normalized.mime,{siteId:tenantId,kind}):'data:'+normalized.mime+';base64,'+normalized.data.toString('base64');
    if(config[field].length>120000)fail('TENANT_SITE_INPUT_INVALID','图片过大，请使用更小的图片');
   }
   await db.tenantSiteSetting.upsert({where:{tenantId},create:{tenantId,config,version:1},update:{config,version:q.data.version+1}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,actor:s.impersonatedBy||s.id,action:'tenant.site.save',details:{version:q.data.version+1,fields:['name','logo','favicon','defaultAvatar','copyright','filing'],...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId);
 }
}
