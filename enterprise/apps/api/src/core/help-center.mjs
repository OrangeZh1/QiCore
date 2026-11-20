import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import sanitizeHtml from 'sanitize-html';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {sanitizeRichTextHtml,richTextHasText} from './rich-text.mjs';
import {fail} from './errors.mjs';

const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),id=z.uuid(),version=z.number().int().nonnegative();
const fields={name:z.string().trim().min(1).max(80),sort:z.number().int().min(0).max(999999),enabled:z.boolean()};
const categorySchema=z.object({version,...fields}).strict();
const articleSchema=z.object({version,title:z.string().trim().min(1).max(120),categoryId:id,content:z.string().trim().min(1).max(1000000),sort:fields.sort,enabled:fields.enabled}).strict();
const querySchema=z.object({applicationKey:identifier.optional(),q:z.string().trim().max(100).default(''),categoryId:id.optional(),status:z.enum(['all','enabled','disabled']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)}).strict();
const parse=(schema,input)=>{const result=schema.safeParse(input);if(!result.success)fail('HELP_INPUT_INVALID','请检查分类、标题、正文、排序及版本');return result.data};
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey});
const orderBy=[{sort:'desc'},{createdAt:'desc'},{id:'asc'}];
const summary={id:true,categoryId:true,title:true,sort:true,enabled:true,version:true,updatedAt:true,category:{select:{id:true,name:true,enabled:true}}};

