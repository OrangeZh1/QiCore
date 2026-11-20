import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {LicenseClient,loadProduct,normalizeDomain,authorizationFailureCode,validateProduct,type Product} from './client.js';
import {StateStore} from './store.js';
import {checkDockerPlan} from './updates.js';
import {licenseFailureNotice} from '../core/system-status.mjs';
import {fail} from '../core/errors.mjs';
import {updaterRequest} from '../lifecycle/updater-client.js';
import {developmentWorkspace,developmentLicenseTransport} from '../applications/development-workspace.mjs';

type CheckRecord={checkedAt:string;error:string|null;failures?:number};
type UpdateRecord={state:string;label:string;description:string;checkedAt:string;latestVersion:string|null;releaseNotes?:string;mandatory?:boolean;miniProgramUpdateRequired?:boolean};
function interval(name:string,fallback:number,min:number,max:number){const value=Number(process.env[name]||fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error('INVALID_'+name);return value*1000;}
export function defaultLicenseStatePath(product:ReturnType<typeof loadProduct>){
  if(!product.appKey||!/^[a-z][a-z0-9_]{1,63}$/.test(product.appKey))throw Error('APPKEY_REQUIRED');
  return join(fileURLToPath(new URL('../../../../.local/license/',import.meta.url)),product.appKey);
}
type InstalledComponent = {packageKey:string;version:string|null;componentType?:string}
type StandaloneComposition = {frameworkVersion:string; main:InstalledComponent|null; components:ReadonlyMap<string,string>}

export class LicenseRuntime {
  private readonly commercialClient: LicenseClient | null;
  readonly frameworkVersion: string;
  readonly standalone?: StandaloneComposition;

  get client():LicenseClient {
    if (!this.commercialClient) throw new Error('STANDALONE_COMMERCIAL_PRODUCT_REQUIRED');
    return this.commercialClient;
  }
  get licensedClient(){ return this.commercialClient }

  static forStandalone(frameworkVersion:string, installed:InstalledComponent[]) {
    const mains=installed.filter(c=>(c.componentType??'app')==='app');
    if(mains.length>1 || (!mains.length && installed.length)) throw new Error('STANDALONE_COMPOSITION_INVALID');
    const components=new Map(installed.map(c=>[c.packageKey,c.componentType??'app']));
    if(components.size!==installed.length) throw new Error('DUPLICATE_COMPONENT_IDENTITY');
    return new LicenseRuntime(undefined,{frameworkVersion,main:mains[0]??null,components});
  }

  private pending?:Promise<ReturnType<LicenseRuntime['view']>>;
  private checkingUpdates=false;
  private timer?:ReturnType<typeof setInterval>;
  readonly authorizationIntervalMs=interval('LICENSE_CHECK_INTERVAL_SECONDS',300,60,3600);
  readonly updateIntervalMs=interval('UPDATE_CHECK_INTERVAL_SECONDS',21600,300,86400);
  constructor(client?:LicenseClient,standalone?:StandaloneComposition){
    this.standalone=standalone;
    this.frameworkVersion=standalone?.frameworkVersion ?? client?.product.version ?? '';
    if(standalone && !standalone.main) {
      if(process.env.QICORE_STANDALONE_PRODUCT_FILE) throw new Error('STANDALONE_PRODUCT_WITHOUT_APPLICATION');
      this.commercialClient=null;
      return;
    }
    if(client){ this.commercialClient=client; return; }
    const development=developmentWorkspace();
    let product:Product;
    if(standalone && !development){
      const source=process.env.QICORE_STANDALONE_PRODUCT_FILE;
      if(!source)throw new Error('STANDALONE_TRUSTED_APP_PRODUCT_REQUIRED');
      product=JSON.parse(readFileSync(source,'utf8'));
      validateProduct(product);
      if(product.componentType!=='app'||product.deliveryKind!=='archive'||product.appKey!==standalone.main!.packageKey||product.version!==standalone.main!.version)throw new Error('STANDALONE_PRODUCT_IDENTITY_MISMATCH');
    }else{product=loadProduct()}
    this.commercialClient=new LicenseClient(new StateStore(process.env.LICENSE_STATE_PATH||defaultLicenseStatePath(product)),product,normalizeDomain(process.env.LICENSE_DOMAIN||'127.0.0.1'),development?developmentLicenseTransport(development,product):undefined);
  }
  private status(){try{return this.client.status()}catch(error){return {state:'locked',reason:authorizationFailureCode(error),updatesEligible:false,receipt:undefined}}}
  view(){
    if (!this.commercialClient) return {
      provider:'QiCore',integration:'free_framework',allowed:true,
      license:{state:'free',reason:'FREE_STANDALONE_FRAMEWORK',verified:false,label:'免费框架',description:'当前实例运行 QiCore 单开框架。',companyName:null,domain:null,expiresAt:null,expiryKnown:false,permanent:false,updatesExpiresAt:null,checkedAt:null,lastCheckFailed:false},
      update:{state:'not_configured',label:'框架随产品交付',description:'主应用及功能插件按同一产品版本升级。',currentVersion:this.frameworkVersion,latestVersion:null,checkedAt:null,releaseNotes:'',mandatory:false,miniProgramUpdateRequired:false},canCheck:false,
      automatic:{enabled:false,authorizationIntervalSeconds:0,updateIntervalSeconds:0}
    };
    const status=this.status(),receipt=status.receipt,entitlement=receipt?.entitlements.find(e=>e.packageKey===this.client.product.appKey);
    const check=this.client.store.read<CheckRecord>('authorization-check.json');
    const update=this.client.store.read<UpdateRecord>('update-check.json');
    const allowed=['active','grace'].includes(status.state);
    const notice=allowed?{state:status.state,label:status.state==='active'?'授权正常':'离线宽限中',description:status.state==='active'?'授权回执已通过签名与实例绑定校验':'当前处于签名回执允许的离线宽限期，请恢复授权服务连接'}:licenseFailureNotice(status.reason);
    if(!allowed&&entitlement){const message=notice.state==='expired'?entitlement.licenseExpiredMessage:notice.state==='suspended'?entitlement.suspendedMessage:notice.state==='unlicensed'?entitlement.unauthorizedMessage:null;if(message)notice.description=message;}
    return {provider:'QiLicense',integration:'configured',allowed,
      license:{...notice,reason:status.reason,verified:!!receipt,companyName:receipt?.company_name||null,domain:this.client.domain,expiresAt:entitlement?.useExpiresAt||null,expiryKnown:!!entitlement,permanent:!!entitlement&&entitlement.useExpiresAt===null,updatesExpiresAt:entitlement?.updatesExpiresAt||null,checkedAt:check?.checkedAt||null,lastCheckFailed:!!check?.error},
      update:{state:update?.state||'not_checked',label:update?.label||'尚未检查',description:update?.description||'可检查授权允许的可用版本',currentVersion:this.client.product.version,latestVersion:update?.latestVersion||null,checkedAt:update?.checkedAt||null,releaseNotes:update?.releaseNotes||'',mandatory:update?.mandatory||false,miniProgramUpdateRequired:update?.miniProgramUpdateRequired||false},canCheck:true,
      automatic:{enabled:true,authorizationIntervalSeconds:this.authorizationIntervalMs/1000,updateIntervalSeconds:this.updateIntervalMs/1000}};
  }
  assertAllowed(){const state=this.view();if(!state.allowed)fail('LICENSE_'+state.license.state.toUpperCase(),state.license.description,403);}
  componentAllowed(packageKey:string,type:'framework'|'app'|'plugin'='app'){if(!this.commercialClient||this.standalone&&this.standalone.components.get(packageKey)!==type)return false;try{return ['active','grace'].includes(this.client.componentStatus(packageKey,type).state)}catch{return false}}
  assertComponentAllowed(packageKey:string,type:'framework'|'app'|'plugin'='app'){
    this.assertAllowed();
    if(!this.commercialClient||this.standalone&&this.standalone.components.get(packageKey)!==type)fail('COMPONENT_NOT_INSTALLED','组件未包含在当前产品中',403);
    let status;try{status=this.client.componentStatus(packageKey,type)}catch{fail('APPLICATION_LICENSE_UNAVAILABLE','应用授权暂时无法核验，请联系平台管理员',403)}
    if(!['active','grace'].includes(status!.state)){const notice=licenseFailureNotice(status!.reason);fail('APPLICATION_LICENSE_'+notice.state.toUpperCase(),'应用'+notice.label+'，请联系平台管理员核实授权',403)}
  }
  updateCenter(){return {...this.view(),productName:this.commercialClient?.product.name||'QiCore',
    installer:{available:false,canInstall:false,reason:'当前部署尚未接入更新执行器，不能执行自动安装。'},
    history:{available:false,items:[],total:null,description:'尚未接入安装记录来源，暂无法读取已完成的更新日志。'}};}
  check(updates=false):Promise<ReturnType<LicenseRuntime['view']>>{if(!this.commercialClient)return Promise.resolve(this.view());if(this.pending)return updates&&!this.checkingUpdates?this.pending.then(()=>this.check(true)):this.pending;this.checkingUpdates=updates;this.pending=this.run(updates).finally(()=>{this.pending=undefined;this.checkingUpdates=false});return this.pending;}
  private async run(updates:boolean){
    let error:string|null=null;
    try{
      const status=this.status();
      if(!this.client.identity()||!status.receipt?.license_id){
        if(this.standalone && !developmentWorkspace())throw new Error('STANDALONE_PRODUCT_INSTALLATION_REQUIRED');
        await this.client.activate();
      }
      else await this.client.renew();
    }catch(cause){error=authorizationFailureCode(cause);}
    const previous=this.client.store.read<CheckRecord>('authorization-check.json');
    this.client.store.write('authorization-check.json',{checkedAt:new Date().toISOString(),error,failures:error?(previous?.failures||0)+1:0});
    if(updates){
      const checkedAt=new Date().toISOString();let value:UpdateRecord;
      try{
        if(error)throw new Error('AUTHORIZATION_CHECK_FAILED');
        if(this.client.product.product==='qicore-local-development'){
          value={checkedAt,state:'not_configured',label:'本地开发',description:'应用源码由开发进程自动更新。',latestVersion:null};
        }else if(this.standalone){
          value={checkedAt,state:'managed',label:'整包更新',description:'由当前商业产品的交付助手检查与更新',latestVersion:null};
        }else if(this.client.product.deliveryKind==='archive'){
          if(!process.env.UPDATER_SOCKET)throw Error('NATIVE_INSTALLATION_REQUIRED');
          value=await updaterRequest<UpdateRecord>('/check',{packageKey:this.client.product.appKey});
        }else{
          const {release}=await checkDockerPlan(this.client);
          value={checkedAt,state:release?'available':'current',label:release?'发现新版本':'暂无可用更新',description:release?'已核验可信发布信息；此处不执行安装':'授权服务已确认当前没有更高的可用版本',latestVersion:release?.version||null,releaseNotes:release?.releaseNotes||'',mandatory:/^强制更新：是\s*$/m.test(release?.releaseNotes||''),miniProgramUpdateRequired:/^小程序更新：需要客户自行上传\s*$/m.test(release?.releaseNotes||'')};
        }
      }catch(cause){
        const code=cause instanceof Error?cause.message:'';
        const messages:Record<string,string>={SCOPED_UPDATE_DEPENDENCY_CONFLICT:'已安装应用与目标版本存在依赖冲突，请先更新相关应用到兼容版本，再检查更新。',NATIVE_INSTALLATION_REQUIRED:'当前源码环境没有原生安装回执，请先完成正式原生安装',INSTALLATION_REPORT_REQUIRED:'当前是本地开发接入，尚未完成正式安装登记，暂不能检查 Docker 更新',UPDATE_NOT_ELIGIBLE:'当前授权不具备有效的在线更新权益',RELEASE_TRUST_REQUIRED:'尚未配置发布签名公钥，无法核验新版本',RELEASE_PUBLISHING_DISABLED:'版本服务暂未开放',AUTHORIZATION_CHECK_FAILED:'授权核验未完成，暂不能检查更新'};
        value={checkedAt,state:['INSTALLATION_REPORT_REQUIRED','NATIVE_INSTALLATION_REQUIRED'].includes(code)?'installation_required':'unavailable',label:['INSTALLATION_REPORT_REQUIRED','NATIVE_INSTALLATION_REQUIRED'].includes(code)?'待安装登记':'检查未完成',description:messages[code]||'暂时无法完成可信版本检查，请稍后重试',latestVersion:null};
      }
      this.client.store.write('update-check.json',value);
    }
    return this.view();
  }
  async autoCheck(now=Date.now()){
    if(!this.commercialClient)return Promise.resolve(this.view());
    if(this.pending)return this.pending;
    const status=this.status(),last=this.client.store.read<CheckRecord>('authorization-check.json'),update=this.client.store.read<UpdateRecord>('update-check.json');
    const lastCheck=Date.parse(last?.checkedAt||''),lastUpdate=Date.parse(update?.checkedAt||'');
    const retryDelay=Math.min(300000,60000*2**Math.min(Math.max((last?.failures||1)-1,0),3));
    const refreshAt=status.receipt?Date.parse(status.receipt.refresh_after):0;
    const authDue=!Number.isFinite(lastCheck)||(last?.error?now-lastCheck>=retryDelay:now>=Math.min(lastCheck+this.authorizationIntervalMs,refreshAt));
    const updateDue=!Number.isFinite(lastUpdate)||now-lastUpdate>=(update?.state==='unavailable'?300000:this.updateIntervalMs);
    // A failed authorization request must finish its backoff before update checks can retry it.
    if(last?.error&&Number.isFinite(lastCheck)&&now-lastCheck<retryDelay)return this.view();
    if(authDue||updateDue)return this.check(updateDue);
    return this.view();
  }
  start(){if(!this.commercialClient||this.timer)return;void this.autoCheck().catch(()=>{});this.timer=setInterval(()=>{void this.autoCheck().catch(()=>{});},30000);this.timer.unref();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
}
