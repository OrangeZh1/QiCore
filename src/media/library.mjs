import {randomUUID,createHash} from 'node:crypto'
import sharp from 'sharp'
import {z} from 'zod'
import {fail} from './errors.mjs'
import {can} from '../identity.mjs'
import {normalizeMaterial,normalizeSelectedImage,selectionTransform} from '../material-images.mjs'
const kind=z.enum(['image','video','file']),purpose=z.enum(['library','account','site','profile','tenant','policy']).default('library');
const name=z.string().trim().min(1).max(180).refine(v=>!/[<>\\/\u0000-\u001f\u007f]/.test(v));
const groupId=z.string().uuid().nullable(),ids=z.array(z.string().uuid()).min(1).max(100);
const labels={local:'本地存储',qiniu:'七牛云',oss:'阿里云 OSS',cos:'腾讯云 COS'};
const scopeOf=scopeKey=>({scopeKey});
function parse(schema,value){const r=schema.safeParse(value);if(!r.success)fail('MATERIAL_INPUT_INVALID','请检查素材名称、范围和请求内容');return r.data}

export class MaterialLibrary {
 constructor(db,storage,application,isReferenced) {
   this.db=db;this.storage=storage;this.application=application;this.isReferenced=isReferenced;this.busy=new Set()
 }
 transaction(work){return this.db.$transaction(work,{isolationLevel:'Serializable'})}
 async authorize(s,scopeKey,write=false,db=this.db) {
   if (scopeKey!=='shared' && (!this.application || this.application.key!==scopeKey)) fail('NOT_FOUND','素材范围不存在',404)
   const account=await db.account.findUnique({where:{id:s.id},include:{role:true}})
   const prefix=scopeKey==='shared'?'core.materials':scopeKey+':materials'
   if(!account || account.deletedAt || !account.role.enabled || !can(account,prefix+'.read')) fail('FORBIDDEN','没有素材库查看权限',403)
   const canManageMaterials=can(account,prefix+'.write')
   if(write && !canManageMaterials) fail('FORBIDDEN','没有素材库管理权限',403)
   return {canManageMaterials}
 }
 async policy(){return this.storage.publicPolicy()}
 async expose(row) {
   const url='/api/admin/materials/'+encodeURIComponent(row.scopeKey)+'/'+row.id+'/content'
   return {id:row.id,name:row.name,kind:row.kind,mime:row.mime,bytes:row.bytes,provider:row.provider,source:labels[row.provider],groupId:row.groupId,visibility:row.scopeKey,status:row.status,version:row.version,createdAt:row.createdAt,url,thumbnail:row.kind==='image'?url+'?thumbnail=1':null}
 }
 async audit(db,s,scopeKey,action,details){await db.coreAuditEvent.create({data:{id:randomUUID(),actor:s.id,action,details:{...details,materialScope:scopeKey}}})}
 async row(db,scopeKey,id,ready=true){parse(z.string().uuid(),id);const row=await db.coreMaterial.findFirst({where:{id,...scopeOf(scopeKey),deletedAt:null}});if(!row)fail('NOT_FOUND','素材不存在或不可访问',404);if(ready&&row.status!=='ready')fail('MATERIAL_NOT_READY','素材尚未就绪，请刷新后重试',409);return row}
 async list(s,scopeKey,input){
  const q=parse(z.object({kind,purpose,q:z.string().trim().max(100).default(''),group:z.union([z.enum(['all','none']),z.string().uuid()]).default('all'),source:z.enum(['all','local','qiniu','oss','cos','legacy']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)}).strict(),input);
  const tenant=await this.authorize(s,scopeKey),where={...scopeOf(scopeKey),deletedAt:null,kind:q.kind,...(q.q?{name:{contains:q.q}}:{}),...(q.source==='all'?{}:{provider:q.source}),...(q.group==='all'?{}:{groupId:q.group==='none'?null:q.group})};
  const [items,total,groups]=await this.db.$transaction([this.db.coreMaterial.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],take:q.pageSize,skip:(q.page-1)*q.pageSize}),this.db.coreMaterial.count({where}),this.db.coreMaterialGroup.findMany({where:{...scopeOf(scopeKey),kind:q.kind},orderBy:[{createdAt:'asc'},{id:'asc'}]})]);
  const policy=await this.policy(tenant),canManage=tenant.canManageMaterials;return{items:await Promise.all(items.map(row=>this.expose(row))),total,groups,canManage,canUpload:canManage&&!!policy.revisionId,policy};
 }
 async checkGroup(db,scopeKey,id,type){if(id&&!await db.coreMaterialGroup.count({where:{id,...scopeOf(scopeKey),kind:type}}))fail('MATERIAL_GROUP_INVALID','分组不存在或不属于当前范围和分类',409)}
 async upload(s,scopeKey,input,bytes){
  const q=parse(z.object({purpose,kind,name,requestId:z.string().uuid(),groupId:groupId.default(null),storageRevision:z.string().uuid()}).strict(),input),tenant=await this.authorize(s,scopeKey,true),policy=await this.policy(tenant,true);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>policy.maxFileMb*1024*1024)fail('MATERIAL_SIZE_INVALID','文件为空或超过当前存储大小限制');
  const hash=createHash('sha256').update(bytes).digest('hex'),prior=await this.db.coreMaterial.findUnique({where:{id:q.requestId}});
  if(prior){if(prior.scopeKey!==scopeKey||prior.ownerId!==s.id||prior.hash!==hash||prior.deletedAt)fail('MATERIAL_REQUEST_CONFLICT','上传请求已使用，请重新选择文件',409);if(prior.status!=='ready')fail('MATERIAL_NOT_READY','上次上传尚未完成，请刷新素材列表',409);return this.expose(prior)}
  if(policy.revisionId!==q.storageRevision)fail('MATERIAL_STORAGE_CHANGED','存储配置已改变，请刷新后重新上传',409);
  const revision=await this.storage.revision(policy.revisionId),normalized=await normalizeMaterial(bytes,q.name);
  if(normalized.kind!==q.kind)fail('MATERIAL_KIND_INVALID','文件实际类型与当前分类不一致，请切换对应分类');
  const id=q.requestId,objectKey=`instance/${scopeKey==='shared'?'shared':'applications/'+scopeKey}/materials/${id}.${normalized.extension}`;
  try{await this.transaction(async tx=>{const current=await this.authorize(s,scopeKey,true,tx);if((await this.policy(current,true)).revisionId!==q.storageRevision)fail('MATERIAL_STORAGE_CHANGED','存储配置已改变，请刷新后重新上传',409);await this.checkGroup(tx,scopeKey,q.groupId,q.kind);await tx.coreMaterial.create({data:{id,...scopeOf(scopeKey),name:normalized.name,kind:q.kind,mime:normalized.mime,bytes:normalized.data.length,hash,provider:revision.provider,revisionId:revision.id,objectKey,ownerId:s.id,groupId:q.groupId,status:'uploading'}})})}catch(e){if(e.code==='P2002')fail('MATERIAL_NOT_READY','该文件正在上传，请刷新后重试',409);throw e}
  this.busy.add(id);
  try{
   await this.storage.providers.put(revision.provider,revision.config,this.storage.credentials(revision),objectKey,normalized.data,normalized.mime);
   const row=await this.transaction(async tx=>{const current=await this.authorize(s,scopeKey,true,tx);await this.policy(current,true);const saved=await tx.coreMaterial.update({where:{id},data:{status:'ready'}});await this.audit(tx,s,scopeKey,'material.upload',{materialId:id,name:saved.name,kind:saved.kind});return saved});return this.expose(row);
  }catch{await this.db.coreMaterial.updateMany({where:{id,...scopeOf(scopeKey),status:'uploading'},data:{status:'failed'}}).catch(()=>{});fail('MATERIAL_UPLOAD_FAILED','上传未完成，记录已保留，可在素材库中删除后重试',503)}finally{this.busy.delete(id)}
 }
 async streamContent(s,scopeKey,id,input,range){
  const q=parse(z.object({purpose,thumbnail:z.enum(['0','1']).default('0')}).strict(),input);await this.authorize(s,scopeKey);const row=await this.row(this.db,scopeKey,id);
  if(q.thumbnail==='1')return this.content(s,scopeKey,id,input);
  const revision=await this.storage.revision(row.revisionId),file=await this.storage.providers.stream(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey,row.bytes,range);
  try{await this.authorize(s,scopeKey)}catch(e){file.stream.destroy();throw e}
  return{...file,mime:row.mime,name:row.name,inline:row.kind!=='file'};
 }
 async content(s,scopeKey,id,input){
  const q=parse(z.object({purpose,thumbnail:z.enum(['0','1']).default('0')}).strict(),input);await this.authorize(s,scopeKey);const row=await this.row(this.db,scopeKey,id);
  let data;try{const revision=await this.storage.revision(row.revisionId);data=await this.storage.providers.get(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey,100*1024*1024);if(q.thumbnail==='1'&&row.kind==='image')data=await sharp(data).resize(320,240,{fit:'inside',withoutEnlargement:true}).webp({quality:75}).toBuffer()}catch{fail('MATERIAL_READ_FAILED','素材读取失败，请检查原存储配置',503)}
  await this.authorize(s,scopeKey);return{data,mime:q.thumbnail==='1'&&row.kind==='image'?'image/webp':row.mime,name:row.name,inline:row.kind!=='file'};
 }
 async select(s,scopeKey,id,input){
  const q=parse(z.object({purpose,...selectionTransform,siteKind:z.enum(['icon','logo','login','avatar']).optional()}).strict(),input)
  await this.authorize(s,scopeKey)
  const row=await this.row(this.db,scopeKey,id)
  if (q.purpose==='library') return this.expose(row)
  if(row.kind!=='image') fail('MATERIAL_KIND_INVALID','此字段只能选择图片')
  if(q.purpose==='policy') return {id,url:'/api/public/materials/'+id,previewUrl:(await this.expose(row)).url}
  const {data}=await this.content(s,scopeKey,id,{})
  return {id,value:await normalizeSelectedImage(data,q)}
 }
 async rename(s,scopeKey,id,input){
  const q=parse(z.object({name,version:z.number().int().positive()}).strict(),input);
  return this.transaction(async tx=>{await this.authorize(s,scopeKey,true,tx);await this.row(tx,scopeKey,id);const result=await tx.coreMaterial.updateMany({where:{id,...scopeOf(scopeKey),status:'ready',deletedAt:null,version:q.version},data:{name:q.name,version:{increment:1}}});if(!result.count)fail('MATERIAL_CONFLICT','素材已变更，请刷新',409);await this.audit(tx,s,scopeKey,'material.rename',{materialId:id,name:q.name});return{updated:true}});
 }
 async move(s,scopeKey,input){
  const q=parse(z.object({ids,kind,groupId}).strict(),input),unique=[...new Set(q.ids)];
  return this.transaction(async tx=>{await this.authorize(s,scopeKey,true,tx);await this.checkGroup(tx,scopeKey,q.groupId,q.kind);const where={id:{in:unique},...scopeOf(scopeKey),deletedAt:null,status:'ready',kind:q.kind};if(await tx.coreMaterial.count({where})!==unique.length)fail('MATERIAL_CONFLICT','所选素材已变更或不属于当前范围',409);const result=await tx.coreMaterial.updateMany({where,data:{groupId:q.groupId,version:{increment:1}}});await this.audit(tx,s,scopeKey,'material.move',{count:result.count,groupId:q.groupId});return{moved:result.count}});
 }
 async remove(s,scopeKey,input){
  const q=parse(z.object({ids}).strict(),input);await this.authorize(s,scopeKey,true);const results=[];
  for(const id of new Set(q.ids))try{
   const row=await this.row(this.db,scopeKey,id,false);
   if(this.busy.has(id)||row.status==='uploading'&&Date.now()-row.createdAt.getTime()<120000)fail('MATERIAL_BUSY','素材正在上传，请稍后重试',409);
   this.busy.add(id);try{
    await this.transaction(async tx=>{await this.authorize(s,scopeKey,true,tx);await tx.$queryRaw`SELECT id FROM qc_materials WHERE id=${id} FOR UPDATE`;await this.row(tx,scopeKey,id,false);if(await this.isReferenced(tx,id))fail('MATERIAL_IN_USE','素材仍在使用中，请先解除引用',409);await tx.coreMaterial.update({where:{id},data:{status:'deleting',version:{increment:1}}});await this.audit(tx,s,scopeKey,'material.delete.requested',{materialId:id})});
    const revision=await this.storage.revision(row.revisionId);await this.storage.providers.remove(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey);
    await this.db.$transaction(async tx=>{await tx.coreMaterial.update({where:{id},data:{status:'deleted',deletedAt:new Date()}});await this.audit(tx,s,scopeKey,'material.delete',{materialId:id})});results.push({id,deleted:true});
   }finally{this.busy.delete(id)}
  }catch(e){results.push({id,deleted:false,message:['MATERIAL_BUSY','MATERIAL_IN_USE'].includes(e.code)?e.message:'删除未完成，请刷新后重试'})}
  return{results,deleted:results.filter(row=>row.deleted).length,failed:results.filter(row=>!row.deleted).length};
 }
 async group(s,scopeKey,id,input,remove=false){
  const q=parse(remove?z.object({version:z.number().int().positive()}).strict():z.object({kind,name:name.refine(v=>v.length<=40),...(id?{version:z.number().int().positive()}:{requestId:z.string().uuid()})}).strict(),input);
  try{return await this.db.$transaction(async tx=>{
   await this.authorize(s,scopeKey,true,tx);
   if(!id){const prior=await tx.coreMaterialGroup.findUnique({where:{id:q.requestId}});if(prior){if(prior.scopeKey!==scopeKey||prior.kind!==q.kind||prior.name!==q.name)fail('MATERIAL_CONFLICT','分组请求已使用',409);return prior}const row=await tx.coreMaterialGroup.create({data:{id:q.requestId,...scopeOf(scopeKey),kind:q.kind,name:q.name}});await this.audit(tx,s,scopeKey,'material.group.create',{groupId:row.id,name:row.name});return row}
   const old=await tx.coreMaterialGroup.findFirst({where:{id,...scopeOf(scopeKey)}});if(!old||old.version!==q.version)fail('MATERIAL_CONFLICT','分组已变更，请刷新',409);
   if(remove){await tx.coreMaterial.updateMany({where:{...scopeOf(scopeKey),groupId:id},data:{groupId:null,version:{increment:1}}});await tx.coreMaterialGroup.delete({where:{id}})}else{if(q.kind!==old.kind)fail('MATERIAL_GROUP_INVALID','不能改变分组所属分类');await tx.coreMaterialGroup.update({where:{id},data:{name:q.name,version:{increment:1}}})}
   await this.audit(tx,s,scopeKey,remove?'material.group.delete':'material.group.rename',{groupId:id});return{updated:true};
  },{isolationLevel:'Serializable'})}catch(e){if(e.code==='P2002')fail('MATERIAL_GROUP_EXISTS','当前范围和分类下已有同名分组',409);throw e}
 }
}
