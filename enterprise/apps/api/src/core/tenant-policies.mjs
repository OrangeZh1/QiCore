import {formValidationMessage} from './form-validation.mjs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {fail} from './errors.mjs';
import {renderPolicyMarkdown,policyHasText} from './policy-markdown.mjs';
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),kind=z.enum(['terms','privacy']),labels={terms:'用户协议',privacy:'隐私政策'};
const parse=(schema,input)=>{const q=schema.safeParse(input);if(!q.success)fail('POLICY_INPUT_INVALID',formValidationMessage(q.error));return q.data};
const scope=(tenantId,applicationKey,kind)=>({tenantId,applicationKey,kind});
export class TenantPolicies {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,key){parse(identifier,tenantId);if(key)parse(identifier,key);return this.apps.featureContext(db,s,tenantId,key,'consumers','settings.read')}
 async list(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:identifier.optional()}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),key=ctx.selected?.key;
  const documents=key?await this.db.tenantPolicyDocument.findMany({where:{tenantId,applicationKey:key}}):[],revisions=key?await this.db.tenantPolicyRevision.findMany({where:{tenantId,applicationKey:key,OR:documents.map(row=>({kind:row.kind,version:row.version}))},select:{kind:true,version:true,publishedAt:true}}):[];
  const current=await this.context(this.db,s,tenantId,key);
  return{applicationKey:key||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write'),items:key?Object.entries(labels).map(([kind,label])=>{const row=documents.find(d=>d.kind===kind);return{kind,label,title:row?.title||label,updatedAt:revisions.find(r=>r.kind===kind&&r.version===row?.version)?.publishedAt||null}}):[]};
 }
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:identifier.optional(),kind:kind.default('terms')}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),key=ctx.selected?.key;
  const where=scope(tenantId,key,q.kind),row=key?await this.db.tenantPolicyDocument.findUnique({where:{tenantId_applicationKey_kind:where}}):null;
  const history=key?await this.db.tenantPolicyRevision.findMany({where,orderBy:{version:'desc'},take:20,select:{version:true,title:true,publishedAt:true}}):[];
  const current=await this.context(this.db,s,tenantId,key);return{applicationKey:key||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write'),kind:q.kind,version:row?.version||0,title:row?.title||labels[q.kind],content:row?.content||'',contentHtml:renderPolicyMarkdown(row?.content||''),contentFormat:'richtext',updatedAt:history.find(r=>r.version===row?.version)?.publishedAt||null};
 }
 async preview(s,tenantId,key,type,input){parse(kind,type);await this.context(this.db,s,tenantId,key);const q=parse(z.object({content:z.string().max(1000000)}).strict(),input);return{contentHtml:renderPolicyMarkdown(q.content)}}
 async save(s,tenantId,key,type,input){
  parse(kind,type);await this.context(this.db,s,tenantId,key);
  const q=parse(z.object({version:z.number().int().nonnegative(),title:z.string().trim().min(1).max(80),content:z.string().trim().min(1).max(1000000)}).strict(),input);
  if(!policyHasText(q.content))fail('POLICY_INPUT_INVALID','请输入有效的协议正文');
  await this.apps.transaction(async db=>{await this.apps.admin(s,tenantId,key,'settings.write',db,true);const where={tenantId_applicationKey_kind:scope(tenantId,key,type)},old=await db.tenantPolicyDocument.findUnique({where});if((old?.version||0)!==q.version)fail('POLICY_CONFLICT','协议已更新，请刷新后重新编辑',409);const version=q.version+1;
   await db.tenantPolicyRevision.create({data:{...scope(tenantId,key,type),version,title:q.title,content:q.content,publishedAt:new Date()}});
   await db.tenantPolicyDocument.upsert({where,create:{...scope(tenantId,key,type),title:q.title,content:q.content,version,currentVersion:version},update:{title:q.title,content:q.content,version,currentVersion:version}});await this.audit(db,s,tenantId,key,type,'policy.save',version)});
  return this.view(s,tenantId,{applicationKey:key,kind:type});
 }
 async published(tenantId,key,type,version){
  parse(identifier,tenantId);parse(identifier,key);parse(kind,type);await this.apps.available(tenantId,key);const where=scope(tenantId,key,type),doc=await this.db.tenantPolicyDocument.findUnique({where:{tenantId_applicationKey_kind:where}}),target=version===undefined?doc?.currentVersion:parse(z.coerce.number().int().positive(),version);
  const row=target?await this.db.tenantPolicyRevision.findUnique({where:{tenantId_applicationKey_kind_version:{...where,version:target}}}):null;if(!row)fail('POLICY_NOT_CONFIGURED','协议尚未设置',404);await this.apps.available(tenantId,key);return{...row,contentFormat:'richtext',contentHtml:renderPolicyMarkdown(row.content),updatedAt:row.publishedAt};
 }
 async audit(db,s,tenantId,applicationKey,kind,action,version){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action,details:{kind,version,...(s.delegated?{targetAdminId:s.id}:{})}}})}
}
