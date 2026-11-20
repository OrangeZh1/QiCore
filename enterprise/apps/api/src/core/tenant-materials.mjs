import {officialMaterialRefs} from '../channels/official-account-config.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {decorationImageIds} from './decoration-contract.mjs';
import sharp from 'sharp';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {normalizeMaterial,normalizeSelectedImage,selectionTransform} from './materials.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {application,hasApplicationPermission} from '../applications/registry.mjs';

const kind=z.enum(['image','video','file']),purpose=z.enum(['library','account','policy']).default('library');
const name=z.string().trim().min(1).max(180).refine(v=>!/[<>\\/\u0000-\u001f\u007f]/.test(v));
const groupId=z.string().uuid().nullable(),ids=z.array(z.string().uuid()).min(1).max(100);
const labels={local:'本地存储',qiniu:'七牛云',oss:'阿里云 OSS',cos:'腾讯云 COS'};
const scopeOf=(tenantId,scopeKey)=>({tenantId,scopeKey});
function parse(schema,value){const r=schema.safeParse(value);if(!r.success)fail('MATERIAL_INPUT_INVALID','请检查素材名称、范围和请求内容');return r.data}

export class TenantMaterials {
 constructor(db,storage){this.db=db;this.storage=storage;this.applications=new TenantApplications(db);this.busy=new Set()}
 permitted(grants,scopeKey,write=false){return scopeKey==='shared'?grants.includes('tenant:materials.read')&&(!write||grants.includes('tenant:materials.write')):hasApplicationPermission(grants,scopeKey,'materials.read')&&(!write||hasApplicationPermission(grants,scopeKey,'materials.write'))}
 async authorize(s,tenantId,scopeKey,write=false,db=this.db){
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)||!/^[a-z0-9_-]{1,64}$/.test(scopeKey))fail('MATERIAL_INPUT_INVALID','素材范围无效');
  if(scopeKey!=='shared')application(scopeKey);
  if(!s?._admin||s.role!=='tenant'||!s.tenantIds?.includes(tenantId)||s.delegated&&s.tenantId!==tenantId)fail('FORBIDDEN','没有该站点的素材权限',403);
  const account=await this.applications.actor(db,s,'tenant',tenantId);
  if(!account.scopes.some(row=>row.tenantId===tenantId)||!this.permitted(account.role.permissions,scopeKey,write)||!this.permitted(s.permissions,scopeKey,write))fail('FORBIDDEN','没有该范围的素材操作权限',403);
  const tenant=await db.tenant.findUnique({where:{id:tenantId}});
  if(!tenant?.enabled||!s.delegated&&tenant.expiresAt&&tenant.expiresAt<=new Date())fail('TENANT_UNAVAILABLE','站点已停用或到期',403);
  if(scopeKey!=='shared')await this.applications.available(tenantId,scopeKey,db,false,s);
  return{...tenant,canManageMaterials:this.permitted(account.role.permissions,scopeKey,true)&&this.permitted(s.permissions,scopeKey,true)};
 }
 async policy(tenant,required=false){
  try{return await this.storage.publicPolicy(tenant.id)}catch(e){if(required||e.code!=='TENANT_STORAGE_UNCONFIGURED')throw e;return{siteId:tenant.id,revisionId:null,maxFileMb:0,label:'独立存储未启用',external:false,blockedReason:'本站独立存储尚未启用，请前往存储设置完成配置。'}}
 }
 async expose(row){const direct=row.kind!=='file'&&row.status==='ready'?this.storage.publicUrl(await this.storage.revision(row.revisionId),row.objectKey):null;const url=direct||`/api/v1/admin/tenants/${encodeURIComponent(row.tenantId)}/materials/${encodeURIComponent(row.scopeKey)}/${row.id}/content`;return{id:row.id,name:row.name,kind:row.kind,mime:row.mime,bytes:row.bytes,provider:row.provider,source:labels[row.provider],groupId:row.groupId,visibility:row.scopeKey==='shared'?'tenant':'application',status:row.status,version:row.version,createdAt:row.createdAt,url,thumbnail:row.kind==='image'?(direct||url+'?thumbnail=1'):null}}
 async audit(db,s,tenantId,scopeKey,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:scopeKey==='shared'?null:scopeKey,actor:s.impersonatedBy||s.id,action,details:{...details,materialScope:scopeKey,...(s.delegated?{targetAdminId:s.id}:{})}}})}
 async row(db,tenantId,scopeKey,id,ready=true){parse(z.string().uuid(),id);const row=await db.tenantMaterial.findFirst({where:{id,...scopeOf(tenantId,scopeKey),deletedAt:null}});if(!row)fail('NOT_FOUND','素材不存在或不可访问',404);if(ready&&row.status!=='ready')fail('MATERIAL_NOT_READY','素材尚未就绪，请刷新后重试',409);return row}
 async list(s,tenantId,scopeKey,input){
  const q=parse(z.object({kind,purpose,q:z.string().trim().max(100).default(''),group:z.union([z.enum(['all','none']),z.string().uuid()]).default('all'),source:z.enum(['all','local','qiniu','oss','cos','legacy']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)}).strict(),input);
  const tenant=await this.authorize(s,tenantId,scopeKey),where={...scopeOf(tenantId,scopeKey),deletedAt:null,kind:q.kind,...(q.q?{name:{contains:q.q}}:{}),...(q.source==='all'?{}:{provider:q.source}),...(q.group==='all'?{}:{groupId:q.group==='none'?null:q.group})};
  const [items,total,groups]=await this.db.$transaction([this.db.tenantMaterial.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],take:q.pageSize,skip:(q.page-1)*q.pageSize}),this.db.tenantMaterial.count({where}),this.db.tenantMaterialGroup.findMany({where:{...scopeOf(tenantId,scopeKey),kind:q.kind},orderBy:[{createdAt:'asc'},{id:'asc'}]})]);
  const policy=await this.policy(tenant),canManage=tenant.canManageMaterials;return{items:await Promise.all(items.map(row=>this.expose(row))),total,groups,canManage,canUpload:canManage&&!!policy.revisionId,policy};
 }
 async checkGroup(db,tenantId,scopeKey,id,type){if(id&&!await db.tenantMaterialGroup.count({where:{id,...scopeOf(tenantId,scopeKey),kind:type}}))fail('MATERIAL_GROUP_INVALID','分组不存在或不属于当前范围和分类',409)}
 async upload(s,tenantId,scopeKey,input,bytes){
  const q=parse(z.object({purpose,kind,name,requestId:z.string().uuid(),groupId:groupId.default(null),storageRevision:z.string().uuid()}).strict(),input),tenant=await this.authorize(s,tenantId,scopeKey,true),policy=await this.policy(tenant,true);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>policy.maxFileMb*1024*1024)fail('MATERIAL_SIZE_INVALID','文件为空或超过当前存储大小限制');
  const hash=createHash('sha256').update(bytes).digest('hex'),prior=await this.db.tenantMaterial.findUnique({where:{id:q.requestId}});
  if(prior){if(prior.tenantId!==tenantId||prior.scopeKey!==scopeKey||prior.ownerId!==s.id||prior.hash!==hash||prior.deletedAt)fail('MATERIAL_REQUEST_CONFLICT','上传请求已使用，请重新选择文件',409);if(prior.status!=='ready')fail('MATERIAL_NOT_READY','上次上传尚未完成，请刷新素材列表',409);return this.expose(prior)}
  if(policy.revisionId!==q.storageRevision)fail('MATERIAL_STORAGE_CHANGED','存储配置已改变，请刷新后重新上传',409);
  const revision=await this.storage.revision(policy.revisionId),normalized=await normalizeMaterial(bytes,q.name);
  if(normalized.kind!==q.kind)fail('MATERIAL_KIND_INVALID','文件实际类型与当前分类不一致，请切换对应分类');
  const id=q.requestId,objectKey=`sites/${tenantId}/${scopeKey==='shared'?'shared':'applications/'+scopeKey}/materials/${id}.${normalized.extension}`;
  try{await this.applications.transaction(async tx=>{const current=await this.authorize(s,tenantId,scopeKey,true,tx);if((await this.policy(current,true)).revisionId!==q.storageRevision)fail('MATERIAL_STORAGE_CHANGED','存储配置已改变，请刷新后重新上传',409);await this.checkGroup(tx,tenantId,scopeKey,q.groupId,q.kind);await tx.tenantMaterial.create({data:{id,...scopeOf(tenantId,scopeKey),name:normalized.name,kind:q.kind,mime:normalized.mime,bytes:normalized.data.length,hash,provider:revision.provider,revisionId:revision.id,objectKey,ownerId:s.id,groupId:q.groupId,status:'uploading'}})})}catch(e){if(e.code==='P2002')fail('MATERIAL_NOT_READY','该文件正在上传，请刷新后重试',409);throw e}
  this.busy.add(id);
  try{
   await this.storage.providers.put(revision.provider,revision.config,this.storage.credentials(revision),objectKey,normalized.data,normalized.mime);
   const row=await this.applications.transaction(async tx=>{const current=await this.authorize(s,tenantId,scopeKey,true,tx);await this.policy(current,true);const saved=await tx.tenantMaterial.update({where:{id},data:{status:'ready'}});await this.audit(tx,s,tenantId,scopeKey,'material.upload',{materialId:id,name:saved.name,kind:saved.kind});return saved});return this.expose(row);
  }catch{await this.db.tenantMaterial.updateMany({where:{id,...scopeOf(tenantId,scopeKey),status:'uploading'},data:{status:'failed'}}).catch(()=>{});fail('MATERIAL_UPLOAD_FAILED','上传未完成，记录已保留，可在素材库中删除后重试',503)}finally{this.busy.delete(id)}
 }
 async streamContent(s,tenantId,scopeKey,id,input,range){
  const q=parse(z.object({purpose,thumbnail:z.enum(['0','1']).default('0')}).strict(),input);await this.authorize(s,tenantId,scopeKey);const row=await this.row(this.db,tenantId,scopeKey,id);
    const direct=row.kind!=='file'&&row.revisionId?this.storage.publicUrl(await this.storage.revision(row.revisionId),row.objectKey):null;if(direct)return{redirect:direct,mime:row.mime,name:row.name,inline:row.kind!=='file'};
  if(q.thumbnail==='1')return this.content(s,tenantId,scopeKey,id,input);
  const revision=await this.storage.revision(row.revisionId),file=await this.storage.providers.stream(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey,row.bytes,range);
  try{await this.authorize(s,tenantId,scopeKey)}catch(e){file.stream.destroy();throw e}
  return{...file,mime:row.mime,name:row.name,inline:row.kind!=='file'};
 }
 async content(s,tenantId,scopeKey,id,input){
  const q=parse(z.object({purpose,thumbnail:z.enum(['0','1']).default('0')}).strict(),input);await this.authorize(s,tenantId,scopeKey);const row=await this.row(this.db,tenantId,scopeKey,id);
  let data;try{const revision=await this.storage.revision(row.revisionId);data=await this.storage.providers.get(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey,100*1024*1024);if(q.thumbnail==='1'&&row.kind==='image')data=await sharp(data).resize(320,240,{fit:'inside',withoutEnlargement:true}).webp({quality:75}).toBuffer()}catch{fail('MATERIAL_READ_FAILED','素材读取失败，请检查原存储配置',503)}
  await this.authorize(s,tenantId,scopeKey);return{data,mime:q.thumbnail==='1'&&row.kind==='image'?'image/webp':row.mime,name:row.name,inline:row.kind!=='file'};
 }
 async select(s,tenantId,scopeKey,id,input){
  const q=parse(z.object({purpose,...selectionTransform}).strict(),input);await this.authorize(s,tenantId,scopeKey);const row=await this.row(this.db,tenantId,scopeKey,id);
  if(q.purpose==='library')return this.expose(row);
  if(row.kind!=='image')fail('MATERIAL_KIND_INVALID','此字段只能选择图片');
  const {data}=await this.content(s,tenantId,scopeKey,id,{});let value;
  try{if(q.purpose==='account'){value=await normalizeSelectedImage(data,q)}else{const bytes=await sharp(data,{limitInputPixels:16000000,animated:false}).rotate().resize(q.purpose==='policy'?1024:256,q.purpose==='policy'?1024:256,{fit:q.purpose==='policy'?'inside':'cover',withoutEnlargement:q.purpose==='policy'}).webp({quality:80}).toBuffer();if(bytes.length>(q.purpose==='policy'?300000:80000))throw Error();value='data:image/webp;base64,'+bytes.toString('base64')}}catch{fail('MATERIAL_IMAGE_INVALID','图片无法解析或尺寸过大，请重新选择')}
  value=await this.storage.saveImage(Buffer.from(value.split(',')[1],'base64'),'image/webp',{siteId:tenantId,kind:q.purpose==='policy'?'content':'avatar'});
  await this.authorize(s,tenantId,scopeKey);await this.audit(this.db,s,tenantId,scopeKey,'material.select',{materialId:id,purpose:q.purpose});return{id,value};
 }
 async rename(s,tenantId,scopeKey,id,input){
  const q=parse(z.object({name,version:z.number().int().positive()}).strict(),input);
  return this.applications.transaction(async tx=>{await this.authorize(s,tenantId,scopeKey,true,tx);await this.row(tx,tenantId,scopeKey,id);const result=await tx.tenantMaterial.updateMany({where:{id,...scopeOf(tenantId,scopeKey),status:'ready',deletedAt:null,version:q.version},data:{name:q.name,version:{increment:1}}});if(!result.count)fail('MATERIAL_CONFLICT','素材已变更，请刷新',409);await this.audit(tx,s,tenantId,scopeKey,'material.rename',{materialId:id,name:q.name});return{updated:true}});
 }
 async move(s,tenantId,scopeKey,input){
  const q=parse(z.object({ids,kind,groupId}).strict(),input),unique=[...new Set(q.ids)];
  return this.applications.transaction(async tx=>{await this.authorize(s,tenantId,scopeKey,true,tx);await this.checkGroup(tx,tenantId,scopeKey,q.groupId,q.kind);const where={id:{in:unique},...scopeOf(tenantId,scopeKey),deletedAt:null,status:'ready',kind:q.kind};if(await tx.tenantMaterial.count({where})!==unique.length)fail('MATERIAL_CONFLICT','所选素材已变更或不属于当前范围',409);const result=await tx.tenantMaterial.updateMany({where,data:{groupId:q.groupId,version:{increment:1}}});await this.audit(tx,s,tenantId,scopeKey,'material.move',{count:result.count,groupId:q.groupId});return{moved:result.count}});
 }
 async remove(s,tenantId,scopeKey,input){
  const q=parse(z.object({ids}).strict(),input);await this.authorize(s,tenantId,scopeKey,true);const results=[];
  for(const id of new Set(q.ids))try{
   const row=await this.row(this.db,tenantId,scopeKey,id,false);
   if(this.busy.has(id)||row.status==='uploading'&&Date.now()-row.createdAt.getTime()<120000)fail('MATERIAL_BUSY','素材正在上传，请稍后重试',409);
   this.busy.add(id);try{
    await this.applications.transaction(async tx=>{await this.authorize(s,tenantId,scopeKey,true,tx);await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;await this.row(tx,tenantId,scopeKey,id,false);const decoration=await tx.tenantDecoration.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:scopeKey}}});if((decoration?.schemes||[]).some(s=>s.coverId===id)||[...(decoration?.schemes||[]).map(s=>s.scheme),...(decoration?.published?[decoration.published]:[])].some(scheme=>decorationImageIds(scheme).includes(id)))fail('MATERIAL_IN_USE','图片正被装修草稿或已启用方案引用，请先解除引用',409);if(await tx.tenantPageSharing.count({where:{tenantId,applicationKey:scopeKey,config:{path:'$.imageId',equals:id}}}))fail('MATERIAL_IN_USE','图片正在用于页面分享，请先解除关联',409);if((await tx.tenantOfficialAccountSetting.findMany({where:{tenantId},select:{config:true}})).some(row=>officialMaterialRefs(row.config).some(ref=>ref.id===id)))fail('MATERIAL_IN_USE','素材正在用于公众号配置，请先在公众号设置中解除关联',409);await tx.tenantMaterial.update({where:{id},data:{status:'deleting',version:{increment:1}}});await this.audit(tx,s,tenantId,scopeKey,'material.delete.requested',{materialId:id})});
    const revision=await this.storage.revision(row.revisionId);await this.storage.providers.remove(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey);
    await this.db.$transaction(async tx=>{await tx.tenantMaterial.update({where:{id},data:{status:'deleted',deletedAt:new Date()}});await this.audit(tx,s,tenantId,scopeKey,'material.delete',{materialId:id})});results.push({id,deleted:true});
   }finally{this.busy.delete(id)}
  }catch(e){results.push({id,deleted:false,message:['MATERIAL_BUSY','MATERIAL_IN_USE'].includes(e.code)?e.message:'删除未完成，请刷新后重试'})}
  return{results,deleted:results.filter(row=>row.deleted).length,failed:results.filter(row=>!row.deleted).length};
 }
 async group(s,tenantId,scopeKey,id,input,remove=false){
  const q=parse(remove?z.object({version:z.number().int().positive()}).strict():z.object({kind,name:name.refine(v=>v.length<=40),...(id?{version:z.number().int().positive()}:{requestId:z.string().uuid()})}).strict(),input);
  try{return await this.db.$transaction(async tx=>{
   await this.authorize(s,tenantId,scopeKey,true,tx);
   if(!id){const prior=await tx.tenantMaterialGroup.findUnique({where:{id:q.requestId}});if(prior){if(prior.tenantId!==tenantId||prior.scopeKey!==scopeKey||prior.kind!==q.kind||prior.name!==q.name)fail('MATERIAL_CONFLICT','分组请求已使用',409);return prior}const row=await tx.tenantMaterialGroup.create({data:{id:q.requestId,...scopeOf(tenantId,scopeKey),kind:q.kind,name:q.name}});await this.audit(tx,s,tenantId,scopeKey,'material.group.create',{groupId:row.id,name:row.name});return row}
   const old=await tx.tenantMaterialGroup.findFirst({where:{id,...scopeOf(tenantId,scopeKey)}});if(!old||old.version!==q.version)fail('MATERIAL_CONFLICT','分组已变更，请刷新',409);
   if(remove){await tx.tenantMaterial.updateMany({where:{...scopeOf(tenantId,scopeKey),groupId:id},data:{groupId:null,version:{increment:1}}});await tx.tenantMaterialGroup.delete({where:{id}})}else{if(q.kind!==old.kind)fail('MATERIAL_GROUP_INVALID','不能改变分组所属分类');await tx.tenantMaterialGroup.update({where:{id},data:{name:q.name,version:{increment:1}}})}
   await this.audit(tx,s,tenantId,scopeKey,remove?'material.group.delete':'material.group.rename',{groupId:id});return{updated:true};
  },{isolationLevel:'Serializable'})}catch(e){if(e.code==='P2002')fail('MATERIAL_GROUP_EXISTS','当前范围和分类下已有同名分组',409);throw e}
 }
}
