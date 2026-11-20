import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {z} from 'zod';
import {fail} from '../core/errors.mjs';
import {StorageSecrets} from './secrets.mjs';
import {StorageProviders,privateDomain,publicObjectUrl} from './providers.mjs';
import {TenantSiteSettings} from '../core/tenant-site-settings.mjs';

export const storageProviders=['local','qiniu','oss','cos'];
const labels={local:'本地存储',qiniu:'七牛 Kodo',oss:'阿里云 OSS',cos:'腾讯云 COS'};
const defaults={bucket:'',region:'',privateDomain:'',maxFileMb:20};
const formSchema=z.object({version:z.number().int().positive(),enabled:z.boolean().optional(),bucket:z.string().trim().max(100),region:z.string().trim().max(50),privateDomain:z.string().trim().max(253),maxFileMb:z.number().int().min(1).max(100),accessKeyId:z.string().trim().max(256).default(''),secret:z.string().trim().max(256).default('')}).strict();
const hash=s=>createHash('sha256').update(s).digest('hex');
const applicationKeySchema=z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const storageScopeSchema=z.object({tenantId:z.string().min(1).max(64),applicationKey:applicationKeySchema,userId:z.string().min(1).max(64)});
const retentionSchema=z.enum(['expiry','application']);
const siteIdSchema=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const prefix=s=>`sites/${siteIdSchema.parse(s.tenantId)}/applications/${s.applicationKey}/users/${hash(s.userId)}/`;
function storageScope(s){const parsed=storageScopeSchema.safeParse(s);if(!parsed.success)throw Error('STORAGE_SCOPE_INVALID');return parsed.data}
function retentionPolicy(value){const parsed=retentionSchema.safeParse(value);if(!parsed.success)throw Error('STORAGE_RETENTION_INVALID');return parsed.data}
function parse(schema,input){const result=schema.safeParse(input);if(!result.success)fail('STORAGE_INPUT_INVALID','请检查存储配置字段与文件大小限制');return result.data}
function codeOf(e){return ['BUCKET_NOT_PRIVATE','PUBLIC_ACCESS_NOT_BLOCKED','PRIVATE_NETWORK_REJECTED','STORAGE_CREDENTIALS_UNAVAILABLE','OBJECT_MISMATCH','TEST_CLEANUP_FAILED','BUCKET_LOOKUP_FAILED'].includes(e?.message)?e.message:'CONNECTION_FAILED'}
const messages={BUCKET_LOOKUP_FAILED:'无法查询存储桶信息，请检查密钥、Bucket 名称和查询权限',BUCKET_NOT_PRIVATE:'存储桶必须设置为私有访问',PUBLIC_ACCESS_NOT_BLOCKED:'检测到匿名访问未被阻止，不能启用此存储',PRIVATE_NETWORK_REJECTED:'下载域名不能解析到内网地址',STORAGE_CREDENTIALS_UNAVAILABLE:'存储凭据无法解密，请检查服务端加密密钥',OBJECT_MISMATCH:'测试文件读取内容不一致',TEST_CLEANUP_FAILED:'测试文件清理失败，请检查删除权限后重新测试',CONNECTION_FAILED:'连接测试失败，请检查密钥、Bucket、区域及读写删除权限'};

