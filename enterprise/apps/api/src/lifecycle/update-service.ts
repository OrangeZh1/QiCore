import {StandaloneUpdates} from '../applications/standalone-updates.js';
import { fail } from '../core/errors.mjs';
import type { LicenseRuntime } from '../license/runtime.js';
import { publicTasks,updaterRequest,type UpdaterStatus } from './updater-client.js';
import {nativeExecuteSchema} from './native-updater.js';
import {applicationRequestSchema} from './native-applications.js';

type LoadedApplication={key:string;name:string;packageKey:string;version:string|null;source:string;componentType?:'app'|'plugin'};

export class UpdateService {
  private readonly productUpdates: StandaloneUpdates;
  async checkWholeProduct(){
    if(!this.license.standalone?.main||!process.env.QICORE_STANDALONE_UPDATER_SOCKET)return this.view();
    await this.productUpdates.check();return this.view();
  }
  constructor(readonly license:LicenseRuntime,readonly call=updaterRequest,readonly loaded:LoadedApplication[]=[],readonly countTenants?:(keys:string[])=>Promise<Record<string,number>>){this.productUpdates=new StandaloneUpdates(license,call)}
  async applications(identities?:{packageKey:string;key:string}[],pendingKeys:string[]=[]){
    if(this.license.standalone&&!this.loaded.length)return {installed:[],purchased:[],catalog:{state:'local',description:'当前框架独立运行'}};
    const client=this.license.client;
    let catalog:Awaited<ReturnType<typeof client.componentCatalog>>|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      // Bound this optional metadata read well below the page's request timeout.
      // A slow shared request can finish/cache in the client for the next refresh.
      catalog=await Promise.race([client.componentCatalog(),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),1500)})]);
    }catch{/* Keep the local inventory visible; no stale catalog grants. */}
    finally{if(timer)clearTimeout(timer)}
    let receipt:ReturnType<typeof client.status>['receipt'];
    try{receipt=client.status().receipt}catch{/* Invalid receipts never supply purchases. */}
    let usage:Record<string,number>|null=null;
    try{if(this.countTenants)usage=await this.countTenants([...new Set([...this.loaded,...(identities??[])].map(app=>app.key))])}catch{/* A failed usage read must not appear as zero occupied slots. */}
    const describe=(packageKey:string,local?:LoadedApplication)=>{
      const componentType=local?.componentType??receipt?.entitlements.find(e=>e.packageKey===packageKey)?.type??'app';
      let state='unlicensed',allowed=false,updatesEligible=false;
      try{const status=client.componentStatus(packageKey,componentType);state=status.state;allowed=['active','grace'].includes(state);updatesEligible=status.updatesEligible}catch{}
      const entitlement=receipt?.entitlements.find(e=>e.packageKey===packageKey&&e.type===componentType);
      const metadata=catalog?.components.find(c=>c.packageKey===packageKey&&c.type===componentType);
      const key=local?.key??identities?.find(app=>app.packageKey===packageKey)?.key;
      // No retained identity means this package has never occupied a tenant slot.
      const count=key?usage?.[key]:identities?0:undefined;
      const tenantUsed=Number.isSafeInteger(count)&&count!>=0?count!:null;
      const tenantLimitKnown=entitlement?.tenantLimit!==undefined;
      const tenantRemaining=tenantLimitKnown&&entitlement!.tenantLimit!==null&&tenantUsed!==null?Math.max(0,entitlement!.tenantLimit!-tenantUsed):null;
      return {packageKey,componentType,key:local?.key||null,name:metadata?.name||local?.name||'已授权应用',description:metadata?.description||'',
        source:local?.source||'catalog',version:local?.version||null,
        // App versions never inherit the framework version; each package needs its own release source.
        update:{state:local?.source==='development'?'development':'not_configured',label:local?.source==='development'?'本地开发，自动重载':'应用更新待接通',description:local?.source==='development'?'源码修改后自动重载，无需在线更新。':'该应用的独立版本检查尚未接通。',
          currentVersion:local?.version||null,latestVersion:null,checkedAt:null,canCheck:false},
        history:{available:false,items:[] as {version:string;installedAt:string;releaseNotes:string}[]},
        license:{state,allowed,label:allowed?(state==='grace'?'离线宽限中':'授权正常'):entitlement?.useExpiresAt&&Date.parse(entitlement.useExpiresAt)<=Date.now()?'授权已到期':'授权不可用',
          expiresAt:entitlement?.useExpiresAt||null,expiryKnown:!!entitlement,updatesExpiresAt:entitlement?.updatesExpiresAt||null,updatesEligible,
          tenantLimit:entitlement?.tenantLimit??null,tenantLimitKnown,tenantUsed,tenantUsageKnown:tenantUsed!==null,tenantRemaining},
        management:{available:false,canInstall:false,canRepair:false,canUninstall:false,reason:local?.source==='development'?'当前应用通过本地开发工作区加载，源码变化由开发进程重载。':local?'当前应用随框架内置，独立更新、修复和卸载尚未开放。':'当前没有可用的应用安装执行器。'}};
    };
    const installed=this.loaded.map(local=>describe(local.packageKey,local));
    // Keep an unfinished component discoverable after install/uninstall changes
    // runtime inventory, including expired entitlements. This grants no actions.
    if(this.license.standalone)return {installed,purchased:[],catalog:{state:'local',description:'随当前产品装配的应用和插件'}};
    const purchasedKeys=[...new Set([...(receipt?.entitlements||[]).filter(e=>e.type==='app'||e.type==='plugin').map(e=>e.packageKey),...pendingKeys])].filter(key=>key!==client.product.appKey&&!this.loaded.some(local=>local.packageKey===key));
    const purchased=purchasedKeys.map(key=>describe(key)).filter(app=>app.license.allowed||pendingKeys.includes(app.packageKey));
    return {installed,purchased,catalog:{state:catalog?'verified':'unavailable',checkedAt:catalog?.issuedAt||null,
      description:catalog?'':'应用目录暂未同步，应用授权仍以当前可信回执为准。可检查授权后重试。'}};
  }
  async view(){
    if(this.license.standalone)return this.productUpdates.view(await this.applications());
    let state:UpdaterStatus|undefined;
    if(process.env.UPDATER_SOCKET)try{state=await this.call<UpdaterStatus>('/status');if(this.license.client.product.deliveryKind==='archive'&&state.kind!=='native')state=undefined}catch{}
    const pendingKeys=(state?.tasks??[]).filter(task=>['running','recovery_required'].includes(task.status)).map(task=>task.request?.packageKey??task.packageKey).filter((key):key is string=>!!key);
    const applications=await this.applications(state?.applicationIdentities,pendingKeys);
    const base={...this.license.updateCenter(),packageKey:this.license.client.product.appKey,applications};
    if(!process.env.UPDATER_SOCKET)return {...base,tasks:[]};
    try {
      if(!state)throw Error('UPDATER_UNAVAILABLE');const tasks=publicTasks(state.tasks);
      const frameworkKey=this.license.client.product.appKey;
      if(this.license.client.product.deliveryKind==='archive'&&state.kind!=='native')throw Error('NATIVE_EXECUTOR_REQUIRED');
      const items=tasks.filter(t=>t.status==='succeeded'&&t.version&&(!t.packageKey||t.packageKey===frameworkKey)).reverse().map(t=>({version:t.version!,installedAt:t.updatedAt,releaseNotes:t.releaseNotes}));
      const framework=state.components?.find(c=>c.packageKey===frameworkKey);
      if(framework)base.update={...base.update,...framework.update,currentVersion:framework.version};
      for(const app of applications.installed){
        const component=state.components?.find(c=>c.packageKey===app.packageKey);if(!component)continue;
        app.version=component.version;app.source='native';
        app.update={...app.update,...component.update,currentVersion:component.version,canCheck:true};
        app.history={available:true,items:tasks.filter(t=>t.packageKey===app.packageKey&&t.status==='succeeded'&&t.version).reverse().map(t=>({version:t.version!,installedAt:t.updatedAt,releaseNotes:t.releaseNotes}))};
        app.management={available:state.code==='READY'&&app.license.updatesEligible&&app.update.state==='available',canInstall:false,
          canRepair:state.applicationLifecycle===true&&state.code==='READY'&&app.license.allowed&&app.license.updatesEligible,
          canUninstall:state.applicationLifecycle===true&&state.code==='READY',reason:state.code!=='READY'?'执行器正在处理任务或等待恢复':!state.applicationLifecycle?'当前执行器未提供应用生命周期':!app.license.updatesEligible?'当前下载权益不可用，可安全卸载':''};
      }
      for(const app of applications.purchased)app.management={available:false,canInstall:state.applicationLifecycle===true&&state.code==='READY'&&state.backups?.ready===true&&app.license.allowed&&app.license.updatesEligible,canRepair:false,canUninstall:false,
        reason:state.code!=='READY'?'执行器正在处理任务或等待恢复':!state.applicationLifecycle?'当前执行器未提供应用生命周期':!app.license.updatesEligible?'当前下载权益不可用':''};
      const canInstall=state.code==='READY'&&state.backups?.ready===true&&base.allowed&&this.license.client.status().updatesEligible&&base.update.state==='available';
      return {...base,backups:state.backups??{ready:false,code:'BACKUP_CAPABILITY_UNKNOWN'},installer:{available:true,canInstall,reason:state.backups?.ready!==true?'更新前数据库备份当前不可用，请检查数据安全页面与服务器配置':state.code==='READY'?(canInstall?'':'当前没有可安装的更新'):state.code==='RUNNING'?'更新正在执行':state.code==='RECOVERY_REQUIRED'?'更新需要恢复处理':'尚未完成安装登记'},
        history:{available:true,items,total:items.length,description:''},tasks};
    }catch{return {...base,installer:{available:false,canInstall:false,reason:'更新执行器暂时无法连接'},tasks:[]}}
  }
  async execute(body:any){
    if(this.license.standalone)return this.productUpdates.execute(body);
    if(this.license.client.product.deliveryKind==='archive'){
      const parsed=nativeExecuteSchema.safeParse(body);if(!parsed.success)fail('UPDATE_INPUT_INVALID','更新请求格式无效');
      this.license.assertComponentAllowed(parsed.data!.packageKey,parsed.data!.packageKey===this.license.client.product.appKey?'framework':this.license.client.status().receipt?.entitlements.find(item=>item.packageKey===parsed.data!.packageKey)?.type??'app');
      if(!process.env.UPDATER_SOCKET)fail('UPDATER_UNAVAILABLE','当前环境未接入原生更新执行器',409);
      try{return await this.call('/execute',parsed.data)}catch{fail('UPDATE_REJECTED','更新未开始，请刷新状态后重试',409)}
    }
    if(!body||Object.keys(body).sort().join(',')!=='requestId,targetVersion'||typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(body.requestId)
      ||typeof body.targetVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(body.targetVersion))fail('UPDATE_INPUT_INVALID','更新请求格式无效');
    this.license.assertAllowed();
    if(!process.env.UPDATER_SOCKET)fail('UPDATER_UNAVAILABLE','当前环境未接入更新执行器',409);
    try{return await this.call('/execute',body)}catch{fail('UPDATE_REJECTED','更新未开始，请刷新状态后重试',409)}
  }
  async checkComponent(body:any){
    if(this.license.standalone)throw fail('WHOLE_PRODUCT_REQUIRED','此操作由整包更新助手处理',409);
    if(!body||Object.keys(body).join(',')!=='packageKey'||typeof body.packageKey!=='string'||!this.loaded.some(a=>a.packageKey===body.packageKey))fail('UPDATE_INPUT_INVALID','应用更新请求无效');
    this.license.assertComponentAllowed(body.packageKey);
    if(this.license.client.product.deliveryKind!=='archive'||!process.env.UPDATER_SOCKET)fail('UPDATER_UNAVAILABLE','当前应用尚未独立安装',409);
    try{return await this.call('/check',body)}catch{fail('UPDATE_REJECTED','无法完成应用更新检查',409)}
  }
  async resume(body:any){
    if(this.license.standalone)throw fail('WHOLE_PRODUCT_REQUIRED','此操作由整包更新助手处理',409);
    if(!body||Object.keys(body).join(',')!=='taskId'||typeof body.taskId!=='string'||!/^[a-f0-9-]{36}$/.test(body.taskId))fail('UPDATE_INPUT_INVALID','恢复请求格式无效');
    // Recovery of a committed healthy version remains accessible after entitlement expiry.
    try{return await this.call('/resume-closeout',body)}catch{fail('UPDATE_REJECTED','当前更新无法重试收尾，请检查执行器状态',409)}
  }
  async applicationOperation(body:any,execute=false){
    if(this.license.standalone)throw fail('WHOLE_PRODUCT_REQUIRED','此操作由整包更新助手处理',409);
    const parsed=execute?applicationRequestSchema.safeParse(body):applicationRequestSchema.pick({packageKey:true,operation:true}).safeParse(body);
    if(!parsed.success)fail('APPLICATION_INPUT_INVALID','应用操作请求无效');const request=parsed.data!;
    if(request.packageKey===this.license.client.product.appKey)fail('APPLICATION_INPUT_INVALID','该入口仅管理应用');
    if(request.operation!=='uninstall')this.license.assertComponentAllowed(request.packageKey);
    else if(!this.loaded.some(app=>app.packageKey===request.packageKey&&app.source==='native'))fail('APPLICATION_INPUT_INVALID','应用尚未独立安装');
    if(!process.env.UPDATER_SOCKET)fail('UPDATER_UNAVAILABLE','当前环境未接入应用执行器',409);
    try{return await this.call(execute?'/applications/execute':'/applications/check',request)}catch(error){
      const code=error instanceof Error?error.message:'';
      const messages:Record<string,string>={SCOPED_UPDATE_DEPENDENCY_CONFLICT:'已安装应用与目标版本存在依赖冲突，请先更新相关应用到兼容版本，再检查更新。',INSTALLED_RELEASE_METADATA_REQUIRED:'当前已安装版本缺少发行校验记录，无法完成兼容性检查，请联系发行方补齐',APPLICATION_RELEASE_UNAVAILABLE:'暂无兼容的完整应用安装包，请联系发行方发布后再试',LICENSE_NETWORK_ERROR:'暂时无法连接授权服务，请稍后重试',INSTALLATION_REPORT_REQUIRED:'框架安装完成回报尚未确认，请先完成回报后再试',RELEASE_TRUST_REQUIRED:'尚未配置该应用发行签名的可信公钥，请联系管理员',NATIVE_RUNTIME_INCOMPATIBLE:'应用安装包与当前服务器运行环境不兼容',UPDATER_UNAVAILABLE:'应用执行器暂时无法连接，请联系管理员检查运行状态',APPLICATION_TASKS_PENDING:'该应用仍有未完成的支付、退款或任务，请先处理后再卸载',UPDATE_NOT_ELIGIBLE:'当前应用下载权益不可用',COMPONENT_DEPENDENCY_CONFLICT:'其他组件依赖该应用或当前版本不兼容',REPAIR_SOURCE_CHANGED:'原版本的可信文件清单已改变，不能替换修复来源',UNDECLARED_RELEASE_FILE:'应用目录中有未登记文件，请先核查',LOCAL_RELEASE_MODIFIED:'应用文件已修改，请先检查修复',UPDATE_ALREADY_ACTIVE:'已有任务运行或等待恢复',UPDATE_VERSION_CHANGED:'目标版本已改变，请重新检查',APPLICATION_IDENTITY_CHANGED:'应用身份与保留记录不一致',MIGRATION_HISTORY_MISMATCH:'应用迁移记录需要核查'};
      fail('APPLICATION_OPERATION_REJECTED',messages[code]||'应用检查或提交未完成，请刷新状态后重试',409);
    }
  }
}
