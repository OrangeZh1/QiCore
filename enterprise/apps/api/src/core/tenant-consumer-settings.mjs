import {formValidationMessage} from './form-validation.mjs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {normalizeAccountImage} from './account-image.mjs';
import {fail} from './errors.mjs';
import {consumerAuthAppearanceDefaults} from './consumer-auth-appearance.mjs';
import {customerServiceDefaults} from './customer-service.mjs';

export const consumerSettingDefaults=()=>({users:{prefix:'HY',digits:8,start:1,defaultAvatar:null},registration:{passwordLoginEnabled:true,smsLoginEnabled:false,showPolicies:false,autoRegister:true,appearance:consumerAuthAppearanceDefaults()}});
const users=z.object({prefix:z.string().trim().regex(/^[A-Za-z]{0,12}$/,'只能包含英文字母，最多 12 个字符，可留空'),digits:z.number().int().min(4).max(12),start:z.number().int().min(1).max(999999999),defaultAvatar:z.string().max(120000).nullable()}).strict();
const copy=max=>z.string().trim().max(max).refine(value=>!/[<>\u0000-\u001f\u007f]/.test(value),'不能包含尖括号或控制字符');
const customerImage=z.string().max(120000).refine(v=>/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v)||/^https:\/\//.test(v)||/^\/api\/v1\/public\/site-assets\/[a-f0-9-]{36}$/.test(v),'须选择已上传的图片').nullable().default(null);
export const customerServiceSchema=z.object({avatar:customerImage,qrCode:customerImage,miniMode:z.enum(['page','official']),phone:z.string().trim().max(30).refine(value=>!value||/^\+?\d{5,20}$/.test(value.replace(/[ -]/g,'')),'去除空格与短横线后须为 5–20 位数字，可带开头的 +，可留空'),wechat:copy(64),description:z.string().trim().max(1000).refine(value=>!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'不能包含尖括号或非换行控制字符')}).strict();
export function customerServiceConfig(value){const parsed=customerServiceSchema.safeParse({...customerServiceDefaults(),...value});return parsed.success?parsed.data:customerServiceDefaults()}
export async function readCustomerService(db,tenantId,applicationKey){const row=await db.tenantConsumerSetting.findUnique({where:scope(tenantId,applicationKey)});return customerServiceConfig(row?.config?.customerService)}
const authAppearance=z.object({image:z.string().max(120000).nullable(),brand:copy(64),loginTitle:copy(40),loginDescription:copy(120),registerTitle:copy(40),registerDescription:copy(120)}).strict();
const registration=z.object({appearance:authAppearance.optional(),passwordLoginEnabled:z.boolean(),smsLoginEnabled:z.boolean(),showPolicies:z.literal(false),autoRegister:z.boolean()}).strict();
const scope=(tenantId,applicationKey)=>({tenantId_applicationKey:{tenantId,applicationKey}});
export async function readConsumerSettings(db,tenantId,applicationKey){const row=await db.tenantConsumerSetting.findUnique({where:scope(tenantId,applicationKey)}),config=structuredClone(row?.config||consumerSettingDefaults());config.registration.appearance={...consumerAuthAppearanceDefaults(),...config.registration.appearance};config.customerService=customerServiceConfig(config.customerService);delete config.registration.requirePhone;delete config.registration.requireUserInfo;return{row,config}}
// Call only inside the existing tenant/application write transaction. Never renumber old identities.
export async function nextMemberNumber(db,tenantId,applicationKey){
 await db.$queryRaw`SELECT tenantId FROM TenantApplication WHERE tenantId=${tenantId} AND applicationKey=${applicationKey} FOR UPDATE`;
 const {row,config}=await readConsumerSettings(db,tenantId,applicationKey),sequence=Math.max(row?.nextNumber||1,config.users.start);
 if(sequence>999999999)fail('MEMBER_NUMBER_EXHAUSTED','会员编号序号已用尽，请联系管理员',409);
 await db.tenantConsumerSetting.upsert({where:scope(tenantId,applicationKey),create:{tenantId,applicationKey,config,nextNumber:sequence+1,version:0},update:{nextNumber:sequence+1}});
 return config.users.prefix+String(sequence).padStart(config.users.digits,'0');
}
export class TenantConsumerSettings {
 constructor(db,storage=null){this.db=db;this.storage=storage;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,key){return this.apps.featureContext(db,s,tenantId,key,'consumers','settings.read')}
 async view(s,tenantId,input={}){
  const q=z.object({applicationKey:z.string().min(1).max(64).optional()}).strict().safeParse(input);if(!q.success)fail('CONSUMER_SETTINGS_INVALID',formValidationMessage(q.error));
  const ctx=await this.context(this.db,s,tenantId,q.data.applicationKey);
  const values=ctx.selected?await readConsumerSettings(this.db,tenantId,ctx.selected.key):null;
  const tenant=await this.db.tenant.findUnique({where:{id:tenantId}}),brand=await this.db.tenantSiteSetting.findUnique({where:{tenantId}});
  const current=await this.context(this.db,s,tenantId,ctx.selected?.key);
  return{siteName:brand?.config.name||tenant?.name||'QiCore',applicationKey:ctx.selected?.key||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write'),version:values?.row?.version||0,config:values?.config||null,nextNumber:values?Math.max(values.row?.nextNumber||1,values.config.users.start):null};
 }
 async save(s,tenantId,key,section,body){
  const schema=section==='users'?users:section==='registration'?registration:section==='appearance'?authAppearance:section==='customerService'?customerServiceSchema:null;
  if(!schema)fail('CONSUMER_SETTINGS_INVALID','设置分类无效');
  const q=z.object({version:z.number().int().nonnegative(),config:schema}).strict().safeParse(body);
  if(!q.success)fail('CONSUMER_SETTINGS_INVALID',formValidationMessage(q.error,section==='customerService'?{phone:'客服电话',description:'客服说明'}:{}));
  await this.apps.admin(s,tenantId,key,'settings.write');await this.context(this.db,s,tenantId,key);
  const value=structuredClone(q.data.config);if(section==='users')value.defaultAvatar=await normalizeAccountImage(value.defaultAvatar,{storage:this.storage,siteId:tenantId});if(section==='appearance')value.image=await normalizeAccountImage(value.image,{storage:this.storage,siteId:tenantId,size:512,height:205});if(section==='registration'&&value.appearance)value.appearance.image=await normalizeAccountImage(value.appearance.image,{storage:this.storage,siteId:tenantId,size:512,height:205});
  if(section==='customerService'){value.avatar=await normalizeAccountImage(value.avatar,{storage:this.storage,siteId:tenantId});value.qrCode=await normalizeAccountImage(value.qrCode,{storage:this.storage,siteId:tenantId,size:512,fit:'contain',lossless:true})}
  await this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,key,'settings.write',db,true);await this.context(db,s,tenantId,key);
   const {row,config}=await readConsumerSettings(db,tenantId,key);if((row?.version||0)!==q.data.version)fail('CONSUMER_SETTINGS_CONFLICT','设置已更新，请重新读取后编辑',409);
   if(section==='appearance')config.registration.appearance=value;else config[section]={...config[section],...value};
   await db.tenantConsumerSetting.upsert({where:scope(tenantId,key),create:{tenantId,applicationKey:key,config,version:1},update:{config,version:{increment:1}}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'consumer.settings.save',details:{section,version:q.data.version+1,fields:Object.keys(value),...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,{applicationKey:key});
 }
 async publicCustomerService(input){
  const parsed=z.object({tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线'),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/,'须为 1–64 个小写字母、数字或短横线，以字母或数字开头')}).strict().safeParse(input);
  if(!parsed.success)fail('CONSUMER_SETTINGS_INVALID','站点参数无效');
  const {tenantId,applicationKey}=parsed.data;await this.apps.available(tenantId,applicationKey);
  const value=await readCustomerService(this.db,tenantId,applicationKey);await this.apps.available(tenantId,applicationKey);return value;
 }
}
