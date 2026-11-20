import {formValidationMessage} from './form-validation.mjs';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {z} from 'zod';
import {fail} from './errors.mjs';

export const defaultSiteSettings={
  platform:{name:'QiCore',favicon:null,logo:null,loginImage:null,defaultAvatar:null,loginTitle:'平台与租户管理\n从这里开始。',loginDescription:'平台管理与租户业务分离，为每个租户提供清晰的管理边界。'},
  tenant:{name:'QiCore',favicon:null,logo:null,loginImage:null,defaultAvatar:null,loginTitle:'站点管理',loginDescription:'管理站点资源、成员和业务配置。'},
  copyright:'',filing:{icpNumber:'',icpLink:'',policeNumber:'',policeLink:''},
};
const text=max=>z.string().trim().max(max).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符');
const name=text(30).min(1),asset=z.string().max(2048).refine(v=>/^\/api\/v1\/public\/site-assets\/[a-f0-9-]{36}$/.test(v)||v.startsWith('https://'),'须选择已上传的网站图片').nullable();
const description=z.string().trim().max(200).refine(v=>!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'不能包含尖括号或非换行控制字符');
const link=z.string().trim().max(2048).refine(value=>{if(!value)return true;try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}},'须为 HTTP 或 HTTPS 链接，不能包含账号或密码，可留空');
const schema=z.object({
  version:z.number().int().positive(),
  platform:z.object({name,favicon:asset,logo:asset,loginImage:asset,defaultAvatar:asset,loginTitle:description,loginDescription:description}).strict(),
  tenant:z.object({name,favicon:asset,logo:asset,loginImage:asset,defaultAvatar:asset,loginTitle:description,loginDescription:description}).strict(),
  copyright:text(160),filing:z.object({icpNumber:text(80),icpLink:link,policeNumber:text(80),policeLink:link}).strict(),
}).strict();
export async function normalizeSiteImage(kind,bytes){
    let data,mime;
    try{
      const pipeline=sharp(bytes,{limitInputPixels:16000000,animated:false}).rotate(),meta=await pipeline.metadata();
      if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1)throw Error('FORMAT');
      if(kind==='icon'){data=await pipeline.resize(100,100,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();mime='image/png'}
      else{const size=kind==='login'?1600:256;data=await pipeline.resize(size,size,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();mime='image/webp'}
      if(data.length>1024*1024)throw Error('SIZE');
    }catch{fail('SITE_IMAGE_INVALID','图片无法处理，请使用较小的静态 JPG、PNG 或 WebP 图片')}
  return{data,mime};
}
export class SiteSettings {
  constructor(db,storage=null){this.db=db;this.storage=storage}
  allow(s,p){if(!s?._admin||s.role!=='root'||!s.permissions.includes(p))fail('FORBIDDEN','需要平台网站设置权限',403)}
  async init(){await this.db.siteSetting.upsert({where:{id:'platform'},update:{},create:{id:'platform',config:defaultSiteSettings}})}
  async publicView(){const row=await this.db.siteSetting.findUnique({where:{id:'platform'}});if(!row)fail('SITE_NOT_READY','网站设置尚未初始化',503);const {logoLight,logoDark,...platform}=row.config.platform;return{version:row.version,...row.config,platform:{...platform,logo:Object.hasOwn(platform,'logo')?platform.logo:logoLight||logoDark||null}}}
  async view(s){this.allow(s,'settings.read');return this.publicView()}
  async upload(s,kind,bytes){
    this.allow(s,'settings.write');if(!['icon','logo','login','avatar'].includes(kind)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>2*1024*1024)fail('SITE_IMAGE_INVALID','请选择 2 MB 以内的 JPG、PNG 或 WebP 图片');
    const {data,mime}=await normalizeSiteImage(kind,bytes);
    if(this.storage)return {url:await this.storage.saveImage(data,mime,{kind}),kind,mime};
    const id=randomUUID();await this.db.$transaction(async tx=>{await tx.siteAsset.create({data:{id,kind,mime,data}});await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:'__platform__',actor:s.id,action:'site.asset.upload',details:{assetId:id,kind}}})});
    return{url:'/api/v1/public/site-assets/'+id,kind,mime};
  }
  async image(id){if(!/^[a-f0-9-]{36}$/.test(id))fail('NOT_FOUND','资源不存在',404);const image=await this.db.siteAsset.findUnique({where:{id}});if(!image)fail('NOT_FOUND','资源不存在',404);return image}
  async save(s,body){
    this.allow(s,'settings.write');const parsed=schema.safeParse(body);if(!parsed.success)fail('SITE_INPUT_INVALID',formValidationMessage(parsed.error,{'platform.name':'平台名称','tenant.name':'网站名称'}));
    const {version,...config}=parsed.data;
    for(const area of ['platform','tenant'])for(const [field,url] of Object.entries(config[area])){
      if(!['favicon','logo','loginImage','defaultAvatar'].includes(field)||!url)continue;
      const expected=field==='favicon'?'icon':field==='loginImage'?'login':field==='defaultAvatar'?'avatar':'logo';
      const image=await this.db.siteAsset.findFirst({where:{siteId:null,...(url.startsWith('https://')?{publicUrl:url}:{id:url.split('/').at(-1)})},select:{kind:true}});
      if(image?.kind!==expected)fail('SITE_ASSET_INVALID','图片不存在或不适用于此字段，请重新上传');
    }
    await this.db.$transaction(async tx=>{const result=await tx.siteSetting.updateMany({where:{id:'platform',version},data:{config,version:{increment:1}}});if(!result.count)fail('SITE_CONFLICT','网站设置已被修改，请刷新后重试',409);await tx.audit.create({data:{scope:'platform',id:randomUUID(),tenantId:'__platform__',actor:s.id,action:'site.settings.save',details:{version:version+1}}})});
    return this.publicView();
  }
}