/** Client-facing content belongs to the framework; applications supply no business rules here. */
export class HelpCenter {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,key){parse(identifier,tenantId);if(key)parse(identifier,key);return this.apps.featureContext(db,s,tenantId,key,'helpCenter','settings.read')}
 async available(tenantId,key,db=this.db){parse(identifier,tenantId);parse(identifier,key);await this.apps.available(tenantId,key,db);if(!application(key).helpCenter)fail('HELP_UNAVAILABLE','该应用尚未接入帮助中心',404)}
 async list(s,tenantId,input={}){
  const q=parse(querySchema,input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),key=ctx.selected?.key;
  const data=key?await this.query(tenantId,key,q,false):{categories:[],items:[],total:0,page:q.page,pageSize:q.pageSize};
  const current=await this.context(this.db,s,tenantId,key);
  return {...data,applicationKey:key||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write')};
 }
 async query(tenantId,key,q,published){
  return this.db.$transaction(async db=>{
   const base={...scope(tenantId,key),deletedAt:null},where={...base,...(q.categoryId?{categoryId:q.categoryId}:{}),...(published?{enabled:true,category:{enabled:true,deletedAt:null}}:q.status==='all'?{}:{enabled:q.status==='enabled'}),...(q.q?{OR:[{title:{contains:q.q}},{searchText:{contains:q.q}}]}:{})};
   const categories=await db.helpCategory.findMany({where:{...base,...(published?{enabled:true}:{})},orderBy,select:{id:true,name:true,sort:true,enabled:true,version:true,updatedAt:true}});
   const total=await db.helpArticle.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)));
   const items=await db.helpArticle.findMany({where,orderBy,skip:(page-1)*q.pageSize,take:q.pageSize,select:summary});
   return {categories,items,total,page,pageSize:q.pageSize};
  },{isolationLevel:'RepeatableRead'});
 }
 async detail(s,tenantId,key,articleId){
  parse(id,articleId);await this.context(this.db,s,tenantId,key);
  const row=await this.db.helpArticle.findFirst({where:{...scope(tenantId,key),id:articleId,deletedAt:null},select:{...summary,content:true}});
  if(!row)fail('HELP_NOT_FOUND','帮助文章不存在',404);await this.context(this.db,s,tenantId,key);return row;
 }
 async save(s,tenantId,key,type,recordId,input){
  parse(id,recordId);if(!['categories','articles'].includes(type))fail('HELP_INPUT_INVALID','内容类型无效');await this.context(this.db,s,tenantId,key);
  const q=parse(type==='categories'?categorySchema:articleSchema,input),{version:expected,...data}=q;
  if(type==='articles'){data.content=sanitizeRichTextHtml(data.content,undefined,false);if(!richTextHasText(data.content))fail('HELP_INPUT_INVALID','请输入有效的帮助正文');data.searchText=sanitizeHtml(data.content,{allowedTags:[],allowedAttributes:{}}).slice(0,30000)}
  return this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,key,'settings.write',db,true);const target={...scope(tenantId,key),id:recordId},model=type==='categories'?db.helpCategory:db.helpArticle;
   const old=await model.findUnique({where:{tenantId_applicationKey_id:target}});
   if(old?.deletedAt||(old?.version||0)!==expected)fail('HELP_CONFLICT','内容已变更，请刷新后重新编辑',409);
   if(type==='articles'&&!await db.helpCategory.count({where:{...scope(tenantId,key),id:data.categoryId,deletedAt:null}}))fail('HELP_CATEGORY_INVALID','请选择当前应用的有效分类');
   // A bounded category selector keeps management and client navigation usable.
   if(type==='categories'&&!old&&await db.helpCategory.count({where:{...scope(tenantId,key),deletedAt:null}})>=100)fail('HELP_CATEGORY_LIMIT','最多可创建 100 个帮助分类',409);
   const row=old?await model.update({where:{tenantId_applicationKey_id:target},data:{...data,version:{increment:1}}}):await model.create({data:{...target,...data}});
   await this.audit(db,s,tenantId,key,'help.'+type+'.save',{id:recordId,version:row.version});return {id:row.id,version:row.version};
  });
 }
 async remove(s,tenantId,key,type,recordId,input){
  parse(id,recordId);if(!['categories','articles'].includes(type))fail('HELP_INPUT_INVALID','内容类型无效');const q=parse(z.object({version}).strict(),input);await this.context(this.db,s,tenantId,key);
  return this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,key,'settings.write',db,true);const target={...scope(tenantId,key),id:recordId},model=type==='categories'?db.helpCategory:db.helpArticle;
   const old=await model.findUnique({where:{tenantId_applicationKey_id:target}});if(!old)fail('HELP_NOT_FOUND','内容不存在',404);
   if(old.deletedAt)return {deleted:true};if(old.version!==q.version)fail('HELP_CONFLICT','内容已变更，请刷新后重试',409);
   if(type==='categories'&&await db.helpArticle.count({where:{...scope(tenantId,key),categoryId:recordId,deletedAt:null}}))fail('HELP_CATEGORY_IN_USE','请先移动或删除该分类下的文章',409);
   await model.update({where:{tenantId_applicationKey_id:target},data:{deletedAt:new Date(),enabled:false,version:{increment:1}}});
   await this.audit(db,s,tenantId,key,'help.'+type+'.delete',{id:recordId,version:old.version+1});return {deleted:true};
  });
 }
 async published(tenantId,key,input={},articleId){
  await this.available(tenantId,key);let result;
  if(articleId){parse(id,articleId);parse(z.object({}).strict(),input);const row=await this.db.helpArticle.findFirst({where:{...scope(tenantId,key),id:articleId,enabled:true,deletedAt:null,category:{enabled:true,deletedAt:null}},select:{id:true,title:true,content:true,updatedAt:true,category:{select:{id:true,name:true}}}});if(!row)fail('HELP_NOT_FOUND','文章不存在或已隐藏',404);result=row}
  else{const q=parse(querySchema.omit({applicationKey:true,status:true}),input),data=await this.query(tenantId,key,q,true);result={...data,categories:data.categories.map(({id,name})=>({id,name})),items:data.items.map(({id,title,updatedAt,category})=>({id,title,updatedAt,category:{id:category.id,name:category.name}}))}}
  await this.available(tenantId,key);return result;
 }
 async audit(db,s,tenantId,applicationKey,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
}
