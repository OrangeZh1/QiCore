import {formValidationMessage} from './form-validation.mjs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {TenantMaterials} from './tenant-materials.mjs';
import {fail} from './errors.mjs';
const pageSchema=z.enum(['home','profile']),channelSchema=z.enum(['mini','official']);
const text=max=>z.string().trim().max(max).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符');
const config=channel=>z.object({title:text(30),imageId:z.string().uuid().nullable(),...(channel==='official'?{description:text(100)}:{})}).strict();
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail('PAGE_SHARING_INVALID',formValidationMessage(r.error,{title:'分享标题',description:'分享描述',...(schema===pageSchema?{'':'分享页面'}:schema===channelSchema?{'':'分享渠道'}:{})}));return r.data};
const defaults=channel=>({title:'',imageId:null,...(channel==='official'?{description:''}:{})});
const where=(tenantId,applicationKey,page,channel)=>({tenantId_applicationKey_page_channel:{tenantId,applicationKey,page,channel}});
export class TenantPageSharing {
 constructor(db,storage){this.db=db;this.storage=storage;this.apps=new TenantApplications(db);this.materials=new TenantMaterials(db,storage)}
 async view(s,tenantId,key,page){
  parse(pageSchema,page);const ctx=await this.apps.featureContext(this.db,s,tenantId,key,'decoration','settings.read');
  const rows=await this.db.tenantPageSharing.findMany({where:{tenantId,applicationKey:key,page}}),channels={};
  for(const channel of ['mini','official']){const row=rows.find(r=>r.channel===channel);channels[channel]={version:row?.version||0,config:row?.config||defaults(channel)}}
  return {page,applicationKey:key,canWrite:ctx.permissions.includes('settings.write'),channels};
 }
 async save(s,tenantId,key,page,channel,body){
  parse(pageSchema,page);parse(channelSchema,channel);const q=parse(z.object({version:z.number().int().nonnegative(),config:config(channel)}).strict(),body);
  await this.apps.admin(s,tenantId,key,'settings.write');
  await this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,key,'settings.write',db,true);await this.apps.featureContext(db,s,tenantId,key,'decoration','settings.read');
   const old=await db.tenantPageSharing.findUnique({where:where(tenantId,key,page,channel)});if((old?.version||0)!==q.version)fail('PAGE_SHARING_CONFLICT','分享设置已变更，请重新读取后修改',409);
   if(q.config.imageId){await this.materials.authorize(s,tenantId,key,false,db);if(!await db.tenantMaterial.findFirst({where:{id:q.config.imageId,tenantId,scopeKey:key,kind:'image',status:'ready',deletedAt:null}}))fail('PAGE_SHARING_IMAGE_INVALID','分享图片不存在或不属于当前应用')}
   await db.tenantPageSharing.upsert({where:where(tenantId,key,page,channel),create:{tenantId,applicationKey:key,page,channel,config:q.config,version:1},update:{config:q.config,version:{increment:1}}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'page.sharing.save',details:{page,channel,version:q.version+1,imageId:q.config.imageId,...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,key,page);
 }
 async publicView(tenantId,key,page,channel){
  parse(pageSchema,page);parse(channelSchema,channel);await this.apps.available(tenantId,key);
  const row=await this.db.tenantPageSharing.findUnique({where:where(tenantId,key,page,channel)}),value=row?.config||defaults(channel);
  const decoration=await this.db.tenantDecoration.findUnique({where:{tenantId_applicationKey:{tenantId,applicationKey:key}},select:{published:true}});
  const imagePath=value.imageId?'/public/page-sharing/'+[tenantId,key,page,channel].map(encodeURIComponent).join('/')+'/image?v='+(row?.version||0):null;
  return {title:value.title||decoration?.published?.[page]?.title||(page==='home'?'首页':'个人中心'),...(channel==='official'?{description:value.description||''}:{}),imagePath,version:row?.version||0};
 }
 async image(tenantId,key,page,channel){
  await this.publicView(tenantId,key,page,channel);const setting=await this.db.tenantPageSharing.findUnique({where:where(tenantId,key,page,channel)}),id=setting?.config?.imageId;
  if(!id)fail('NOT_FOUND','未设置分享图片',404);const row=await this.db.tenantMaterial.findFirst({where:{id,tenantId,scopeKey:key,kind:'image',status:'ready',deletedAt:null}});if(!row)fail('NOT_FOUND','分享图片不存在',404);
  const file=await this.storage.delivery(row);
  try{await this.apps.available(tenantId,key)}catch(e){file.stream?.destroy();throw e}return {...file,mime:row.mime};
 }
}
