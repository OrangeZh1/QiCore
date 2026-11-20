import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {frameworkKey} from '../applications/framework.mjs';
import {systemBenefitCatalog,saveSystemBenefitCatalog} from './standalone-benefit-store.mjs';
import {normalizeAccountImage} from './account-image.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {fail} from './errors.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),version=z.number().int().positive(),key=z.string().min(1).max(64);
const query=z.object({applicationKey:key.optional(),q:z.string().trim().max(100).default(''),type:z.string().max(64).default('all'),status:z.enum(['all','enabled','disabled']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)}).strict();
function parse(schema,value){const p=schema.safeParse(value);if(!p.success)fail('PACKAGE_INPUT_INVALID','请检查套餐内容、筛选条件和版本');return p.data}
export class TenantPackages {
 constructor(db,storage=null){this.db=db;this.storage=storage;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,applicationKey){return this.apps.featureContext(db,s,tenantId,applicationKey,'packages','entitlements.read')}
 async list(s,tenantId,input){
  const q=parse(query,input),ctx=await this.context(this.db,s,tenantId,q.applicationKey);
  if(!ctx.selected)return{items:[],total:0,page:1,pageSize:q.pageSize,version:0,canWrite:false,applicationKey:null,applications:ctx.sources,catalog:null};
  const app=application(ctx.selected.key),row=await this.apps.admin(s,tenantId,app.key,'entitlements.read');
  const catalog=app.key===frameworkKey?await systemBenefitCatalog(this.db,tenantId,app.key):{config:row.config,version:row.configVersion};
  if(q.type!=='all'&&!app.packages.catalog.types.some(t=>t.key===q.type))fail('PACKAGE_INPUT_INVALID','套餐类型无效');
  const term=q.q.toLocaleLowerCase(),items=app.packages.items(catalog.config).filter(p=>(q.type==='all'||p.type===q.type)&&(q.status==='all'||p.enabled===(q.status==='enabled'))&&(!term||p.name.toLocaleLowerCase().includes(term))),page=Math.min(q.page,Math.max(1,Math.ceil(items.length/q.pageSize)));
  const current=await this.context(this.db,s,tenantId,app.key);
  return{items:items.slice((page-1)*q.pageSize,page*q.pageSize),total:items.length,page,pageSize:q.pageSize,version:catalog.version,canWrite:current.permissions.includes('entitlements.write'),applicationKey:app.key,applications:current.sources,catalog:app.packages.catalog,developmentOnly:row.config.environment==='development'};
 }
 async change(s,tenantId,applicationKey,input,mutate){
  parse(key,applicationKey);await this.context(this.db,s,tenantId,applicationKey);
  return this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,applicationKey,'entitlements.read',db,true);const row=await this.apps.admin(s,tenantId,applicationKey,'entitlements.write',db),adapter=application(applicationKey).packages;
   if(!adapter)fail('PACKAGE_UNAVAILABLE','该应用不支持套餐管理',404);
   const catalog=applicationKey===frameworkKey?await systemBenefitCatalog(db,tenantId,applicationKey):{config:row.config,version:row.configVersion,exists:true};
   if(catalog.version!==input.version)fail('PACKAGE_CONFLICT','套餐或应用配置已更新，请刷新后重新编辑',409);
   const config=structuredClone(catalog.config),before=adapter.items(config),result=await mutate(adapter,config,before);
   if(applicationKey===frameworkKey)await saveSystemBenefitCatalog(db,tenantId,applicationKey,catalog,config);
   else {const changed=await db.tenantApplication.updateMany({where:{tenantId,applicationKey,configVersion:input.version},data:{config,configVersion:{increment:1}}});if(!changed.count)fail('PACKAGE_CONFLICT','配置已更新，请刷新后重试',409);}
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:result.action,details:{ids:result.ids,before:before.filter(p=>result.ids.includes(p.id)).map(({image,...item})=>({...item,hasImage:!!image})),after:adapter.items(config).filter(p=>result.ids.includes(p.id)).map(({image,...item})=>({...item,hasImage:!!image})),version:input.version+1,...(s.delegated?{targetAdminId:s.id}:{})}}});
   return{...result,version:input.version+1};
  });
 }
 async save(s,tenantId,applicationKey,packageId,input){
  if(packageId)parse(id,packageId);const q=parse(z.object({version,requestId:z.string().uuid().optional(),package:z.unknown()}).strict(),input);
  if(!packageId&&!q.requestId)fail('PACKAGE_INPUT_INVALID','缺少新增请求标识');
  await this.context(this.db,s,tenantId,applicationKey);const adapter=application(applicationKey).packages,pkg=adapter.normalize(q.package),target=packageId||q.requestId;
  return this.change(s,tenantId,applicationKey,q,async(adapter,config,before)=>{
   const old=before.find(p=>p.id===target);
   if(packageId&&!old)fail('NOT_FOUND','套餐不存在或已删除',404);
   if(!packageId&&old)fail('PACKAGE_EXISTS','该新增请求已保存，请重新读取套餐列表',409);
   if(applicationKey===frameworkKey&&pkg.image!==old?.image)pkg.image=await normalizeAccountImage(pkg.image,{storage:this.storage,siteId:tenantId});
   await adapter.save(config,target,pkg);return{ids:[target],action:packageId?'package.update':'package.create'};
  });
 }
 async setEnabled(s,tenantId,applicationKey,packageId,input){parse(id,packageId);const q=parse(z.object({version,enabled:z.boolean()}).strict(),input);return this.change(s,tenantId,applicationKey,q,(adapter,config,before)=>{if(!before.some(p=>p.id===packageId))fail('NOT_FOUND','套餐不存在或已删除',404);adapter.setEnabled(config,packageId,q.enabled);return{ids:[packageId],action:q.enabled?'package.enable':'package.disable'}})}
 async remove(s,tenantId,applicationKey,input){const q=parse(z.object({version,ids:z.array(id).min(1).max(100)}).strict(),input),ids=[...new Set(q.ids)];return this.change(s,tenantId,applicationKey,q,(adapter,config,before)=>{if(ids.some(id=>!before.some(p=>p.id===id)))fail('NOT_FOUND','部分套餐不存在，请刷新后重新选择',404);adapter.remove(config,ids);return{ids,action:'package.delete',deleted:ids.length}})}
}
