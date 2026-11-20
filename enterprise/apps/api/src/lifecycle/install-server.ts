import {createServer,type IncomingMessage} from 'node:http';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,readdirSync,lstatSync,chmodSync,chownSync,statfsSync,accessSync,constants} from 'node:fs';
import {isIP} from 'node:net';
import {dirname,resolve,relative,sep,isAbsolute} from 'node:path';
import {PrismaClient} from '@prisma/client';
import Redis from 'ioredis';
import {z} from 'zod';
import {LicenseClient,authorizationFailureCode} from '../license/client.js';
import {canonicalJson} from '../license/contracts.js';
import {StateStore} from '../license/store.js';
import {NativeState,type NativeConfig} from './native-state.js';
import {NativeHost} from './native-host.js';
import {Installation} from './installation.js';
import {installNative,initialInstallInputSchema,assertInitialDatabase} from './native-installation.js';
import {databaseConnectionSchema,parseMigrationUrl} from './database-credentials.js';
import {verifyNativeStoredRelease,type NativeStoredRelease} from '../license/native-updates.js';
import {noLinks,fileHash} from './native-files.js';
import {assertRuntimeCodeAccess} from './native-runtime-access.js';
import {resumeNativeInstallationHealth} from './native-installation-recovery.js';

type Job={id:string;hash:string;status:'running'|'succeeded'|'failed'|'recovery_required';code?:string};
export type InstallServerOptions={state:NativeState;host:NativeHost;client:LicenseClient;controlRoot:string;nativeConfigFile:string;archive:string;release:NativeStoredRelease;adminOrigin:string;redisUrl:string;onRedisUrl?:(url:string)=>Promise<void>|void;onResult?:()=>Promise<void>};
const cookieName='qicore_install_session';
const rejected=()=>{throw Error('INSTALL_RECOVERY_ONLY')};
export const installCodeMessage:Record<string,string>={
 INSTALL_CODE_DIRECTORY_MISSING:'代码目录不存在，请先检查保留的安装配置或运行首装修复工具',INSTALL_CODE_PATH_INVALID:'代码目录路径被普通文件占用，请核查目录配置',
 INSTALL_ARCHIVE_MISSING:'配置中的安装包不存在，请核对旧配置与当前安装包版本或运行首装修复工具',INSTALL_ARCHIVE_INVALID:'安装包与发行校验材料不匹配，请使用同一版本的完整安装文件',INSTALL_ARCHIVE_UNREADABLE:'安装包无法读取，请检查路径和读取权限',
 INSTALL_REPAIR_RECOVERY_REQUIRED:'已有安装、恢复记录或非空数据目录，不能按空实例重新安装，请保留现场处理恢复',INSTALL_SOURCE_LAYOUT_CHANGED:'旧配置指向其他代码目录，请核对实例目录，不能自动迁移',INSTALL_SOURCE_IDENTITY_CHANGED:'当前安装包与旧配置的产品身份或可信公钥不一致，不能自动替换',INSTALL_SOURCE_DOWNGRADE_REJECTED:'当前安装包版本低于保留配置的版本，不能自动降级',INSTALL_CONFIG_CHANGED:'两份安装配置不一致，请使用首装修复工具核查',INSTALL_REPAIR_CONFLICT:'配置在修复过程中被其他操作修改，请保留修复记录并核查',INSTALL_REPAIR_PENDING:'上次配置修复尚未完成，请停止项目后再次运行修复工具',INSTALL_REPAIR_JOURNAL_INVALID:'配置修复记录异常，请保留现场并联系维护人员',
 BOOTSTRAP_ARCHIVE_INVALID:'安装包大小或哈希与发行校验材料不一致',
 INSTALL_REPAIR_DEPLOYMENT_PENDING:'已有未完成的部署配置同步，请先恢复该事务，再修复安装包配置',NATIVE_PATH_UNSAFE:'路径包含符号链接或不安全的目录结构',
 PRIVATE_INSTALL_CONFIG_OWNER:'请使用私有配置所属的控制器账号执行修复，不能自动改变配置归属',
 INSTALL_SOURCE_VERSION_INVALID:'保留配置或修复记录中的版本格式不正确，请核查原记录',
 INSTALL_HEALTH_RECOVERY_NOT_ALLOWED:'当前阶段不能自动重试，请保留恢复记录并联系维护人员',INSTALL_RECOVERY_CONFLICT:'存在其他维护任务，请先处理后再继续安装',
 INSTALL_RUNTIME_DIRECTORY_UNAVAILABLE:'运行账号无法读取代码目录，请检查目录属组及父目录访问权限',
 INSTALL_DATABASE_AUTHENTICATION:'数据库账号或密码不正确，请核对后重试',INSTALL_DATABASE_UNREACHABLE:'无法连接数据库服务，请检查主机、端口及服务状态',INSTALL_DATABASE_MISSING:'指定的数据库不存在，请先创建数据库',INSTALL_DATABASE_PERMISSION:'该账号无权访问指定数据库，请检查授权',INSTALL_DATABASE_ENGINE:'数据库客户端启动失败，请联系维护人员检查安装包与服务器环境',
 INSTALL_DATABASE_VERSION:'请使用受支持的 MySQL 8 数据库',INVALID_INSTALL_CREDENTIALS:'请使用目标数据库的专用账号，不使用 root 账号',
 INSTALL_ACCESS_DENIED:'安装链接已失效，请从部署启动日志打开新的安装链接',INSTALL_SESSION_REQUIRED:'请从部署启动日志打开安装链接',INSTALL_CSRF_REJECTED:'页面验证已失效，请刷新后重试',INSTALL_ORIGIN_REJECTED:'请通过配置的安装地址访问',INSTALLATION_CLOSED:'系统已经安装，安装入口已关闭',INSTALL_BUSY:'安装正在进行，请等待当前任务完成',INSTALL_INPUT_INVALID:'请检查数据库连接和管理员信息',INSTALL_DATABASE_NOT_EMPTY:'数据库中已有数据，请使用独立的空数据库',INSTALL_DATABASE_UNAVAILABLE:'数据库连接未通过，请核对主机、端口、账号和权限',INSTALL_AUTHORIZATION_REQUIRED:'框架授权尚未通过，请重新检测授权',INSTALL_TARGET_NOT_EMPTY:'目标目录中已有文件，请先核查安装或恢复状态',INSTALLATION_INTERRUPTED:'安装曾中断，请保留现有记录并联系维护人员处理',INSTALL_REQUEST_CONFLICT:'该请求的内容已改变，请重新发起安装',INSTALL_ENVIRONMENT_UNAVAILABLE:'安装环境检查未通过，请核查运行版本、目录权限及可用空间',HEALTH_CHECK_FAILED:'服务启动检查未通过，已保留恢复记录',RUNTIME_EXITED:'运行服务未能保持启动，已保留恢复记录',INSTALL_RECOVERY_REQUIRED:'已有安装恢复记录，请先处理恢复状态',INSTALL_CHECK_BUSY:'已有检查正在进行，请稍后重试',LICENSE_NETWORK_ERROR:'暂时无法连接授权服务，请稍后重试',INSTALL_RATE_LIMIT:'验证次数过多，请稍后重试',INSTALL_FAILED:'安装未完成，已保留服务端记录',
};
const errorCode=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{1,63}$/.test(error.message)?error.message:'INSTALL_FAILED';
export function installationDatabaseError(error:unknown){
 const known=errorCode(error);if(['INSTALL_DATABASE_NOT_EMPTY','INSTALL_DATABASE_VERSION'].includes(known))return known;
 const value=error as {code?:string;errorCode?:string;name?:string};
 const code=value?.errorCode||value?.code;
 if(code==='P1000')return 'INSTALL_DATABASE_AUTHENTICATION';
 if(['P1001','P1002','P1008'].includes(code||''))return 'INSTALL_DATABASE_UNREACHABLE';
 if(code==='P1003')return 'INSTALL_DATABASE_MISSING';
 if(code==='P1010')return 'INSTALL_DATABASE_PERMISSION';
 if(value?.name==='PrismaClientInitializationError'&&!code)return 'INSTALL_DATABASE_ENGINE';
 return 'INSTALL_DATABASE_UNAVAILABLE';
}
const contains=(parent:string,child:string)=>{const p=relative(resolve(parent),resolve(child));return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)};
export const installationRedisSchema=z.object({host:z.string().min(1).max(253).refine(value=>isIP(value)===6||/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value)),port:z.number().int().min(1).max(65535),database:z.number().int().min(0).max(255),username:z.string().max(100).default(''),password:z.string().max(256).optional(),tls:z.boolean().default(false)}).strict();
export function installationRedisUrl(input:unknown,previous='redis://127.0.0.1:6379/0'){const r=installationRedisSchema.parse(input),password=r.password??decodeURIComponent(new URL(previous).password);if(/[\r\n\0]/.test(r.username+password))throw Error('INSTALL_INPUT_INVALID');const auth=r.username||password?`${encodeURIComponent(r.username)}:${encodeURIComponent(password)}@`:'';return `${r.tls?'rediss':'redis'}://${auth}${isIP(r.host)===6?'['+r.host+']':r.host}:${r.port}/${r.database}`}
export function installationRedisView(value:string){const u=new URL(value);return{host:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port||6379),database:Number(u.pathname.slice(1)||0),username:decodeURIComponent(u.username),tls:u.protocol==='rediss:',hasPassword:!!u.password}}
export function installationDatabaseUrl(input:unknown){
 const value=databaseConnectionSchema.parse(input);if(value.host.includes(':')&&isIP(value.host)!==6)throw Error('INSTALL_INPUT_INVALID');
 const host=isIP(value.host)===6?'['+value.host+']':value.host;
 const url=new URL(`mysql://${encodeURIComponent(value.username)}:${encodeURIComponent(value.password)}@${host}:${value.port}/${encodeURIComponent(value.database)}`);
 parseMigrationUrl(url.href,'existing');return url.href;
}
export class InstallServer {
 readonly store:StateStore;
 readonly journal:Installation;
 private readonly secret:string;
 private busy=false;
 private environmentBusy=false;
 private authorizationPending?:Promise<any>;
 private authorizationCache?:{time:number;value:unknown};
 private attempts={count:0,reset:0};
 private flushTimer?:NodeJS.Timeout;
 readonly server;
 constructor(readonly options:InstallServerOptions){
  const {state,controlRoot,nativeConfigFile}=options;
  noLinks(controlRoot);noLinks(nativeConfigFile);
  if(contains(state.config.root,controlRoot)||contains(controlRoot,state.config.root)||contains(state.config.root,nativeConfigFile))throw Error('INSTALL_CONTROL_PATH_INVALID');
  if(new URL(options.adminOrigin).origin!==options.adminOrigin||new URL(options.adminOrigin).hostname!==options.client.domain)throw Error('INSTALL_ORIGIN_REJECTED');
  verifyNativeStoredRelease(state.config.product,options.release);
  this.store=new StateStore(controlRoot);const old=this.store.read<{secret:string}>('access.json');this.secret=old?.secret??randomBytes(32).toString('base64url');if(!old)this.store.write('access.json',{secret:this.secret});
  this.journal=new Installation(state.component(state.config.frameworkKey),{preflight:async()=>rejected(),authorize:async()=>rejected(),database:async()=>rejected(),migrate:async()=>rejected(),configure:async()=>rejected(),start:async()=>rejected(),health:async()=>rejected(),finalize:async()=>rejected()});
  this.journal.recoverInterrupted();const job=this.store.read<Job>('request.json');
  if(job?.status==='running'){job.status=this.completed()?'succeeded':'recovery_required';job.code=job.status==='succeeded'?undefined:'INSTALLATION_INTERRUPTED';this.store.write('request.json',job)}
  this.server=createServer((req,res)=>{void this.handle(req).then(result=>{res.statusCode=result.status??200;for(const [key,value] of Object.entries(result.headers??{}))res.setHeader(key,value);res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store, private');res.setHeader('referrer-policy','no-referrer');res.end(JSON.stringify({data:result.data}))}).catch(error=>{const code=error instanceof z.ZodError?'INSTALL_INPUT_INVALID':errorCode(error);res.statusCode=['INSTALL_SESSION_REQUIRED','INSTALL_ACCESS_DENIED'].includes(code)?401:code==='INSTALLATION_CLOSED'?410:409;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify({error:{code,message:installCodeMessage[code]||'检查或安装未完成，请核查环境后重试'}}))})});
 }
 launchUrl(){
  if(this.completed())throw Error('INSTALLATION_CLOSED');
  const token=randomBytes(32).toString('base64url');
  this.store.write('launch.json',{hash:createHash('sha256').update(token).digest('hex'),expires:Date.now()+30*60000});
  return this.options.adminOrigin+'/install#setup='+token;
 }
 private signature(value:string){return createHmac('sha256',this.secret).update(value).digest('base64url')}
 private session(req:IncomingMessage){
  const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!value)return null;
  const [payload,signature]=value.split('.');if(!payload||!signature||!this.equal(signature,this.signature(payload)))return null;
  try{const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return typeof parsed.expires==='number'&&parsed.expires>Date.now()?{csrf:this.signature('csrf:'+payload)}:null}catch{return null}
 }
 private equal(a:string,b:string){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right)}
 completed(){const {state}=this.options,installed=state.component(state.config.frameworkKey).read<any>('installation.json'),receipt=state.component(state.config.frameworkKey).read<any>('installed-receipt.json'),active=state.active(state.config.frameworkKey);return installed?.status==='succeeded'&&receipt?.attemptId===installed.id&&active?.health==='passed'}
 status(){
  const job=this.store.read<Job>('request.json'),attempt=this.options.state.component(this.options.state.config.frameworkKey).read<any>('installation.json');
  const status=this.completed()?'succeeded':this.busy?'running':attempt?.status??job?.status??'idle',code=this.busy?undefined:job?.code??attempt?.code;
  return {id:attempt?.id??job?.id??null,status,phase:attempt?.phase??'start',code:code??null,message:code?(installCodeMessage[code]||'安装未完成，请保留现有恢复记录'):null,complete:status==='succeeded',canResume:status==='recovery_required'&&attempt?.phase==='health'&&job?.id===attempt?.id,reportPending:(this.options.state.component(this.options.state.config.frameworkKey).read<any[]>('installation-outbox.json')??[]).some(row=>!row.acknowledged)};
 }
 private writable(){if(this.completed())throw Error('INSTALLATION_CLOSED');if(this.busy)throw Error('INSTALL_BUSY');if(this.status().status==='recovery_required')throw Error('INSTALL_RECOVERY_REQUIRED')}
 private async body(req:IncomingMessage){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw Error('INSTALL_INPUT_INVALID')}try{return JSON.parse(raw)}catch{throw Error('INSTALL_INPUT_INVALID')}}
 async authorization(reuse=false){
  if(this.authorizationPending)return this.authorizationPending;
  if(reuse&&this.authorizationCache&&Date.now()-this.authorizationCache.time<30000)return this.authorizationCache.value;
  this.authorizationPending=(async()=>{
   const {client,state}=this.options;let error:string|undefined;
   try{
    let active=false;
    try{active=client.status().state==='active'}catch(e){
     // Correcting a preinstallation domain must obtain a new online receipt; an old domain receipt never grants access.
     if(!(e instanceof Error)||e.message!=='RECEIPT_BINDING_MISMATCH'||this.completed())throw e;
    }
    if(active)await client.renew();else await client.activate();
   }catch(e){error=authorizationFailureCode(e)}
   // Only this controlled local activation directory changes ownership; no existing parent is changed.
   if(process.getuid?.()===0){chownSync(state.config.licenseStateRoot,state.config.runtimeUid,state.config.runtimeGid);for(const name of ['identity.json','receipt.json','activation-attempt.json']){const path=resolve(state.config.licenseStateRoot,name);if(!existsSync(path))continue;noLinks(path);if(!lstatSync(path).isFile())throw Error('INSTALL_LICENSE_OWNER_REQUIRED');chownSync(path,state.config.runtimeUid,state.config.runtimeGid);chmodSync(path,0o600)}}
   let status;try{status=client.status()}catch{status={state:'verification_failed'}};
   const allowed=!error&&status.state==='active'&&client.componentStatus(state.config.frameworkKey,'framework').updatesEligible;
   const viewState=error?error==='LICENSE_NETWORK_ERROR'?'unavailable':error.includes('DOMAIN')?'domain_mismatch':'verification_failed':status.state==='active'&&!allowed?'updates_unavailable':status.state;
   const value={state:viewState,allowed,domain:client.domain,source:'verified-online-receipt',checkedAt:new Date().toISOString()};
   this.authorizationCache={time:Date.now(),value};return value;
  })().finally(()=>{this.authorizationPending=undefined});return this.authorizationPending;
 }
 async environment(input:unknown={}){
  const request=z.object({redis:installationRedisSchema.optional()}).strict().parse(input);
  if(this.environmentBusy)throw Error('INSTALL_CHECK_BUSY');this.environmentBusy=true;
  try{
  const {config}=this.options.state;let space=true;
  const pathProblems:string[]=[];
  for(const target of [config.root,config.dataRoot,config.stateRoot,config.backupRoot,config.backupKeyRoot,dirname(config.environmentFile)]){
   try{noLinks(target);if(existsSync(target)&&!lstatSync(target).isDirectory()){pathProblems.push(`路径不是目录：${target}`);continue}let parent=target;while(!existsSync(parent))parent=dirname(parent);accessSync(parent,constants.W_OK|constants.X_OK);const stats=statfsSync(parent);if(stats.bavail*stats.bsize<this.options.release.manifest.files.reduce((n,f)=>n+f.size,0)+64*1024*1024)space=false}
   catch(error){pathProblems.push(`${error instanceof Error&&error.message==='NATIVE_PATH_UNSAFE'?'目录包含符号链接':'目录或父目录无法写入或访问'}：${target}`)}
  }
  try{assertRuntimeCodeAccess(config)}catch(error){const code=errorCode(error);pathProblems.push(`${installCodeMessage[code]||'代码目录无法访问'}：${config.root}`)}
  const runtime=process.platform==='linux'&&process.arch===this.options.release.manifest.runtime.arch&&process.versions.node.split('.')[0]==='24';
  for(const path of [config.root,config.dataRoot,config.backupRoot,config.backupKeyRoot])try{if(existsSync(path)&&lstatSync(path).isDirectory()&&readdirSync(path).length)pathProblems.push(`目录已有文件，请核查安装或恢复状态：${path}`)}catch{pathProblems.push(`无法读取目录：${path}`)}
  if(existsSync(config.environmentFile))pathProblems.push(`已有运行配置，请核查安装或恢复状态：${config.environmentFile}`);
  let archiveCode='';
  try{await this.archive()}catch(error){archiveCode=errorCode(error)}
  const redisUrl=request.redis?installationRedisUrl(request.redis,this.options.redisUrl):this.options.redisUrl;
  let cache=false;const redis=new Redis.default(redisUrl,{lazyConnect:true,connectTimeout:3000,maxRetriesPerRequest:0});redis.on('error',()=>{});try{await redis.connect();cache=await redis.ping()==='PONG'}catch{}finally{redis.disconnect()}
  const checks=[{key:'runtime',label:'运行环境',passed:runtime},{key:'paths',label:'独立安装目录',passed:pathProblems.length===0,message:pathProblems.join('；')},{key:'archive',label:'安装文件',passed:!archiveCode,code:archiveCode,message:archiveCode?`${installCodeMessage[archiveCode]||'安装文件检查未通过'}：${this.options.archive}`:''},{key:'space',label:'可用磁盘空间',passed:space},{key:'redis',label:'缓存连接',passed:cache}],passed=checks.every(c=>c.passed);
  if(passed&&request.redis){await this.options.onRedisUrl?.(redisUrl);this.options.redisUrl=redisUrl}
  return {passed,checks,redis:installationRedisView(this.options.redisUrl)};
  }finally{this.environmentBusy=false}
 }
 async archive(){
  const {archive,release}=this.options;
  noLinks(archive);if(!existsSync(archive))throw Error('INSTALL_ARCHIVE_MISSING');
  try{if(!lstatSync(archive).isFile()||String(lstatSync(archive).size)!==release.artifact.size||await fileHash(archive)!==release.artifact.sha256)throw Error('INSTALL_ARCHIVE_INVALID')}
  catch(error){if(error instanceof Error&&error.message==='INSTALL_ARCHIVE_INVALID')throw error;throw Error('INSTALL_ARCHIVE_UNREADABLE')}
 }
 async database(input:unknown){
  const url=installationDatabaseUrl(input);let db:PrismaClient|undefined,failed=false;
  try{db=new PrismaClient({datasources:{db:{url:url+'?connect_timeout=5&pool_timeout=5'}}});await db.$connect();await assertInitialDatabase(db);return {passed:true}}
  catch(error){failed=true;throw Error(installationDatabaseError(error))}
  finally{try{await db?.$disconnect()}catch(error){if(!failed)throw Error(installationDatabaseError(error))}}
 }
 private async execute(input:unknown){
  if(this.environmentBusy)throw Error('INSTALL_CHECK_BUSY');
  const request=z.object({requestId:z.string().uuid(),database:databaseConnectionSchema,administrator:initialInstallInputSchema.shape.administrator,acceptTerms:z.literal(true)}).strict().parse(input);
  const hash=createHmac('sha256',this.secret).update(canonicalJson(request)).digest('hex'),old=this.store.read<Job>('request.json');
  if(old?.id===request.requestId){if(old.hash!==hash)throw Error('INSTALL_REQUEST_CONFLICT');return {accepted:true,taskId:old.id}}
  this.writable();
  const {state,client,host}=this.options;if(client.status().state!=='active')throw Error('INSTALL_AUTHORIZATION_REQUIRED');
  this.busy=true;const job:Job={id:request.requestId,hash,status:'running'};this.store.write('request.json',job);
  void (async()=>{
   try{
    if(!(await this.authorization()).allowed)throw Error('INSTALL_AUTHORIZATION_REQUIRED');
    const environment=await this.environment();if(!environment.passed)throw Error(environment.checks.find(check=>check.key==='archive'&&!check.passed)?.code||'INSTALL_ENVIRONMENT_UNAVAILABLE');
    await this.database(request.database);state.config.migrationUrl=installationDatabaseUrl(request.database);
    new StateStore(dirname(this.options.nativeConfigFile)).write(this.options.nativeConfigFile.split(/[\\/]/).at(-1)!,state.config);
    const result=await installNative(state,client,host,{requestId:request.requestId,archive:this.options.archive,release:this.options.release,administrator:request.administrator,acceptTerms:true,adminOrigin:this.options.adminOrigin,redisUrl:this.options.redisUrl});
    job.status=result.status==='succeeded'?'succeeded':'recovery_required';job.code=result.code;
   }catch(error){job.status=state.component(state.config.frameworkKey).read('installation.json')?'recovery_required':'failed';job.code=errorCode(error)}
   finally{this.store.write('request.json',job);this.busy=false;try{await this.options.onResult?.()}catch{job.status='recovery_required';job.code='INSTALL_UI_UNAVAILABLE';this.store.write('request.json',job)}await this.flush()}
  })();return {accepted:true,taskId:job.id};
 }
 private async resumeHealth(input:unknown){
  const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(input),job=this.store.read<Job>('request.json');
  if(this.busy||this.environmentBusy)throw Error('INSTALL_BUSY');
  if(!this.status().canResume||job?.id!==requestId)throw Error('INSTALL_HEALTH_RECOVERY_NOT_ALLOWED');
  this.busy=true;job.status='running';delete job.code;this.store.write('request.json',job);
  void (async()=>{
   try{
    if(!(await this.authorization()).allowed)throw Error('INSTALL_AUTHORIZATION_REQUIRED');
    const result=await resumeNativeInstallationHealth(this.options.state,this.options.client,this.options.host,requestId);
    job.status=result.status;job.code=result.code;
   }catch(error){job.status='recovery_required';job.code=errorCode(error)}
   finally{this.store.write('request.json',job);this.busy=false;try{await this.options.onResult?.()}catch{job.code='INSTALL_UI_UNAVAILABLE';this.store.write('request.json',job)}await this.flush()}
  })();return {accepted:true,taskId:requestId};
 }
 async flush(){await this.journal.flush(payload=>this.options.client.machine('license/installation/report',{...payload}))}
 startReports(){this.flushTimer=setInterval(()=>void this.flush(),30000);this.flushTimer.unref();void this.flush()}
 async close(){if(this.flushTimer)clearInterval(this.flushTimer);await new Promise<void>(ok=>this.server.close(()=>ok()))}
 private async handle(req:IncomingMessage):Promise<{status?:number;headers?:Record<string,string>;data:unknown}>{
  const url=new URL(req.url||'/','http://local'),session=this.session(req);
  if(req.method==='GET'&&url.pathname==='/challenge'){const value=this.options.client.challengeResponse(url.searchParams.get('token')||'',String(req.headers['x-install-host']||''));if(!value)throw Error('INSTALL_ACCESS_DENIED');return {data:value}}
  if(req.method==='GET'&&url.pathname==='/state')return {data:{available:true,complete:this.completed(),authenticated:!!session,...(session?{csrf:session.csrf,job:this.status(),redis:installationRedisView(this.options.redisUrl)}: {})}};
  // Domain entitlement is public; it never grants permission to configure or install.
  if(req.method==='GET'&&url.pathname==='/authorization'){if(this.completed())throw Error('INSTALLATION_CLOSED');return {data:await this.authorization(true)}};
  if(req.method==='POST'&&req.headers.origin!==this.options.adminOrigin)throw Error('INSTALL_ORIGIN_REJECTED');
  if(req.method==='POST'&&url.pathname==='/session'){
   if(this.completed())throw Error('INSTALLATION_CLOSED');if(this.attempts.reset<Date.now())this.attempts={count:0,reset:Date.now()+900000};if(++this.attempts.count>15)throw Error('INSTALL_RATE_LIMIT');
   const {token}=z.object({token:z.string().max(100)}).strict().parse(await this.body(req));
   const launch=this.store.read<{hash:string;expires:number}>('launch.json');
   if(!launch||launch.expires<=Date.now()||!this.equal(createHash('sha256').update(token).digest('hex'),launch.hash))throw Error('INSTALL_ACCESS_DENIED');
   this.store.write('launch.json',null);this.attempts.count=0;
   const payload=Buffer.from(JSON.stringify({expires:Date.now()+3600000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
   return {headers:{'set-cookie':`${cookieName}=${payload}.${this.signature(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${this.options.adminOrigin.startsWith('https:')?'; Secure':''}`},data:{csrf:this.signature('csrf:'+payload),job:this.status(),redis:installationRedisView(this.options.redisUrl)}};
  }
  if(!session)throw Error('INSTALL_SESSION_REQUIRED');
  if(req.method==='GET'&&url.pathname==='/status')return {data:this.status()};
  if(req.method!=='POST'||!this.equal(String(req.headers['x-install-csrf']||''),session.csrf))throw Error('INSTALL_CSRF_REJECTED');
  if(this.completed())throw Error('INSTALLATION_CLOSED');
  if(url.pathname==='/resume-health')return {status:202,data:await this.resumeHealth(await this.body(req))};
  if(url.pathname==='/execute')return {status:202,data:await this.execute(await this.body(req))};
  this.writable();
  if(url.pathname==='/authorization')return {data:await this.authorization()};
  if(url.pathname==='/environment')return {data:await this.environment(await this.body(req))};
  if(url.pathname==='/database')return {data:await this.database(await this.body(req))};
  throw Error('INSTALL_INPUT_INVALID');
 }
}
