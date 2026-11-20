import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {fileTypeFromBuffer} from 'file-type';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {normalizeSiteImage} from './site-settings.mjs';

export const selectionTransform={shape:z.enum(['square','banner']).optional(),fit:z.enum(['cover','contain']).optional(),size:z.number().int().refine(n=>[100,256,512].includes(n)).optional()};
export async function normalizeSelectedImage(bytes,options={}){let result;try{result=await sharp(bytes,{limitInputPixels:16000000,animated:false}).rotate().resize(options.size||256,options.shape==='banner'?Math.round((options.size||256)*.4):options.size||256,{fit:options.fit||'cover',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:80}).toBuffer()}catch{fail('MATERIAL_IMAGE_INVALID','图片无法解析或尺寸过大，请重新选择')}if(result.length>80000)fail('MATERIAL_IMAGE_INVALID','图片压缩后仍过大，请更换图片');return 'data:image/webp;base64,'+result.toString('base64')}
const kind=z.enum(['image','video','file']),purpose=z.enum(['library','profile','account','tenant','site']).default('library');
const name=z.string().trim().min(1).max(180).refine(v=>!/[<>\\/\u0000-\u001f\u007f]/.test(v));
const groupId=z.string().uuid().nullable(),ids=z.array(z.string().uuid()).min(1).max(100);
const providers=['local','qiniu','oss','cos','legacy'];
const labels={local:'本地存储',qiniu:'七牛云',oss:'阿里云 OSS',cos:'腾讯云 COS',legacy:'历史上传'};
function parse(schema,value){const r=schema.safeParse(value);if(!r.success)fail('MATERIAL_INPUT_INVALID','请检查素材名称、分类和请求内容');return r.data}
export async function normalizeMaterial(bytes,filename){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>100*1024*1024)fail('MATERIAL_SIZE_INVALID','请选择 100 MB 以内的非空文件');
  let detected;try{detected=await fileTypeFromBuffer(bytes)}catch{fail('MATERIAL_FORMAT_INVALID','文件内容不完整或格式无法识别')}
  if(/\.(png|jpe?g|webp)$/i.test(filename)&&!['image/jpeg','image/png','image/webp'].includes(detected?.mime))fail('MATERIAL_FORMAT_INVALID','图片内容与文件格式不匹配');
  if(detected?.mime.startsWith('image/')){
    if(!['image/jpeg','image/png','image/webp'].includes(detected.mime))fail('MATERIAL_FORMAT_INVALID','图片仅支持静态 JPG、PNG、WebP');
    try{const pipeline=sharp(bytes,{limitInputPixels:16000000,animated:false}),meta=await pipeline.metadata();if(meta.pages>1)throw Error('ANIMATED');const data=await pipeline.rotate().resize(2400,2400,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();return{data,kind:'image',mime:'image/webp',extension:'webp',name:filename.replace(/\.[^.]+$/,'').slice(0,170)+'.webp'}}catch{fail('MATERIAL_FORMAT_INVALID','图片无法解码或尺寸过大')}
  }
  if(['video/mp4','video/webm'].includes(detected?.mime))return{data:bytes,kind:'video',mime:detected.mime,extension:detected.ext,name:filename};
  // Other files are always attachments, never interpreted as a document on the application origin.
  return{data:bytes,kind:'file',mime:'application/octet-stream',extension:'bin',name:filename};
}
export class Materials{
  constructor(db,storage){this.db=db;this.storage=storage;this.busy=new Set()}
  allow(s,target='library',write=false){
    if(!s?._admin||s.role!=='root')fail('FORBIDDEN','需要平台账号身份',403);
    const required=target==='library'?(write?'materials.write':'materials.read'):target==='site'?'settings.write':target==='account'?'accounts.write':target==='tenant'?'tenants.write':target==='profile'?null:'invalid';
    if(required&&!s.permissions.includes(required))fail('FORBIDDEN','没有对应的素材操作权限',403);
  }
  scope(s){return s.permissions.includes('materials.read')?{OR:[{visibility:'platform'},{ownerId:s.id}]}:{ownerId:s.id}}
  async expose(row,target='library'){const direct=row.kind!=='file'&&row.status==='ready'&&row.revisionId?this.storage.publicUrl(await this.storage.revision(row.revisionId),row.objectKey):null;const url=direct||'/api/v1/admin/materials/'+row.id+'/content?purpose='+target;return{id:row.id,name:row.name,kind:row.kind,mime:row.mime,bytes:row.bytes,provider:row.provider,source:labels[row.provider],groupId:row.groupId,visibility:row.visibility,status:row.status,version:row.version,createdAt:row.createdAt,url,thumbnail:row.kind==='image'?(direct||url+'&thumbnail=1'):null}}
  async audit(db,s,action,details){await db.audit.create({data:{id:randomUUID(),scope:'platform',tenantId:'__platform__',actor:s.id,action,details}})}
  async get(s,id,target='library',ready=true){this.allow(s,target);const row=await this.db.material.findFirst({where:{id,deletedAt:null,...this.scope(s)}});if(!row)fail('NOT_FOUND','素材不存在或不可访问',404);if(ready&&row.status!=='ready')fail('MATERIAL_NOT_READY','素材尚未就绪，请刷新后重试',409);return row}
  async list(s,input){
    const q=parse(z.object({kind,purpose,q:z.string().trim().max(100).default(''),group:z.union([z.enum(['all','none']),z.string().uuid()]).default('all'),source:z.enum(['all',...providers]).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)}).strict(),input);this.allow(s,q.purpose);
    const where={...this.scope(s),deletedAt:null,kind:q.kind,...(q.q?{name:{contains:q.q}}:{}),...(q.source==='all'?{}:{provider:q.source}),...(q.group==='all'?{}:{groupId:q.group==='none'?null:q.group})};
    const [items,total,groups]=await this.db.$transaction([this.db.material.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],take:q.pageSize,skip:(q.page-1)*q.pageSize}),this.db.material.count({where}),this.db.materialGroup.findMany({where:{kind:q.kind},orderBy:[{createdAt:'asc'},{id:'asc'}]})]);
    const policy=await this.storage.publicPolicy();return{items:await Promise.all(items.map(r=>this.expose(r,q.purpose))),total,groups:s.permissions.includes('materials.read')?groups:[],canManage:s.permissions.includes('materials.read')&&s.permissions.includes('materials.write'),canUpload:q.purpose!=='library'||s.permissions.includes('materials.write'),policy};
  }
  async checkGroup(id,type,db=this.db){if(id&&!await db.materialGroup.findFirst({where:{id,kind:type}}))fail('MATERIAL_GROUP_INVALID','分组不存在或与素材分类不一致',409)}
  async upload(s,input,bytes){
    const q=parse(z.object({purpose,kind,name,requestId:z.string().uuid(),groupId:groupId.default(null),storageRevision:z.string().uuid()}).strict(),input);this.allow(s,q.purpose,true);
    if(!Buffer.isBuffer(bytes)||!bytes.length)fail('MATERIAL_SIZE_INVALID','请选择有效的非空文件');
    if(q.purpose!=='library'&&q.kind!=='image')fail('MATERIAL_KIND_INVALID','此字段仅支持图片');
    const hash=createHash('sha256').update(bytes).digest('hex'),prior=await this.db.material.findUnique({where:{id:q.requestId}});
    if(prior){if(prior.ownerId!==s.id||prior.hash!==hash||prior.deletedAt)fail('MATERIAL_REQUEST_CONFLICT','上传请求已使用，请重新选择文件',409);if(prior.status!=='ready')fail('MATERIAL_NOT_READY','上次上传尚未完成，请刷新素材列表',409);return this.expose(prior,q.purpose)}
    const revision=await this.storage.revision((await this.storage.state()).activeRevisionId);
    if(revision.id!==q.storageRevision)fail('MATERIAL_STORAGE_CHANGED','存储配置已改变，请刷新后重新上传',409);
    if(!Buffer.isBuffer(bytes)||bytes.length>revision.config.maxFileMb*1024*1024)fail('MATERIAL_SIZE_INVALID','文件超过当前存储大小限制');
    const normalized=await normalizeMaterial(bytes,q.name);if(normalized.kind!==q.kind)fail('MATERIAL_KIND_INVALID','文件实际类型与当前分类不一致，请切换对应分类');
    const visibility=q.purpose!=='profile'&&s.permissions.includes('materials.write')&&s.permissions.includes('materials.read')?'platform':'personal';
    if(q.groupId&&visibility!=='platform')fail('FORBIDDEN','个人素材不能放入平台分组',403);await this.checkGroup(q.groupId,q.kind);
    const id=q.requestId,objectKey=`platform/materials/${id}.${normalized.extension}`;
    let row;try{row=await this.db.material.create({data:{id,name:normalized.name,kind:q.kind,mime:normalized.mime,bytes:normalized.data.length,hash,provider:revision.provider,revisionId:revision.id,objectKey,ownerId:s.id,visibility,groupId:q.groupId,status:'uploading'}})}catch(e){if(e.code==='P2002')fail('MATERIAL_NOT_READY','该文件正在上传，请刷新后重试',409);throw e}
    this.busy.add(id);
    try{await this.storage.providers.put(revision.provider,revision.config,this.storage.credentials(revision),objectKey,normalized.data,normalized.mime);row=await this.db.$transaction(async tx=>{const saved=await tx.material.update({where:{id},data:{status:'ready'}});await this.audit(tx,s,'material.upload',{materialId:id,name:saved.name,kind:saved.kind,provider:saved.provider});return saved});return this.expose(row,q.purpose)}
    catch{await this.db.material.update({where:{id},data:{status:'failed'}}).catch(()=>{});fail('MATERIAL_UPLOAD_FAILED','上传未完成，记录已保留，可在素材库中重试删除',503)}finally{this.busy.delete(id)}
  }
  async bytes(row){if(row.legacySiteAssetId){const old=await this.db.siteAsset.findUnique({where:{id:row.legacySiteAssetId}});if(!old)fail('NOT_FOUND','原素材文件不可用',404);return Buffer.from(old.data)}const revision=await this.storage.revision(row.revisionId);return this.storage.providers.get(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey,100*1024*1024)}
  async streamContent(s,id,input,range){
    const q=parse(z.object({purpose,thumbnail:z.enum(['0','1']).default('0')}).strict(),input),row=await this.get(s,id,q.purpose);
    const direct=row.kind!=='file'&&row.revisionId?this.storage.publicUrl(await this.storage.revision(row.revisionId),row.objectKey):null;if(direct)return{redirect:direct,mime:row.mime,name:row.name,inline:row.kind!=='file'};
    if(q.thumbnail==='1'||row.legacySiteAssetId)return this.content(s,id,input);
    const revision=await this.storage.revision(row.revisionId),file=await this.storage.providers.stream(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey,row.bytes,range);
    return{...file,mime:row.mime,name:row.name,inline:row.kind!=='file'};
  }
  async content(s,id,input){const q=parse(z.object({purpose,thumbnail:z.enum(['0','1']).default('0')}).strict(),input),row=await this.get(s,id,q.purpose);let data;try{data=await this.bytes(row);if(q.thumbnail==='1'&&row.kind==='image')data=await sharp(data).resize(320,240,{fit:'inside',withoutEnlargement:true}).webp({quality:75}).toBuffer()}catch(e){if(e.code==='NOT_FOUND')throw e;fail('MATERIAL_READ_FAILED','素材读取失败，请检查原存储配置',503)}return{data,mime:q.thumbnail==='1'&&row.kind==='image'?'image/webp':row.mime,name:row.name,inline:row.kind!=='file'}}
  async select(s,id,body){
    const q=parse(z.object({purpose,siteKind:z.enum(['icon','logo','login','avatar']).optional(),...selectionTransform}).strict(),body),row=await this.get(s,id,q.purpose);
    if(q.purpose==='library')return this.expose(row,q.purpose);
    if(row.kind!=='image')fail('MATERIAL_KIND_INVALID','此字段只能选择图片');
    const bytes=await this.bytes(row);let value;
    if(q.purpose==='site'){
      if(!q.siteKind)fail('MATERIAL_INPUT_INVALID','请选择图片用途');
      const {data,mime}=await normalizeSiteImage(q.siteKind,bytes);
      value=await this.storage.saveImage(data,mime,{kind:q.siteKind});
    }else{const image=await normalizeSelectedImage(bytes,q);value=await this.storage.saveImage(Buffer.from(image.split(',')[1],'base64'),'image/webp',{kind:'avatar'})}
    await this.audit(this.db,s,'material.select',{materialId:id,purpose:q.purpose});return{id,value};
  }
  async rename(s,id,body){this.allow(s,'library',true);const q=parse(z.object({name,version:z.number().int().positive()}).strict(),body);await this.get(s,id);return this.db.$transaction(async tx=>{const changed=await tx.material.updateMany({where:{id,deletedAt:null,status:'ready',version:q.version,...this.scope(s)},data:{name:q.name,version:{increment:1}}});if(!changed.count)fail('MATERIAL_CONFLICT','素材已变更，请刷新后重试',409);await this.audit(tx,s,'material.rename',{materialId:id,name:q.name});return{updated:true}})}
  async move(s,body){this.allow(s,'library',true);const q=parse(z.object({ids,kind,groupId}).strict(),body);return this.db.$transaction(async tx=>{await this.checkGroup(q.groupId,q.kind,tx);const where={id:{in:[...new Set(q.ids)]},...this.scope(s),deletedAt:null,status:'ready',kind:q.kind};if(await tx.material.count({where})!==new Set(q.ids).size)fail('MATERIAL_CONFLICT','所选素材已变更，请刷新后重试',409);const result=await tx.material.updateMany({where,data:{groupId:q.groupId,version:{increment:1}}});await this.audit(tx,s,'material.move',{count:result.count,groupId:q.groupId});return{moved:result.count}},{isolationLevel:'Serializable'})}
  async remove(s,body){this.allow(s,'library',true);const q=parse(z.object({ids}).strict(),body),results=[];
    for(const id of new Set(q.ids))try{const row=await this.get(s,id,'library',false);if(this.busy.has(id)||row.status==='uploading'&&Date.now()-row.createdAt.getTime()<120000)fail('MATERIAL_BUSY','素材正在上传，请稍后重试',409);this.busy.add(id);try{
      await this.db.$transaction(async tx=>{await tx.material.update({where:{id},data:{status:'deleting',version:{increment:1}}});await this.audit(tx,s,'material.delete.requested',{materialId:id,name:row.name})});
      if(row.objectKey){const revision=await this.storage.revision(row.revisionId);await this.storage.providers.remove(revision.provider,revision.config,this.storage.credentials(revision),row.objectKey)}
      await this.db.$transaction(async tx=>{await tx.material.update({where:{id},data:{status:'deleted',deletedAt:new Date()}});await this.audit(tx,s,'material.delete',{materialId:id,name:row.name})});results.push({id,deleted:true});
    }finally{this.busy.delete(id)}}catch(e){results.push({id,deleted:false,message:e.code==='MATERIAL_BUSY'?e.message:'删除未完成，请刷新后重试'})}
    return{results,deleted:results.filter(r=>r.deleted).length,failed:results.filter(r=>!r.deleted).length};
  }
  async group(s,id,body,remove=false){this.allow(s,'library',true);const q=parse(remove?z.object({version:z.number().int().positive()}).strict():z.object({kind,name:name.refine(v=>v.length<=40),...(id?{version:z.number().int().positive()}:{requestId:z.string().uuid()})}).strict(),body);
    try{return await this.db.$transaction(async tx=>{
      if(!id){const previous=await tx.materialGroup.findUnique({where:{id:q.requestId}});if(previous){if(previous.name!==q.name||previous.kind!==q.kind)fail('MATERIAL_CONFLICT','分组请求内容已改变',409);return previous}const created=await tx.materialGroup.create({data:{id:q.requestId,name:q.name,kind:q.kind}});await this.audit(tx,s,'material.group.create',{groupId:created.id,name:q.name});return created}
      const old=await tx.materialGroup.findUnique({where:{id}});if(!old||old.version!==q.version)fail('MATERIAL_CONFLICT','分组已变更，请刷新后重试',409);if(remove)await tx.materialGroup.delete({where:{id}});else{if(old.kind!==q.kind)fail('MATERIAL_GROUP_INVALID','不能改变分组所属分类');await tx.materialGroup.update({where:{id},data:{name:q.name,version:{increment:1}}})}await this.audit(tx,s,remove?'material.group.delete':'material.group.rename',{groupId:id,name:remove?old.name:q.name});return{updated:true};
    },{isolationLevel:'Serializable'})}catch(e){if(e.code==='P2002')fail('MATERIAL_GROUP_EXISTS','该分类下已有同名分组',409);throw e}
  }
}
