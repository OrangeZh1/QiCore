import {formValidationMessage} from './form-validation.mjs';
import {applicationDecorationContent} from './decoration-application.mjs';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import {application,applicationCatalog} from '../applications/registry.mjs';
import {frameworkKey} from '../applications/framework.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {fail} from './errors.mjs';
import {enterpriseId} from './standalone-edition.mjs';
import {Resolver} from 'node:dns/promises';
import {h5Origin,h5Domain,savedH5Domain,h5DomainProof,h5EntryUrl,h5Host,isH5PlatformHost} from './h5-entry.mjs';
import {readConsumerSettings,readCustomerService} from './tenant-consumer-settings.mjs';
import {decorationImageIds,decorationTheme} from './decoration-contract.mjs';
import {consumerPolicies} from './consumer-consent.mjs';
import {normalizeAccountImage} from './account-image.mjs';
const scope=(tenantId,applicationKey)=>({tenantId_applicationKey:{tenantId,applicationKey}});
export function validH5Url(value){if(!value)return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash}catch{return false}}
const config=z.object({displayName:z.string().trim().min(1).max(64),favicon:z.string().max(120000).nullable().optional(),customDomain:z.string().trim().max(253).optional(),entryUrl:z.string().trim().max(1000).refine(validH5Url,'须为 HTTPS 地址，不能包含账号、密码、查询参数或片段，可留空').optional()}).strict().refine(v=>v.customDomain!==undefined||v.entryUrl!==undefined,{path:['customDomain'],message:'请填写独立域名或访问地址'});
export class TenantH5 {
 constructor(db,storage,options={}){this.db=db;this.storage=storage;this.apps=new TenantApplications(db);this.officialSettings=options.officialSettings||null;const resolver=new Resolver({timeout:2000,tries:1});this.resolveTxt=options.resolveTxt||resolver.resolveTxt.bind(resolver);this.dnsCache=new Map()}
 context(db,s,tenantId,key){return this.apps.featureContext(db,s,tenantId,key,'consumers','settings.read')}
 async channels(s,tenantId,input={}){
  const parsed=z.object({applicationKey:z.string().min(1).max(64).optional()}).strict().safeParse(input);if(!parsed.success)fail('H5_INPUT_INVALID',formValidationMessage(parsed.error));
  const ctx=await this.context(this.db,s,tenantId,parsed.data.applicationKey),key=ctx.selected?.key,app=key?application(key):null;
  await this.context(this.db,s,tenantId,key);
  return{applicationKey:key||null,applications:ctx.sources,channels:app?[
   ...(app.wechatMini?[{key:'mini-program',name:'微信小程序',description:'小程序接入、版本预览与上传',path:'/tenant/mini-program',icon:'i-lucide-smartphone'}]:[]),
   ...(app.wechatOfficial?[{key:'official-account',name:'微信公众号',description:'公众号接入、菜单与自动回复',path:'/tenant/official-account',icon:'i-lucide-message-circle'}]:[]),
   {key:'h5',name:'H5端',description:'手机网页访问地址与入口二维码',path:'/tenant/h5',icon:'i-lucide-globe'}]:[]};
 }
 async view(s,tenantId,input={}){
  const q=z.object({applicationKey:z.string().min(1).max(64).optional(),page:z.enum(['home','profile']).optional()}).strict().safeParse(input);if(!q.success)fail('H5_INPUT_INVALID',formValidationMessage(q.error,{page:'页面'}));
  const ctx=await this.context(this.db,s,tenantId,q.data.applicationKey),key=ctx.selected?.key,row=key?await this.db.tenantH5Setting.findUnique({where:scope(tenantId,key)}):null;
  const customDomain=savedH5Domain(row?.entryUrl),value={displayName:row?.displayName||'H5端',favicon:row?.favicon||null,customDomain},entryUrl=key?h5EntryUrl(tenantId):'';
  const previewUrl=entryUrl+(q.data.page==='profile'?'profile':''),qrCode=entryUrl?await QRCode.toDataURL(previewUrl,{width:240,margin:1}):null,current=await this.context(this.db,s,tenantId,key);
  return{applicationKey:key||null,applications:ctx.sources,canWrite:current.permissions.includes('settings.write'),version:row?.version||0,config:value,entryUrl,previewUrl,customUrl:customDomain?'https://'+customDomain+'/':null,domainProof:customDomain?{name:'_qicore-h5.'+customDomain,value:h5DomainProof(tenantId,key,customDomain),target:h5Origin().hostname}:null,configured:!!key,updatedAt:row?.updatedAt||null,qrCode};
 }
 async save(s,tenantId,key,input){
  const q=z.object({version:z.number().int().nonnegative(),config}).strict().safeParse(input);if(!q.success)fail('H5_INPUT_INVALID',formValidationMessage(q.error,{displayName:'H5渠道名称'}));
  let domain;try{domain=h5Domain(q.data.config.customDomain??savedH5Domain(q.data.config.entryUrl))}catch(e){fail('H5_INPUT_INVALID',e.message)}
  if(domain&&domain===h5Origin().hostname)fail('H5_INPUT_INVALID','独立域名不能使用平台域名');
  const entryUrl=domain?'https://'+domain:'';
  await this.apps.admin(s,tenantId,key,'settings.write');
  const favicon=q.data.config.favicon===undefined?undefined:await normalizeAccountImage(q.data.config.favicon,{storage:this.storage,siteId:tenantId,size:100,fit:'contain'});
  await this.apps.transaction(async db=>{await this.apps.admin(s,tenantId,key,'settings.write',db,true);await this.context(db,s,tenantId,key);const where=scope(tenantId,key),old=await db.tenantH5Setting.findUnique({where});if((old?.version||0)!==q.data.version)fail('H5_CONFLICT','H5 配置已更新，请重新读取后编辑',409);
   // Serializable transactions protect the domain range, including concurrent first bindings.
   if(domain){if(await db.tenant.findFirst({where:{customDomain:domain},select:{id:true}}))fail('H5_DOMAIN_IN_USE','该域名已用作租户后台域名',409);const bound=await db.tenantH5Setting.findMany({where:{entryUrl:{startsWith:'https://'+domain}}});if(bound.some(row=>savedH5Domain(row.entryUrl)===domain&&(row.tenantId!==tenantId||row.applicationKey!==key)))fail('H5_DOMAIN_IN_USE','该域名已绑定其他站点或应用',409)}
   await db.tenantH5Setting.upsert({where,create:{tenantId,applicationKey:key,displayName:q.data.config.displayName,entryUrl,favicon},update:{displayName:q.data.config.displayName,entryUrl,favicon,version:{increment:1}}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'channel.h5.save',details:{version:q.data.version+1,fields:['displayName','customDomain',...(favicon!==undefined?['favicon']:[])],...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,{applicationKey:key});
 }
 async verified(tenantId,key,domain,fresh=false){
  const name='_qicore-h5.'+domain,now=Date.now(),cached=this.dnsCache.get(name);let records=cached?.expiresAt>now&&!fresh?cached.records:null;
  if(!records){try{records=(await this.resolveTxt(name)).map(row=>row.join(''))}catch{records=[]}if(this.dnsCache.size>=256)this.dnsCache.clear();this.dnsCache.set(name,{records,expiresAt:now+60000})}
  return records.includes(h5DomainProof(tenantId,key,domain));
 }
 async checkDomain(s,tenantId,key){await this.context(this.db,s,tenantId,key);const row=await this.db.tenantH5Setting.findUnique({where:scope(tenantId,key)}),domain=savedH5Domain(row?.entryUrl);if(!domain)fail('H5_DOMAIN_REQUIRED','请先保存独立域名');const verified=await this.verified(tenantId,key,domain,true);await this.context(this.db,s,tenantId,key);return{verified,domain,message:verified?'域名归属已验证，请确认解析和 HTTPS 配置已完成':'尚未找到匹配的 TXT 记录，请检查解析后重试'}}
 async resolve(input){
  const parsed=z.object({host:z.string().min(1).max(300),tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线').optional(),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/,'须为 1–64 个小写字母、数字或短横线，以字母或数字开头').optional()}).strict().safeParse(input);if(!parsed.success)fail('H5_INPUT_INVALID','H5 访问地址无效',404);
  const q=parsed.data;let host;try{host=h5Host(q.host)}catch{fail('H5_INPUT_INVALID','H5 访问域名无效',404)}
  const tenantId=enterpriseId(this.db);
  if(q.tenantId!==undefined&&q.tenantId!==tenantId)fail('H5_SCOPE_MISMATCH','站点范围不匹配',404);
  // Host identifies the public origin only; it never selects an enterprise.
  const canonical=isH5PlatformHost(host)||host===new URL(process.env.ADMIN_ORIGIN||h5Origin().origin).host;
  let key=q.applicationKey;
  const bindings=await this.db.tenantApplication.findMany({where:{tenantId,activeSlot:1},select:{applicationKey:true,enabled:true,expiresAt:true}});if(bindings.length>1)fail('H5_APPLICATION_REQUIRED','站点应用绑定异常，请联系管理员',409);
  const bound=bindings[0],current=bound?.enabled&&(!bound.expiresAt||bound.expiresAt>new Date())&&applicationCatalog().some(app=>app.key===bound.applicationKey)&&this.apps.licenseAllowed(bound.applicationKey)?bound.applicationKey:frameworkKey;
  if(key&&key!==current)fail('H5_SCOPE_MISMATCH','访问地址与当前站点内容不一致',404);key=current;
  if(!canonical){
   const inbound=new URL('http://'+host),setting=await this.db.tenantH5Setting.findUnique({where:scope(tenantId,key)});
   if(inbound.port||!setting?.entryUrl||savedH5Domain(setting.entryUrl)!==inbound.hostname)fail('H5_DOMAIN_UNBOUND','请从当前实例的公开地址进入',404);
   if(!await this.verified(tenantId,key,inbound.hostname))fail('H5_DOMAIN_UNVERIFIED','域名归属尚未验证',403);
  }
  await this.apps.available(tenantId,key);if(!application(key).h5)fail('H5_UNAVAILABLE','当前应用尚未接入 H5',404);
  return{tenantId,applicationKey:key};
 }
 async runtime(input){
  const identity=await this.resolve(input),{tenantId,applicationKey:key}=identity,settings=await readConsumerSettings(this.db,tenantId,key),decoration=await this.db.tenantDecoration.findUnique({where:scope(tenantId,key)}),scheme=decoration?.published||application(key).decoration.defaults();
  let officialLogin=false;const official=await this.db.tenantOfficialAccountSetting.findUnique({where:scope(tenantId,key)});if(official?.config.appId&&official.keyCipher&&this.officialSettings){try{officialLogin=!!this.officialSettings.decrypt(official).appSecret}catch{}}
  const h5=await this.db.tenantH5Setting.findUnique({where:scope(tenantId,key)});
  return{...identity,contentSource:key===frameworkKey?'framework':'application',siteName:h5?.displayName||'H5端',apiBase:'/api/v1',favicon:h5?.favicon||null,homeTitle:scheme.home.title,profileTitle:scheme.profile.title,theme:decorationTheme(scheme),registration:settings.config.registration,policies:await consumerPolicies(this.db,tenantId,key),officialLogin};
 }
 async publicDecoration(input){const identity=await this.resolve(input),row=await this.db.tenantDecoration.findUnique({where:scope(identity.tenantId,identity.applicationKey)});const content=await applicationDecorationContent(this.db,identity),customerService=await readCustomerService(this.db,identity.tenantId,identity.applicationKey);await this.apps.available(identity.tenantId,identity.applicationKey);return{customerService,assets:content.assets,components:content.components,scheme:row?.published||application(identity.applicationKey).decoration.defaults(),targets:[...application(identity.applicationKey).decoration.targets,...content.targets],configured:!!row?.published,profile:null,member:null,version:row?.publishedAt?.toISOString()||'default'}}
 async image(input,id){
  const identity=await this.resolve(input),view=await this.publicDecoration(input);if(!decorationImageIds(view.scheme).includes(id))fail('NOT_FOUND','图片不存在',404);
  const row=await this.db.tenantMaterial.findFirst({where:{id,tenantId:identity.tenantId,scopeKey:identity.applicationKey,kind:'image',status:'ready',deletedAt:null}});if(!row)fail('NOT_FOUND','图片不存在',404);
  const file=await this.storage.delivery(row);try{await this.resolve(input)}catch(e){file.stream?.destroy();throw e}return{...file,mime:row.mime};
 }
}