export class PlatformStorage {
  constructor(db,{root=process.env.STORAGE_PATH||'../../.local/files',keyRoot=process.env.STORAGE_STATE_PATH||'../../.local/storage',providers,secrets,siteId=null}={}){
    this.db=db;this.root=resolve(root);this.providers=providers||new StorageProviders(this.root);this.secrets=secrets||new StorageSecrets(keyRoot);
    this.sweeping=false;this.siteId=siteId===null?null:siteIdSchema.parse(siteId);
  }
  // Only the trusted application loader selects this key; request bodies cannot choose it.
  forApplication(applicationKey){
    applicationKeySchema.parse(applicationKey);
    const scoped=s=>{if(s?.applicationKey!==undefined&&s.applicationKey!==applicationKey)throw Error('STORAGE_SCOPE_INVALID');return storageScope({...s,applicationKey})};
    return Object.freeze({
      secrets:this.secrets,publicPolicy:scope=>this.publicPolicy(scope===undefined?undefined:siteIdSchema.parse(scope?.tenantId??scope)),
      uploadTarget:(s,consent)=>this.uploadTarget(scoped(s),consent),
      put:(revision,s,bytes,extension,mime,expiresAt,options)=>this.put(revision,scoped(s),bytes,extension,mime,expiresAt,options),
      get:(ref,s)=>this.get(ref,scoped(s)),remove:(ref,s)=>this.remove(ref,scoped(s)),
      outputTarget:(ref,s)=>this.outputTarget(ref,scoped(s)),
      claimLegacy:(ref,s,retention)=>this.claimLegacy(ref,scoped(s),retention),
      extendRetention:(ref,s,expiresAt)=>this.extendRetention(ref,scoped(s),expiresAt),
      sweep:()=>this.sweep(applicationKey)
    });
  }
  forSite(siteId){return new PlatformStorage(this.db,{root:this.root,providers:this.providers,secrets:this.secrets,siteId})}
  store(db=this.db){return this.siteId?db.siteStorageSetting:db.platformStorageSetting}
  where(){return this.siteId?{siteId:this.siteId}:{id:'platform'}}
  async allow(s,permission,db=this.db,write=false){
    if(!this.siteId){if(!s?._admin||s.role!=='root'||!s.permissions.includes(permission))fail('FORBIDDEN','需要平台存储设置权限',403);return null}
    const ctx=await new TenantSiteSettings(this.db).authorize(db,s,this.siteId,'tenant:'+permission,write);
    if(write&&ctx.tenant.storageMode!=='tenant')fail('STORAGE_MANAGED_BY_PLATFORM','本站使用平台统一存储，不能修改独立配置',409);
    return ctx;
  }
  async audit(db,s,action,details){await db.audit.create({data:{id:randomUUID(),scope:this.siteId?'tenant':'platform',tenantId:this.siteId||'__platform__',actor:s.impersonatedBy||s.id,action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
  provider(p){if(!storageProviders.includes(p))fail('STORAGE_PROVIDER_INVALID','不支持的存储服务商');return p}
  async init(){
    if(await this.store().findUnique({where:this.where()}))return;
    try{await this.db.$transaction(async tx=>{
      if(this.siteId){await tx.siteStorageSetting.create({data:{siteId:this.siteId,providers:{}}});return}
      const revision=await tx.storageRevision.create({data:{id:randomUUID(),provider:'local',config:{...defaults,access:'public'}}});await tx.platformStorageSetting.create({data:{id:'platform',activeRevisionId:revision.id,providers:{local:{revisionId:revision.id,status:'not_tested',checkedAt:null,message:''}}}});
    })}catch(e){if(e.code!=='P2002')throw e}
  }
  async state(){const state=await this.store().findUnique({where:this.where()});if(!state)fail('STORAGE_NOT_READY','存储配置尚未初始化',503);return state}
  async revision(id){const revision=await this.db.storageRevision.findUnique({where:{id}});if(!revision)fail('STORAGE_REVISION_MISSING','原存储配置不可用，请联系管理员',503);return revision}
  credentials(revision){return revision.secretsCipher?this.secrets.decrypt(revision.id,revision.secretsCipher):null}
  publicUrl(revision,key){return publicObjectUrl(revision.provider,revision.config,key)}
  async saveImage(data,mime,{siteId=null,kind='avatar',sourceMaterialId=null}={}){
    const revision=await this.targetForSite(siteId),id=randomUUID(),objectKey=`${siteId?'sites/'+siteId:'platform'}/images/${id}.${mime==='image/png'?'png':'webp'}`;
    const publicUrl=this.publicUrl(revision,objectKey);
    // Persist the destination first, so an interrupted upload or cleanup remains recoverable.
    await this.db.siteAsset.create({data:{id,siteId,kind,mime,bytes:0,data:Buffer.alloc(0),sourceMaterialId,revisionId:revision.id,objectKey,publicUrl}});
    try{await this.providers.put(revision.provider,revision.config,this.credentials(revision),objectKey,data,mime);await this.db.siteAsset.update({where:{id},data:{bytes:data.length}})}
    catch(e){try{await this.providers.remove(revision.provider,revision.config,this.credentials(revision),objectKey);await this.db.siteAsset.delete({where:{id}})}catch{/* Pending metadata is retried by sweep(). */}throw e}
    return publicUrl||'/api/v1/public/site-assets/'+id;
  }
  async imageReference(value,siteId=null){
    const id=/^\/api\/v1\/public\/site-assets\/([a-f0-9-]{36})$/.exec(value)?.[1];
    const row=await this.db.siteAsset.findFirst({where:{siteId,...(id?{id}:{publicUrl:value})}});
    if(!row||row.revisionId&&!(row.bytes>0))fail('IMAGE_INVALID','图片不存在或不属于当前站点，请重新选择');return value;
  }
  async imageBytes(value,siteId=null){
    await this.imageReference(value,siteId);const id=value.startsWith('/api/')?value.split('/').at(-1):null;
    const row=await this.db.siteAsset.findFirst({where:{siteId,...(id?{id}:{publicUrl:value})}});
    if(!row.revisionId)return Buffer.from(row.data);const revision=await this.revision(row.revisionId);
    return this.providers.get(revision.provider,revision.config,this.credentials(revision),row.objectKey);
  }
  async imageUrls(siteId,scopeKey,ids){
    if(!ids.length)return {};
    const rows=await this.db.tenantMaterial.findMany({where:{tenantId:siteId,scopeKey,id:{in:ids},kind:'image',status:'ready',deletedAt:null}});
    const revisions=await this.db.storageRevision.findMany({where:{id:{in:[...new Set(rows.map(row=>row.revisionId))]}}});
    return Object.fromEntries(rows.flatMap(row=>{const revision=revisions.find(r=>r.id===row.revisionId),url=revision?this.publicUrl(revision,row.objectKey):null;return url?[[row.id,url]]:[]}));
  }
  async delivery(row,range){
    if(!(row.bytes>0))fail('NOT_FOUND','文件尚未就绪',404);
    const revision=await this.revision(row.revisionId),redirect=this.publicUrl(revision,row.objectKey);
    if(redirect)return {redirect,mime:row.mime,name:row.name||'image',inline:row.kind!=='file'};
    const file=await this.providers.stream(revision.provider,revision.config,this.credentials(revision),row.objectKey,row.bytes,range);
    return {...file,mime:row.mime,name:row.name||'image',inline:row.kind!=='file'};
  }
  async view(s){
    const ctx=await this.allow(s,'settings.read');await this.init();const state=await this.state();
    const inherited=!!ctx&&ctx.tenant.storageMode!=='tenant',activeId=inherited?(await new PlatformStorage(this.db).state()).activeRevisionId:state.activeRevisionId;
    const active=activeId?await this.revision(activeId):null;
    const rows=inherited?[]:await this.db.storageRevision.findMany({where:{id:{in:Object.values(state.providers).map(p=>p.revisionId)}}});
    return {siteId:this.siteId,mode:inherited?'platform':this.siteId?'tenant':'platform',inherited,canWrite:!inherited&&s.permissions.includes(this.siteId?'tenant:settings.write':'settings.write')&&(!ctx||ctx.actor.role.permissions.includes('tenant:settings.write')),version:state.version,active:active?{provider:active.provider,label:labels[active.provider],revisionId:active.id}:null,localRoot:this.siteId?undefined:this.root,providers:inherited?[]:storageProviders.map(provider=>{
      const record=state.providers[provider],revision=rows.find(r=>r.id===record?.revisionId);
      return {provider,label:labels[provider],...defaults,...revision?.config,enabled:active?.provider===provider,revisionId:revision?.id??null,isDefault:!!revision&&revision.id===state.activeRevisionId,
        hasCredentials:!!revision?.secretsCipher,status:record?.status??'unconfigured',checkedAt:record?.checkedAt??null,message:record?.message??'',cleanupPending:!!record?.pendingProbe};
    })};
  }
  async save(s,provider,body){
    await this.allow(s,'settings.read');await this.allow(s,'settings.write',this.db,true);this.provider(provider);await this.init();const input=parse(formSchema,body),state=await this.state(),old=state.providers[provider];
    if(state.version!==input.version)fail('STORAGE_CONFLICT','配置已更新，请刷新后重试',409);
    if(old?.pendingProbe)fail('STORAGE_TEST_PENDING','连接测试或测试文件清理尚未完成，请先重试测试',409);
    const {version,enabled,accessKeyId,secret,...values}=input;let credentials=null;values.access='public';
    if(provider==='local')Object.assign(values,{bucket:'',region:'',privateDomain:''});
    else{
      if(values.bucket&&!/^[a-z0-9][a-z0-9-]{1,99}$/.test(values.bucket))fail('BUCKET_INVALID','Bucket 名称格式无效');
      if(provider==='oss'&&values.region&&!/^oss-[a-z0-9-]+$/.test(values.region)||provider==='cos'&&values.region&&!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(values.region))fail('REGION_INVALID','存储区域格式无效');
      try{values.privateDomain=privateDomain(values.privateDomain)}catch{fail('PRIVATE_DOMAIN_INVALID','资源域名须为不含路径或端口的 HTTPS 域名')}
      const previous=old?await this.revision(old.revisionId):null;
      if(accessKeyId&&secret)credentials={accessKeyId,secret};
      else{credentials=previous?this.credentials(previous):null;if(accessKeyId||secret){if(accessKeyId&&accessKeyId!==credentials?.accessKeyId&&!secret)fail('STORAGE_SECRET_REQUIRED','更换访问 Key ID 时需同时填写密钥');credentials={accessKeyId:accessKeyId||credentials?.accessKeyId||'',secret:secret||credentials?.secret||''}}}
    }
    const id=randomUUID();values.maskedAccessKeyId=credentials?'••••'+credentials.accessKeyId.slice(-4):'';
    if(credentials)await this.secrets.assertExistingKey(this.db);
    const secretsCipher=credentials?this.secrets.encrypt(id,credentials):null;
    await this.db.$transaction(async tx=>{
      await this.allow(s,'settings.write',tx,true);
      await tx.storageRevision.create({data:{id,provider,config:values,secretsCipher}});
      const providers={...state.providers,[provider]:{revisionId:id,status:'not_tested',checkedAt:null,message:''}};
      const changed=await this.store(tx).updateMany({where:{...this.where(),version},data:{providers,version:{increment:1}}});if(!changed.count)fail('STORAGE_CONFLICT','配置已更新，请刷新后重试',409);
      await this.audit(tx,s,'storage.config.save',{provider,credentialsChanged:!!(accessKeyId||secret)});
    });return this.view(s);
  }
  async activate(s,provider,body){
    await this.allow(s,'settings.read');await this.allow(s,'settings.write',this.db,true);this.provider(provider);const input=parse(z.object({version:z.number().int().positive(),revisionId:z.string().uuid()}).strict(),body),state=await this.state(),record=state.providers[provider];
    if(!record||record.revisionId!==input.revisionId||record.status!=='passed'||record.pendingProbe)fail('STORAGE_TEST_REQUIRED','请先通过已保存配置的连接测试',409);
    await this.db.$transaction(async tx=>{await this.allow(s,'settings.write',tx,true);const result=await this.store(tx).updateMany({where:{...this.where(),version:input.version},data:{activeRevisionId:input.revisionId,version:{increment:1}}});if(!result.count)fail('STORAGE_CONFLICT','配置已更新，请刷新后重试',409);await this.audit(tx,s,'storage.default.change',{provider,revisionId:input.revisionId})});return this.view(s);
  }
  async test(s,provider){
    await this.allow(s,'settings.read');await this.allow(s,'settings.write',this.db,true);this.provider(provider);let state=await this.state(),record=state.providers[provider];
    if(!record)fail('STORAGE_UNCONFIGURED','请先保存配置',409);
    if(record.status==='testing'&&Date.now()-Date.parse(record.startedAt)<120000)fail('STORAGE_TEST_BUSY','连接测试正在进行',409);
    const revision=await this.revision(record.revisionId),credentials=this.credentials(revision),c=revision.config;
    if(provider!=='local'&&(!credentials?.accessKeyId||!credentials?.secret||!c.bucket||provider!=='qiniu'&&!c.region||(c.access==='public'||provider==='qiniu')&&!c.privateDomain))fail('STORAGE_INCOMPLETE','请完整填写 Bucket、资源域名、区域及密钥');
    const key=record.pendingProbe||`${this.siteId?'sites/'+this.siteId:'platform'}/probes/${randomUUID()}.txt`;
    const update=async(next,expected)=>this.db.$transaction(async tx=>{await this.allow(s,'settings.write',tx,true);const result=await this.store(tx).updateMany({where:{...this.where(),version:expected},data:{providers:{...state.providers,[provider]:next},version:{increment:1}}});if(!result.count)fail('STORAGE_CONFLICT','配置已更新，请重试',409)});
    record={...record,status:'testing',pendingProbe:key,startedAt:new Date().toISOString(),message:''};await update(record,state.version);
    let code=null,cleaned=false,attemptedWrite=false;const wasPending=!!state.providers[provider]?.pendingProbe;
    try{
      const bytes=randomBytes(32);
      if(wasPending)await this.providers.remove(provider,c,credentials,key);
      if(c.access!=='public')await this.providers.checkPrivate(provider,c,credentials);
      attemptedWrite=true;await this.providers.put(provider,c,credentials,key,bytes);
      if(!(await this.providers.get(provider,c,credentials,key)).equals(bytes))throw Error('OBJECT_MISMATCH');
      if(c.access!=='public')await this.providers.assertNotPublic(provider,c,credentials,key);
    }catch(e){code=codeOf(e)}
    try{if(attemptedWrite||wasPending)await this.providers.remove(provider,c,credentials,key);cleaned=true}catch{code='TEST_CLEANUP_FAILED'}
    // Persist external cleanup even if the actor lost access while the probe was running.
    await this.db.$transaction(async tx=>{
      if(this.siteId)await tx.$queryRaw`SELECT siteId FROM SiteStorageSetting WHERE siteId=${this.siteId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM PlatformStorageSetting WHERE id='platform' FOR UPDATE`;
      state=await this.store(tx).findUniqueOrThrow({where:this.where()});
      if(state.providers[provider]?.pendingProbe!==key)fail('STORAGE_CONFLICT','测试状态已更新，请重新读取',409);
      const current={...state.providers[provider],status:code?'failed':'passed',checkedAt:new Date().toISOString(),message:code?messages[code]:'上传、读取和删除检查通过',pendingProbe:cleaned?null:key};
      await this.store(tx).update({where:this.where(),data:{providers:{...state.providers,[provider]:current},version:{increment:1}}});
      await this.audit(tx,s,'storage.connection.test',{provider,passed:!code,code});
    });return this.view(s);
  }
  async targetForSite(siteId){
    if(siteId!==undefined&&siteId!==null){siteIdSchema.parse(siteId);const tenant=await this.db.tenant.findUnique({where:{id:siteId}});
      if(tenant?.storageMode==='tenant'){const setting=await this.db.siteStorageSetting.findUnique({where:{siteId}});if(!setting?.activeRevisionId)fail('TENANT_STORAGE_UNCONFIGURED','本站独立存储尚未启用，请在存储设置中完成配置',409);return this.revision(setting.activeRevisionId)}
    }
    return this.revision((await new PlatformStorage(this.db).state()).activeRevisionId);
  }
  async uploadTarget(s,externalConsent){
    storageScope(s);const revision=await this.targetForSite(s.tenantId);
    if(revision.provider!=='local'&&externalConsent!==revision.id)fail('EXTERNAL_STORAGE_CONSENT_REQUIRED','请先明确同意将文件存储到当前云服务商，配置变化后需重新授权',403);
    return revision;
  }
  async publicPolicy(siteId){const revision=await this.targetForSite(siteId);return{siteId:siteId??null,provider:revision.provider,label:labels[revision.provider],revisionId:revision.id,external:revision.provider!=='local',maxFileMb:revision.config.maxFileMb}}
  async put(revision,s,bytes,extension,mime,expiresAt,{retention='application'}={}){
    s=storageScope(s);retention=retentionPolicy(retention);
    if(!['png','jpg'].includes(extension)||!Buffer.isBuffer(bytes)||bytes.length>revision.config.maxFileMb*1024*1024)fail('STORAGE_FILE_SIZE','图片超过当前存储大小限制');
    if(!(expiresAt instanceof Date)||expiresAt.getTime()<=Date.now())fail('STORAGE_EXPIRY_INVALID','文件保存期限无效');
    const id=randomUUID(),key=prefix(s)+id+'.'+extension;
    await this.db.storageObject.create({data:{id,revisionId:revision.id,objectKey:key,...s,retention,expiresAt}});
    try{await this.providers.put(revision.provider,revision.config,this.credentials(revision),key,bytes,mime)}catch{await this.db.storageObject.update({where:{id},data:{expiresAt:new Date()}});try{await this.remove(`storage:${revision.id}:${key}`,s)}catch{}fail('STORAGE_WRITE_FAILED','文件写入失败，请稍后重试',503)}
    return `storage:${revision.id}:${key}`;
  }
  reference(ref){const match=typeof ref==='string'&&/^storage:([a-f0-9-]{36}):(.+)$/.exec(ref);if(!match)throw Error('STORAGE_REFERENCE_INVALID');return{revisionId:match[1],objectKey:match[2]}}
  async claimLegacy(ref,s,retention){
    s=storageScope(s);retention=retentionPolicy(retention);const reference=this.reference(ref);
    return this.db.$transaction(async db=>{
      // Old records have no application owner. Claim only an exact business reference
      // from a tenant with one unambiguous binding; never infer a default application.
      await db.$queryRaw`SELECT id FROM Tenant WHERE id=${s.tenantId} FOR UPDATE`;
      const object=await db.storageObject.findFirst({where:{...reference,tenantId:s.tenantId,userId:s.userId}});
      if(!object)return false;
      if(object.applicationKey===s.applicationKey)return false;
      if(object.applicationKey!==null||object.retention!=='legacy')throw Error('STORAGE_SCOPE_INVALID');
      const bindings=await db.tenantApplication.findMany({where:{tenantId:s.tenantId},select:{applicationKey:true}});
      if(bindings.length!==1||bindings[0].applicationKey!==s.applicationKey)throw Error('STORAGE_LEGACY_OWNER_AMBIGUOUS');
      const claimed=await db.storageObject.updateMany({where:{id:object.id,applicationKey:null,retention:'legacy'},data:{applicationKey:s.applicationKey,retention}});
      if(!claimed.count)throw Error('STORAGE_CLAIM_CONFLICT');return true;
    });
  }
  async stored(ref,s){
    s=storageScope(s);const reference=this.reference(ref);
    const object=await this.db.storageObject.findFirst({where:{...reference,...s}});if(!object)throw Error('STORAGE_SCOPE_INVALID');
    return{revision:await this.revision(reference.revisionId),key:reference.objectKey,object};
  }
  async extendRetention(ref,s,expiresAt){
    if(!(expiresAt instanceof Date)||!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now())fail('STORAGE_EXPIRY_INVALID','文件保存期限无效');
    const file=await this.stored(ref,s);
    // Extend only application-managed files; never revive a requested deletion.
    if(file.object.retention!=='application'||file.object.deletedAt||file.object.deleteRetryAt)return false;
    if(file.object.expiresAt>=expiresAt)return true;
    const updated=await this.db.storageObject.updateMany({where:{id:file.object.id,...storageScope(s),retention:'application',deletedAt:null,deleteRetryAt:null,expiresAt:{lt:expiresAt}},data:{expiresAt}});
    return updated.count>0;
  }
  async get(ref,s){const file=await this.stored(ref,s);if(file.object.deletedAt||file.object.expiresAt.getTime()<=Date.now())throw Error('STORAGE_OBJECT_EXPIRED');return this.providers.get(file.revision.provider,file.revision.config,this.credentials(file.revision),file.key)}
  async remove(ref,s){
    const file=await this.stored(ref,s);if(file.object.deletedAt)return;
    await this.db.storageObject.updateMany({where:{id:file.object.id,...storageScope(s)},data:{expiresAt:new Date(),retention:'expiry'}});
    try{await this.providers.remove(file.revision.provider,file.revision.config,this.credentials(file.revision),file.key);await this.db.storageObject.updateMany({where:{id:file.object.id,...storageScope(s)},data:{deletedAt:new Date(),deleteRetryAt:null}})}
    catch(error){await this.db.storageObject.updateMany({where:{id:file.object.id,...storageScope(s)},data:{deleteRetryAt:new Date(Date.now()+60000)}});throw error}
  }
  async sweep(applicationKey){
    if(applicationKey!==undefined)applicationKeySchema.parse(applicationKey);
    if(this.sweeping)return;this.sweeping=true;
    try{const now=new Date();
      if(applicationKey===undefined){const pending=await this.db.siteAsset.findMany({where:{revisionId:{not:null},bytes:0,createdAt:{lt:new Date(Date.now()-300000)}},take:50});for(const asset of pending)try{const revision=await this.revision(asset.revisionId);await this.providers.remove(revision.provider,revision.config,this.credentials(revision),asset.objectKey);await this.db.siteAsset.delete({where:{id:asset.id}})}catch{/* Keep the original destination until cleanup succeeds. */}}

      // The persisted lifecycle survives application unload. Filter before LIMIT
      // so protected files cannot starve unrelated expiry cleanup.
      const files=await this.db.storageObject.findMany({where:{retention:'expiry',applicationKey:applicationKey??{not:null},deletedAt:null,expiresAt:{lte:now},OR:[{deleteRetryAt:null},{deleteRetryAt:{lte:now}}]},orderBy:[{expiresAt:'asc'},{id:'asc'}],take:50});
      for(const file of files)try{await this.remove(`storage:${file.revisionId}:${file.objectKey}`,file)}catch{/* Durable retry state is retained by remove(). */}
    }finally{this.sweeping=false}
  }
  async outputTarget(ref,s){return(await this.stored(ref,s)).revision}
}
