import {applicationDecorationContent} from './decoration-application.mjs';
import {randomBytes} from 'node:crypto';
import QRCode from 'qrcode';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {validateDecoration} from './tenant-decoration.mjs';
import {decorationImageIds} from './decoration-contract.mjs';
import {fail} from './errors.mjs';
export class DecorationPreviews {
 constructor(db,storage){this.db=db;this.storage=storage;this.apps=new TenantApplications(db);this.entries=new Map()}
 async create(s,tenantId,key,body,origin){
  const q=z.object({name:z.string().trim().min(1).max(40),page:z.enum(['home','profile']),scheme:z.unknown()}).strict().safeParse(body);if(!q.success)fail('PREVIEW_INVALID','预览内容无效');
  await this.apps.admin(s,tenantId,key,'settings.read');const adapter=application(key).decoration;if(!adapter)fail('PREVIEW_INVALID','应用不支持装修');const scheme=validateDecoration(q.data.scheme,adapter),ids=decorationImageIds(scheme);
  if(ids.length&&await this.db.tenantMaterial.count({where:{id:{in:ids},tenantId,scopeKey:key,kind:'image',status:'ready',deletedAt:null}})!==ids.length)fail('PREVIEW_INVALID','预览图片已失效或不属于当前应用');
  let base;try{base=new URL(process.env.PUBLIC_ADMIN_ORIGIN||origin)}catch{fail('PREVIEW_ORIGIN_INVALID','预览访问地址尚未配置')}
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password)fail('PREVIEW_ORIGIN_INVALID','预览访问地址无效');
  const now=Date.now();for(const [token,row] of this.entries)if(row.expiresAt<=now)this.entries.delete(token);
  const own=[...this.entries].filter(([,r])=>r.s.id===s.id&&r.tenantId===tenantId&&r.key===key);while(own.length>=5)this.entries.delete(own.shift()[0]);if(this.entries.size>=500)fail('PREVIEW_BUSY','预览数量较多，请稍后再试',503);
  const token=randomBytes(24).toString('base64url'),expiresAt=now+20*60*1000,url=base.origin+'/decoration-preview/'+token;
  this.entries.set(token,{s,tenantId,key,scheme,name:q.data.name,page:q.data.page,expiresAt});
  return {url,qr:await QRCode.toDataURL(url,{width:256,margin:2,errorCorrectionLevel:'M'}),expiresAt:new Date(expiresAt).toISOString(),localOnly:['localhost','127.0.0.1','[::1]'].includes(base.hostname)};
 }
 async entry(token){const row=this.entries.get(token);if(!row||row.expiresAt<=Date.now()){this.entries.delete(token);fail('PREVIEW_EXPIRED','预览已失效，请重新生成',410)}await this.apps.admin(row.s,row.tenantId,row.key,'settings.read');return row}
 async view(token){const row=await this.entry(token),content=await applicationDecorationContent(this.db,{tenantId:row.tenantId,applicationKey:row.key});await this.entry(token);return {assets:content.assets,components:content.components,name:row.name,scheme:row.scheme,page:row.page,targets:application(row.key).decoration.targets,expiresAt:new Date(row.expiresAt).toISOString()}}
 async image(token,id){const preview=await this.entry(token);if(!decorationImageIds(preview.scheme).includes(id))fail('NOT_FOUND','预览图片不存在',404);const row=await this.db.tenantMaterial.findFirst({where:{id,tenantId:preview.tenantId,scopeKey:preview.key,kind:'image',status:'ready',deletedAt:null}});if(!row)fail('NOT_FOUND','预览图片不存在',404);const file=await this.storage.delivery(row);try{await this.entry(token)}catch(e){file.stream?.destroy();throw e}return {...file,mime:row.mime}}
}
