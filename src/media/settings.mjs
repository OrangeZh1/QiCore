import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {StorageSecrets} from './secrets.mjs';
import {StorageProviders,privateDomain,publicObjectUrl} from './providers.mjs';
import {can} from '../identity.mjs';

export const storageProviders=['local','qiniu','oss','cos'];
const labels={local:'本地存储',qiniu:'七牛 Kodo',oss:'阿里云 OSS',cos:'腾讯云 COS'};
const defaults={bucket:'',region:'',privateDomain:'',maxFileMb:20};
const formSchema=z.object({version:z.number().int().positive(),enabled:z.boolean().optional(),bucket:z.string().trim().max(100),region:z.string().trim().max(50),privateDomain:z.string().trim().max(253),maxFileMb:z.number().int().min(1).max(100),accessKeyId:z.string().trim().max(256).default(''),secret:z.string().trim().max(256).default('')}).strict();
const hash=s=>createHash('sha256').update(s).digest('hex');
function parse(schema,input){const result=schema.safeParse(input);if(!result.success)fail('STORAGE_INPUT_INVALID','请检查存储配置字段与文件大小限制');return result.data}
function codeOf(e){return ['BUCKET_NOT_PRIVATE','PUBLIC_ACCESS_NOT_BLOCKED','PRIVATE_NETWORK_REJECTED','STORAGE_CREDENTIALS_UNAVAILABLE','OBJECT_MISMATCH','TEST_CLEANUP_FAILED','BUCKET_LOOKUP_FAILED'].includes(e?.message)?e.message:'CONNECTION_FAILED'}
const messages={BUCKET_LOOKUP_FAILED:'无法查询存储桶信息，请检查密钥、Bucket 名称和查询权限',BUCKET_NOT_PRIVATE:'存储桶必须设置为私有访问',PUBLIC_ACCESS_NOT_BLOCKED:'检测到匿名访问未被阻止，不能启用此存储',PRIVATE_NETWORK_REJECTED:'下载域名不能解析到内网地址',STORAGE_CREDENTIALS_UNAVAILABLE:'存储凭据无法解密，请检查服务端加密密钥',OBJECT_MISMATCH:'测试文件读取内容不一致',TEST_CLEANUP_FAILED:'测试文件清理失败，请检查删除权限后重新测试',CONNECTION_FAILED:'连接测试失败，请检查密钥、Bucket、区域及读写删除权限'};

export class PlatformStorage {
  constructor(db,{root,keyRoot,providers,secrets}) {
    this.db=db;this.root=resolve(root);this.providers=providers||new StorageProviders(this.root);this.secrets=secrets||new StorageSecrets(keyRoot)
  }
  store(db=this.db){return db.coreStorageSetting}
  where(){return {id:'instance'}}
  async allow(s,permission,db=this.db){
    const account=await db.account.findUnique({where:{id:s.id},include:{role:true}})
    if(!account || account.deletedAt || account.role.enabled===false || !can(account,'core.storage.'+permission.split('.').at(-1))) fail('FORBIDDEN','没有存储设置权限',403)
    return account
  }
  async audit(db,s,action,details){await db.coreAuditEvent.create({data:{id:randomUUID(),actor:s.id,action,details}})}
  provider(p){if(!storageProviders.includes(p))fail('STORAGE_PROVIDER_INVALID','不支持的存储服务商');return p}
  async init(){
    if(await this.store().findUnique({where:this.where()}))return;
    try{await this.db.$transaction(async tx=>{
      const revision=await tx.coreStorageRevision.create({data:{id:randomUUID(),provider:'local',config:{...defaults,access:'private'}}});await tx.coreStorageSetting.create({data:{id:'instance',activeRevisionId:revision.id,providers:{local:{revisionId:revision.id,status:'not_tested',checkedAt:null,message:''}}}});
    })}catch(e){if(e.code!=='P2002')throw e}
  }
  async state(){const state=await this.store().findUnique({where:this.where()});if(!state)fail('STORAGE_NOT_READY','存储配置尚未初始化',503);return state}
  async revision(id){const revision=await this.db.coreStorageRevision.findUnique({where:{id}});if(!revision)fail('STORAGE_REVISION_MISSING','原存储配置不可用，请联系管理员',503);return revision}
  credentials(revision){return revision.secretsCipher?this.secrets.decrypt(revision.id,revision.secretsCipher):null}
  publicUrl(revision,key){return publicObjectUrl(revision.provider,revision.config,key)}
  async view(s){
    const account=await this.allow(s,'settings.read');await this.init();const state=await this.state()
    const active=await this.revision(state.activeRevisionId)
    const rows=await this.db.coreStorageRevision.findMany({where:{id:{in:Object.values(state.providers).map(p=>p.revisionId)}}})
    return {siteId:null,inherited:false,canWrite:can(account,'core.storage.write'),version:state.version,active:{provider:active.provider,label:labels[active.provider],revisionId:active.id},providers:storageProviders.map(provider=>{
      const record=state.providers[provider],revision=rows.find(r=>r.id===record?.revisionId);
      return {provider,label:labels[provider],...defaults,...revision?.config,enabled:active?.provider===provider,revisionId:revision?.id??null,isDefault:!!revision&&revision.id===state.activeRevisionId,
        hasCredentials:!!revision?.secretsCipher,status:record?.status??'unconfigured',checkedAt:record?.checkedAt??null,message:record?.message??'',cleanupPending:!!record?.pendingProbe};
    })};
  }
  async save(s,provider,body){
    await this.allow(s,'settings.read');await this.allow(s,'settings.write',this.db,true);this.provider(provider);await this.init();const input=parse(formSchema,body),state=await this.state(),old=state.providers[provider];
    if(state.version!==input.version)fail('STORAGE_CONFLICT','配置已更新，请刷新后重试',409);
    if(old?.pendingProbe)fail('STORAGE_TEST_PENDING','连接测试或测试文件清理尚未完成，请先重试测试',409);
    const {version,enabled,accessKeyId,secret,...values}=input;let credentials=null;values.access='private';
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
      await tx.coreStorageRevision.create({data:{id,provider,config:values,secretsCipher}});
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
    const key=record.pendingProbe||`instance/probes/${randomUUID()}.txt`;
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
      await tx.$queryRaw`SELECT id FROM qc_storage_settings WHERE id='instance' FOR UPDATE`;
      state=await this.store(tx).findUniqueOrThrow({where:this.where()});
      if(state.providers[provider]?.pendingProbe!==key)fail('STORAGE_CONFLICT','测试状态已更新，请重新读取',409);
      const current={...state.providers[provider],status:code?'failed':'passed',checkedAt:new Date().toISOString(),message:code?messages[code]:'上传、读取和删除检查通过',pendingProbe:cleaned?null:key};
      await this.store(tx).update({where:this.where(),data:{providers:{...state.providers,[provider]:current},version:{increment:1}}});
      await this.audit(tx,s,'storage.connection.test',{provider,passed:!code,code});
    });return this.view(s);
  }
  async publicPolicy(){
    await this.init()
    const revision=await this.revision((await this.state()).activeRevisionId)
    return {provider:revision.provider,label:labels[revision.provider],revisionId:revision.id,external:revision.provider!=='local',maxFileMb:revision.config.maxFileMb}
  }
}
