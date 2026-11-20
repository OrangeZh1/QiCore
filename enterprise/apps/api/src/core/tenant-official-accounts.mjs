import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {application} from '../applications/registry.mjs';
import {TenantApplications} from '../applications/service.mjs';
import {fail} from './errors.mjs';

const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/,'须为 1–64 个英文字母、数字、下划线或短横线');
import {officialAccountDefaults,officialAccountConfig,officialMenuPayload,officialMaterialRefs} from '../channels/official-account-config.mjs';
import {officialCallback} from '../channels/official-account-callback.mjs';
import {OfficialAccountClient} from '../channels/official-account-client.mjs';
import sharp from 'sharp';
import {miniProgramDomains} from '../channels/mini-domains.mjs';
export {officialAccountDefaults,officialAccountConfig};
const parse=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)fail('OFFICIAL_INPUT_INVALID',formValidationMessage(p.error,{displayName:'公众号名称'}));return p.data};
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey}),aad=row=>'tenant-official:'+row.tenantId+':'+row.applicationKey;

export class TenantOfficialAccounts {
 constructor(db,secrets,{storage=/** @type {any} */(null),client=new OfficialAccountClient()}={}){this.db=db;this.secrets=secrets;this.apps=new TenantApplications(db);this.storage=storage;this.client=client;this.busy=false}
 context(db,s,tenantId,key){parse(identifier,tenantId);if(key)parse(identifier,key);return this.apps.featureContext(db,s,tenantId,key,'wechatOfficial','settings.read')}
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:identifier.optional()}).strict(),input);await this.context(this.db,s,tenantId,q.applicationKey);
  const value=await this.db.$transaction(async db=>{const ctx=await this.context(db,s,tenantId,q.applicationKey),row=ctx.selected?await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,ctx.selected.key)}}):null,secrets=row?.keyCipher?this.decrypt(row):{},tasks=ctx.selected?await db.officialAccountTask.findMany({where:{tenantId,applicationKey:ctx.selected.key},orderBy:{createdAt:'desc'},take:20,select:{id:true,kind:true,status:true,errorCode:true,createdAt:true,settingsVersion:true}}):[];return{applicationKey:ctx.selected?.key||null,applications:ctx.sources,version:row?.version||0,config:officialAccountConfig.parse({...structuredClone(officialAccountDefaults),...row?.config}),hasAppSecret:!!secrets.appSecret,hasToken:!!secrets.token,hasEncodingAESKey:!!secrets.encodingAESKey,domains:miniProgramDomains(),callbackUrl:ctx.selected?miniProgramDomains().request+'/api/v1/public/wechat-official/'+encodeURIComponent(tenantId)+'/'+encodeURIComponent(ctx.selected.key):'',tasks,menuPayload:officialMenuPayload(row?.config.menu||[]),canWrite:ctx.permissions.includes('settings.write')}},{isolationLevel:'RepeatableRead'});
  const current=await this.context(this.db,s,tenantId,value.applicationKey||q.applicationKey);value.canWrite=current.permissions.includes('settings.write');return value;
 }
 decrypt(row){try{return this.secrets.decrypt(aad(row),row.keyCipher)}catch{fail('OFFICIAL_KEY_UNAVAILABLE','公众号密钥无法解密，请检查服务端加密密钥',503)}}
 async available(tenantId,key,db=this.db,lock=false){if(!application(key).wechatOfficial)fail('OFFICIAL_NOT_SUPPORTED','该应用未开放公众号渠道',403);return this.apps.available(tenantId,key,db,lock)}
 async callback(tenantId,applicationKey,query,body){
  parse(identifier,tenantId);parse(identifier,applicationKey);await this.available(tenantId,applicationKey);const row=await this.db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});
  if(!row?.config.appId||!row?.config.originalId||!row.keyCipher)fail('OFFICIAL_NOT_CONFIGURED','公众号消息接收尚未启用',409);
  const credentials=this.decrypt(row);if(!credentials.appSecret||!credentials.token||row.config.messageMode!=='plain'&&!credentials.encodingAESKey)fail('OFFICIAL_NOT_CONFIGURED','公众号消息接收配置不完整',409);
  let selected;const response=officialCallback(officialAccountConfig.parse({...structuredClone(officialAccountDefaults),...row.config}),credentials,query,body,{onReply:(message,reply)=>{selected={message,reply}}});
  if(selected){const requestKey=createHash('sha256').update(row.config.appId+':'+(selected.message.MsgId||JSON.stringify([selected.message.FromUserName,selected.message.CreateTime,selected.message.Event,selected.message.EventKey]))).digest('hex');await this.apps.transaction(async db=>{await this.available(tenantId,applicationKey,db,true);const current=await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(current?.version!==row.version)fail('OFFICIAL_CONFIG_CONFLICT','公众号配置已变化',409);if(await db.officialAccountTask.findUnique({where:{tenantId_applicationKey_requestKey:{tenantId,applicationKey,requestKey}}}))return;const id=randomUUID();await this.secrets.assertExistingKey(db);await db.officialAccountTask.create({data:{id,tenantId,applicationKey,requestKey,kind:'reply',settingsVersion:row.version,appId:row.config.appId,payload:selected.reply,recipientCipher:this.secrets.encrypt('official-recipient:'+id,{openId:selected.message.FromUserName}),expiresAt:new Date(Date.now()+3600000)}})})}return response;
 }
 async publishMenu(s,tenantId,applicationKey,input){
  const q=parse(z.object({version:z.number().int().positive()}).strict(),input);await this.context(this.db,s,tenantId,applicationKey);
  await this.apps.transaction(async db=>{await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true);const row=await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});if(!row||row.version!==q.version)fail('OFFICIAL_CONFIG_CONFLICT','配置已变化，请重新读取后发布',409);if(!row.config.appId||!row.keyCipher||!this.decrypt(row).appSecret)fail('OFFICIAL_CONFIG_INCOMPLETE','请先配置公众号 AppID 和 AppSecret');const config=officialAccountConfig.parse(row.config);if(!config.menu.length)fail('OFFICIAL_INPUT_INVALID','请先保存至少一个菜单');const requestKey='menu:'+q.version;if(await db.officialAccountTask.findUnique({where:{tenantId_applicationKey_requestKey:{tenantId,applicationKey,requestKey}}}))return;await db.officialAccountTask.create({data:{id:randomUUID(),tenantId,applicationKey,requestKey,kind:'menu',settingsVersion:q.version,appId:config.appId,payload:{menu:officialMenuPayload(config.menu),actor:{id:s.id,role:s.role,tenantIds:s.tenantIds,permissions:s.permissions,tokenHash:s.tokenHash,_admin:true,...(s.delegated?{delegated:true,tenantId:s.tenantId}:{})}},expiresAt:new Date(Date.now()+3600000)}});await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'official.menu.publish.requested',details:{version:q.version}}})});return this.view(s,tenantId,{applicationKey});
 }
 async taskContext(row,db=this.db,lock=false){await this.available(row.tenantId,row.applicationKey,db,lock);if(row.kind==='menu')await this.apps.admin(row.payload.actor,row.tenantId,row.applicationKey,'settings.write',db);const setting=await db.tenantOfficialAccountSetting.findUnique({where:{tenantId_applicationKey:scope(row.tenantId,row.applicationKey)}});if(setting?.version!==row.settingsVersion||setting.config.appId!==row.appId||row.expiresAt<=new Date())fail('OFFICIAL_CONFIG_CHANGED','公众号配置已变化或任务已到期');const secrets=this.decrypt(setting);if(!secrets.appSecret)fail('OFFICIAL_CONFIG_INCOMPLETE','请配置 AppSecret');return{appId:row.appId,appSecret:secrets.appSecret}}
 async media(row,id,thumbnail=false){
  const material=await this.db.tenantMaterial.findFirst({where:{id,tenantId:row.tenantId,scopeKey:'shared',deletedAt:null,status:'ready'}});if(!material||material.bytes>10*1024*1024||!['image','video'].includes(material.kind)||!this.storage)fail('OFFICIAL_MEDIA_UNAVAILABLE','公众号素材不可用');
  const revision=await this.storage.revision(material.revisionId),bytes=await this.storage.providers.get(revision.provider,revision.config,this.storage.credentials(revision),material.objectKey,10*1024*1024);
  if(thumbnail){const small=await sharp(bytes,{limitInputPixels:16000000}).rotate().resize(400,320,{fit:'inside'}).jpeg({quality:65}).toBuffer();if(small.length>64*1024)fail('OFFICIAL_MEDIA_UNAVAILABLE','卡片封面压缩后仍过大');return{bytes:small,mime:'image/jpeg'}}if(material.kind==='image'){const image=await sharp(bytes,{limitInputPixels:16000000}).rotate().jpeg({quality:85}).toBuffer();if(image.length>10*1024*1024)fail('OFFICIAL_MEDIA_UNAVAILABLE','公众号图片过大');return{bytes:image,mime:'image/jpeg'}}return{bytes,mime:material.mime};
 }
 async deliver(row){
  const claimToken=randomUUID();if(!(await this.db.officialAccountTask.updateMany({where:{id:row.id,status:'PENDING',attempts:row.attempts,nextAttemptAt:{lte:new Date()},expiresAt:{gt:new Date()}},data:{status:'PREPARING',claimToken,attempts:{increment:1}}})).count)return;let sending=false;
  try{const credentials=await this.taskContext(row),token=await this.client.token(credentials);let payload=row.kind==='menu'?row.payload.menu:row.payload;
   if(row.kind==='reply'){const reply=row.payload,{openId}=this.secrets.decrypt('official-recipient:'+row.id,row.recipientCipher);payload={touser:openId,msgtype:reply.type||'text'};
    if(!reply.type||reply.type==='text')payload.text={content:reply.text};
    else if(['image','video'].includes(reply.type)){const file=await this.media(row,reply.materialId),mediaId=await this.client.upload(token,reply.type,file.bytes,file.mime);payload[reply.type]={media_id:mediaId,...(reply.type==='video'?{title:reply.title||'',description:reply.description||''}:{})}}
    else if(reply.type==='news'){const file=await this.media(row,reply.coverMaterialId,true),picurl=await this.client.imageUrl(token,file.bytes,file.mime);payload.news={articles:[{title:reply.title,description:reply.description||'',url:reply.url,picurl}]}}
    else if(reply.type==='miniprogram'){const file=await this.media(row,reply.coverMaterialId,true),imageId=await this.client.upload(token,'image',file.bytes,file.mime);payload.msgtype='miniprogrampage';payload.miniprogrampage={title:reply.title,appid:reply.appId,pagepath:reply.pagePath,thumb_media_id:imageId}}
    else fail('OFFICIAL_INPUT_INVALID','不支持的回复类型');
   }
   const changed=await this.apps.transaction(async db=>{await this.taskContext(row,db,true);return db.officialAccountTask.updateMany({where:{id:row.id,status:'PREPARING',claimToken},data:{status:'SENDING'}})});if(!changed.count)return;sending=true;
   if(row.kind==='menu')await this.client.menu(token,payload);else await this.client.send(token,payload);
   await this.db.officialAccountTask.updateMany({where:{id:row.id,status:'SENDING',claimToken},data:{status:'ACCEPTED',errorCode:null}});
  }catch(e){
   // Preparation may be retried; once SENDING is persisted, an uncertain delivery must never be replayed.
   const retry=!sending&&e.retryable!==false&&['WECHAT_CHECK_UNAVAILABLE','OFFICIAL_RESULT_UNKNOWN'].includes(e.code)&&row.attempts<2;
   await this.db.officialAccountTask.updateMany({where:{id:row.id,claimToken,status:{in:['PREPARING','SENDING']}},data:{status:sending&&e.code!=='OFFICIAL_PROVIDER_REJECTED'?'UNKNOWN':retry?'PENDING':'FAILED',errorCode:/^[A-Z0-9_]{1,64}$/.test(e.code||'')?e.code:'OFFICIAL_TASK_FAILED',...(retry?{nextAttemptAt:new Date(Date.now()+60000)}:{})}});
  }
 }
 async tick(){if(this.busy)return;this.busy=true;try{
  const stale=new Date(Date.now()-120000);
  await this.db.officialAccountTask.updateMany({where:{status:'SENDING',updatedAt:{lt:stale}},data:{status:'UNKNOWN',errorCode:'OFFICIAL_INTERRUPTED'}});
  await this.db.officialAccountTask.updateMany({where:{status:'PREPARING',updatedAt:{lt:stale},attempts:{lt:3}},data:{status:'PENDING',claimToken:null,nextAttemptAt:new Date()}});
  await this.db.officialAccountTask.updateMany({where:{status:'PREPARING',updatedAt:{lt:stale},attempts:{gte:3}},data:{status:'FAILED',errorCode:'OFFICIAL_PREPARE_EXHAUSTED'}});
  await this.db.officialAccountTask.updateMany({where:{status:'PENDING',expiresAt:{lte:new Date()}},data:{status:'FAILED',errorCode:'OFFICIAL_TASK_EXPIRED'}});
  for(const row of await this.db.officialAccountTask.findMany({where:{status:'PENDING',nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:5}))await this.deliver(row);
 }finally{this.busy=false}}
 async save(s,tenantId,applicationKey,input){
  const q=parse(z.object({version:z.number().int().nonnegative(),config:officialAccountConfig,appSecret:z.string().trim().max(32).default('').refine(v=>!v||/^[A-Fa-f0-9]{32}$/.test(v),'须为 32 位十六进制字符，可留空保留原密钥'),clearSecret:z.boolean().default(false),token:z.string().trim().max(32).default('').refine(v=>!v||/^[A-Za-z0-9]{3,32}$/.test(v),'须为 3–32 位英文字母或数字，可留空保留原值'),encodingAESKey:z.string().trim().max(43).default('').refine(v=>!v||/^[A-Za-z0-9+/]{43}$/.test(v)&&Buffer.from(v+'=','base64').length===32,'须为 43 位有效的 Base64 密钥，可留空保留原密钥'),clearToken:z.boolean().default(false),clearEncodingAESKey:z.boolean().default(false)}).strict(),input);
  if(q.clearSecret&&q.appSecret)fail('OFFICIAL_INPUT_INVALID','不能同时填写和清除 AppSecret');
  await this.context(this.db,s,tenantId,applicationKey);
  await this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,applicationKey,'settings.write',db,true);const ctx=await this.context(db,s,tenantId,applicationKey);if(!ctx.permissions.includes('settings.write'))fail('FORBIDDEN','没有公众号配置管理权限',403);
   const where={tenantId_applicationKey:scope(tenantId,applicationKey)},old=await db.tenantOfficialAccountSetting.findUnique({where});if((old?.version||0)!==q.version)fail('OFFICIAL_CONFIG_CONFLICT','配置已更新，请重新读取后编辑',409);
   const changedApp=!!old&&old.config.appId!==q.config.appId;if(changedApp&&old.keyCipher&&!q.appSecret&&!q.clearSecret)fail('OFFICIAL_KEY_REPLACE_REQUIRED','更换 AppID 后须重新填写或明确清除 AppSecret',409);
   const secrets=old?.keyCipher?this.decrypt(old):{};for(const [field,clear] of [['appSecret','clearSecret'],['token','clearToken'],['encodingAESKey','clearEncodingAESKey']]){if(q[field]&&q[clear])fail('OFFICIAL_INPUT_INVALID','不能同时填写和清除密钥');if(q[clear])delete secrets[field];if(q[field])secrets[field]=q[field]}let keyCipher=old?.keyCipher||null;
   if(q.appSecret||q.token||q.encodingAESKey||q.clearSecret||q.clearToken||q.clearEncodingAESKey){if(q.appSecret&&!q.config.appId)fail('OFFICIAL_CONFIG_INCOMPLETE','保存 AppSecret 前请填写 AppID');try{await this.secrets.assertExistingKey(db);keyCipher=Object.keys(secrets).length?this.secrets.encrypt(aad({tenantId,applicationKey}),secrets):null}catch{fail('OFFICIAL_KEY_UNAVAILABLE','公众号密钥加密失败，请检查服务端加密密钥',503)}}
   q.config.enabled=!!q.config.appId&&!!secrets.appSecret;q.config.messageEnabled=q.config.enabled&&!!q.config.originalId&&!!secrets.token&&(q.config.messageMode==='plain'||!!secrets.encodingAESKey);
   if(q.config.messageEnabled&&(!q.config.enabled||!q.config.originalId||!secrets.token||q.config.messageMode!=='plain'&&!secrets.encodingAESKey))fail('OFFICIAL_CONFIG_INCOMPLETE','启用消息接收前请填写原始 ID、Token 及对应的消息加密密钥');
   for(const ref of officialMaterialRefs(q.config)){const material=await db.tenantMaterial.findFirst({where:{id:ref.id,tenantId,scopeKey:'shared',kind:ref.kind,status:'ready',deletedAt:null}});if(!material)fail('OFFICIAL_IMAGE_INVALID','公众号使用的素材不存在或不属于本站素材库');if(ref.kind==='video'&&material.mime!=='video/mp4')fail('OFFICIAL_IMAGE_INVALID','公众号视频请选择 MP4 格式')}
   const data={config:q.config,keyCipher,version:q.version+1};if(old)await db.tenantOfficialAccountSetting.update({where,data});else await db.tenantOfficialAccountSetting.create({data:{...scope(tenantId,applicationKey),...data}});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'official.config.save',details:{version:data.version,enabled:q.config.enabled,appChanged:changedApp,keyChanged:!!q.appSecret,keyCleared:q.clearSecret,...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,{applicationKey});
 }
}
