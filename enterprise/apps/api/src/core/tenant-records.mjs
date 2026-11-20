import {z} from 'zod';
import {frameworkKey} from '../applications/framework.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {fail} from './errors.mjs';

const paging={page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(v=>[10,20,50].includes(v)).default(20)};
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v});
const query=z.object({...paging,applicationKey:z.string().min(1).max(64).optional(),q:z.string().trim().max(100).default(''),type:z.string().max(64).default('all'),status:z.string().max(64).default('all'),provider:z.string().max(32).default('all'),from:day.optional(),to:day.optional()}).strict();
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
function parse(schema,input){const r=schema.safeParse(input);if(!r.success)fail('RECORD_INPUT_INVALID','请检查筛选条件、日期和分页参数');return r.data}

// Shared read-only tenant records boundary. Registered applications own their data and rules.
export class TenantRecords {
 constructor(db,feature,permission){this.db=db;this.apps=new TenantApplications(db);this.feature=feature;this.permission=permission}
 context(db,s,tenantId,key){return this.apps.featureContext(db,s,tenantId,key,this.feature,this.permission)}
 async read(s,tenantId,key,fn){
  await this.context(this.db,s,tenantId,key);
  const snapshot=await this.db.$transaction(async db=>{const ctx=await this.context(db,s,tenantId,key);return{value:await fn(db,ctx),permissions:ctx.permissions}},{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,snapshot.value.applicationKey||key);
  if(snapshot.permissions.some(p=>!current.permissions.includes(p)))fail('FORBIDDEN','查看权限已变更，请刷新',403);
  return snapshot.value;
 }
 async list(s,tenantId,input){
  const q=parse(query,input);if(q.from&&q.to&&q.from>q.to)fail('RECORD_INPUT_INVALID','开始日期不能晚于结束日期');
  q.start=q.from?new Date(q.from+'T00:00:00+08:00'):null;q.end=q.to?new Date(new Date(q.to+'T00:00:00+08:00').getTime()+86400000):null;
  return this.read(s,tenantId,q.applicationKey,async(db,ctx)=>{
   if(!ctx.selected)return{items:[],total:0,page:1,pageSize:q.pageSize,applicationKey:null,applications:ctx.sources,catalog:null};
   const adapter=application(ctx.selected.key)[this.feature],catalog=adapter.catalog;
   if(q.type!=='all'&&!catalog.types.some(t=>t.key===q.type)||q.status!=='all'&&!catalog.statuses.some(t=>t.key===q.status))fail('RECORD_INPUT_INVALID','筛选类型或状态无效');
   if(q.provider!=='all'&&!catalog.providers?.some(p=>p.key===q.provider))fail('RECORD_INPUT_INVALID','支付方式筛选无效');
   return{...await adapter.list(db,tenantId,q,ctx.permissions),applicationKey:ctx.selected.key,applications:ctx.sources,catalog,canWrite:this.feature==='entitlements'&&ctx.selected.key===frameworkKey&&ctx.permissions.includes('entitlements.write')};
  });
 }
 async detail(s,tenantId,key,id,input={}){
  parse(identifier,id);parse(identifier,key);const q=parse(z.object(paging).strict(),input);
  return this.read(s,tenantId,key,async(db,ctx)=>{if(!ctx.selected)fail('RECORD_INPUT_INVALID','请选择应用');const value=await application(ctx.selected.key)[this.feature].detail(db,tenantId,id,q,ctx.permissions);if(!value)fail('NOT_FOUND','记录不存在',404);return{...value,applicationKey:ctx.selected.key,application:ctx.selected}});
 }
}
