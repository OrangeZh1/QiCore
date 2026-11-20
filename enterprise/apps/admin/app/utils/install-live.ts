import {computed,reactive,ref,watch} from 'vue'
import {installFieldErrors,installPhases,authorizationViews,type InstallAuthorization,type InstallForm} from './install-wizard.ts'

export type InstallJob={id:string|null;status:string;phase:string;code:string|null;message:string|null;complete:boolean;canResume?:boolean;reportPending?:boolean}
type RedisView={host:string;port:number;database:number;username:string;tls:boolean;hasPassword:boolean}
export type InstallState={available:boolean;complete:boolean;authenticated:boolean;csrf?:string;job?:InstallJob;redis?:RedisView}
type Call=(path:string,options:{method:'GET'|'POST';body?:unknown;signal?:AbortSignal;headers?:Record<string,string>})=>Promise<any>
const pause=(signal:AbortSignal)=>new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,1000);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done()})
const message=(error:any)=>error?.data?.error?.message||error?.message||'请求未完成，请稍后重试'

export function createLiveInstall(initial:InstallState,call:Call,delay=pause){
 const authenticated=ref(initial.authenticated),csrf=ref(initial.csrf||''),accessBusy=ref(false),accessError=ref('')
 const step=ref(initial.complete?5:initial.job&&initial.job.status!=='idle'?4:0),accepted=ref(false),errors=ref<Record<string,string>>({}),notice=ref('')
 const environment=ref('idle'),connections=ref('idle'),environmentChecks=ref<{key:string;label:string;passed:boolean;message?:string}[]>([])
 const checkingEnvironment=ref(false),checkingConnections=ref(false),checkingAuthorization=ref(false),installing=ref(false),recoveryRequired=ref(false)
 const canResume=ref(false),resuming=ref(false),failedBeforeInstall=ref(false);let recoveryId:string|null=null
 const authorization=ref<InstallAuthorization>({state:'unchecked',allowed:false,domain:'',source:'verified-online-receipt'}),authorizationScenario=ref('live')
 const authorizationView=computed(()=>authorizationViews[authorization.value.state]||authorizationViews.unavailable!),authorizationAllowed=computed(()=>authorization.value.state==='active'&&authorization.value.allowed)
 const phases=ref<string[]>(installPhases.map(()=>'waiting')),installationError=ref(''),environmentError=ref(''),connectionError=ref('')
 const form=reactive<InstallForm>({host:'127.0.0.1',port:3306,database:'qicore',databaseUsername:'',databasePassword:'',username:'admin',nickname:'总管理员',password:'',confirmPassword:''})
 const redis=reactive({...initial.redis||{host:'127.0.0.1',port:6379,database:0,username:'',tls:false,hasPassword:false},password:'',keepPassword:initial.redis?.hasPassword??false})
 let syncingRedis=false
 const applyRedis=(value?:RedisView)=>{if(!value)return;syncingRedis=true;Object.assign(redis,value,{password:'',keepPassword:value.hasPassword});syncingRedis=false}
 const locked=computed(()=>accessBusy.value||checkingEnvironment.value||checkingConnections.value||checkingAuthorization.value||installing.value||resuming.value)
 const progress=computed(()=>Math.round(phases.value.filter(p=>p==='passed').length/installPhases.length*100))
 const requests=new Map<string,AbortController>();let disposed=false,requestId:string|undefined,polling:Promise<void>|undefined
 const request=(key:string)=>{requests.get(key)?.abort();const controller=new AbortController();requests.set(key,controller);return controller}
 const current=(key:string,controller:AbortController)=>!disposed&&!controller.signal.aborted&&requests.get(key)===controller
 const api=(path:string,body?:unknown,signal?:AbortSignal)=>call(path,{method:body===undefined?'GET':'POST',body,signal,headers:csrf.value?{'x-install-csrf':csrf.value}:undefined})
 const database=()=>({host:form.host.trim(),port:Number(form.port),database:form.database,username:form.databaseUsername,password:form.databasePassword})
 const clearPasswords=()=>{form.databasePassword='';form.password='';form.confirmPassword='';syncingRedis=true;redis.password='';syncingRedis=false}
 const stopRedisWatch=watch(()=>[redis.host,redis.port,redis.database,redis.username,redis.password,redis.tls,redis.keepPassword],()=>{if(syncingRedis)return;requests.get('environment')?.abort();requests.delete('environment');checkingEnvironment.value=false;environment.value='idle';environmentError.value='';environmentChecks.value=[];requestId=undefined},{flush:'sync'})
 const stopWatch=watch(()=>[form.host,form.port,form.database,form.databaseUsername,form.databasePassword],()=>{requests.get('database')?.abort();requests.delete('database');checkingConnections.value=false;connections.value='idle';connectionError.value='';requestId=undefined},{flush:'sync'})
 function applyJob(job:InstallJob){
  if(job.status==='idle')return
  step.value=job.complete?5:4;installing.value=job.status==='running';recoveryRequired.value=job.status==='recovery_required';installationError.value=job.message||''
  failedBeforeInstall.value=job.status==='failed';
  canResume.value=job.canResume===true;recoveryId=job.id
  if(job.status!=='running')resuming.value=false
  const index=({start:0,database:2,migration:2,configuration:3,health:4,completion:5} as Record<string,number>)[job.phase]??0
  phases.value=installPhases.map((_,i)=>job.complete?'passed':i<index?'passed':i===index?['failed','recovery_required'].includes(job.status)?'failed':'running':'waiting')
  if(job.complete)clearPasswords()
 }
 async function poll(){
  if(polling)return polling
  const controller=request('poll')
  polling=(async()=>{let failures=0;while(current('poll',controller)&&installing.value){try{const job=await api('/status',undefined,controller.signal);if(!current('poll',controller))return;applyJob(job);failures=0}catch(error){if(!current('poll',controller))return;if(++failures>=45){installationError.value='暂时无法读取安装进度，请刷新页面继续查看；服务器上的任务不会因此取消。';installing.value=resuming.value=false;return}}if(installing.value)await delay(controller.signal)}})().finally(()=>{polling=undefined});return polling
 }
 async function openAccess(token:string){
  if(disposed||accessBusy.value)return;requests.get('authorization')?.abort();requests.delete('authorization');checkingAuthorization.value=false;
  const controller=request('access');accessBusy.value=true;accessError.value=''
  try{const result=await api('/session',{token},controller.signal);if(!current('access',controller))return;authenticated.value=true;csrf.value=result.csrf;applyRedis(result.redis);applyJob(result.job)}catch(error){if(current('access',controller))accessError.value=message(error)}finally{if(current('access',controller))accessBusy.value=false}
  if(installing.value)void poll();else if(step.value<5)void checkAuthorization()
 }
 async function checkAuthorization(){
  if(locked.value)return;const controller=request('authorization');checkingAuthorization.value=true;notice.value=''
  try{const value=await api('/authorization',authenticated.value&&!recoveryRequired.value?{}:undefined,controller.signal);if(current('authorization',controller))authorization.value={...value,allowed:value.state==='active'&&value.allowed===true}}catch(error){if(current('authorization',controller)){authorization.value={...authorization.value,state:'unavailable',allowed:false};notice.value=message(error)}}finally{if(current('authorization',controller))checkingAuthorization.value=false}
 }
 async function inspectEnvironment(){
  if(locked.value||!authenticated.value)return;const controller=request('environment');checkingEnvironment.value=true;environmentError.value=''
  try{const input={host:redis.host.trim(),port:Number(redis.port),database:Number(redis.database),username:redis.username,tls:redis.tls,...(redis.keepPassword?{}:{password:redis.password})};const result=await api('/environment',{redis:input},controller.signal);if(!current('environment',controller))return;environmentChecks.value=result.checks;environment.value=result.passed?'passed':'failed';if(result.passed)applyRedis(result.redis);else environmentError.value='安装条件未通过，请核查未通过的项目后重新检测。'}catch(error){if(current('environment',controller)){environment.value='failed';environmentError.value=message(error)}}finally{if(current('environment',controller))checkingEnvironment.value=false}
 }
 async function testConnections(){
  if(locked.value||!authenticated.value)return;errors.value=installFieldErrors(form,2);if(Object.keys(errors.value).length)return;const controller=request('database');checkingConnections.value=true;connectionError.value=''
  try{const result=await api('/database',database(),controller.signal);if(current('database',controller))connections.value=result.passed?'passed':'failed'}catch(error){if(current('database',controller)){connections.value='failed';connectionError.value=message(error)}}finally{if(current('database',controller))checkingConnections.value=false}
 }
 function showStep(target:number){if(!locked.value&&!recoveryRequired.value&&target>=0&&target<step.value){step.value=target;errors.value={};notice.value=''}}
 function next(){
  if(locked.value||!authenticated.value)return;notice.value=''
  if(!authorizationAllowed.value){notice.value=authorizationView.value.hint;return}
  if(step.value===0&&!accepted.value){notice.value='请先阅读并同意安装须知';return}
  if(step.value===1&&environment.value!=='passed'){notice.value='请先通过环境检查';return}
  if(step.value===2||step.value===3){errors.value=installFieldErrors(form,step.value);if(Object.keys(errors.value).length)return}
  if(step.value===2&&connections.value!=='passed'){notice.value='请先通过数据库连接检查';return}
  if(step.value<4)step.value++
 }
 async function simulateInstallation(){
  if(locked.value||!authenticated.value||recoveryRequired.value||!authorizationAllowed.value)return
  if(!accepted.value){step.value=0;notice.value='请重新阅读并同意安装须知，再检查安装信息';return}
  errors.value={...installFieldErrors(form,2),...installFieldErrors(form,3)};if(Object.keys(errors.value).length){step.value=Object.keys(installFieldErrors(form,2)).length?2:3;notice.value=failedBeforeInstall.value?'上次安装未通过，密码已清空，请重新填写并检测；失败原因仍保留在安装结果中。':'请检查标出的数据库或管理员信息';return}
  const controller=request('install');installing.value=true;installationError.value='';failedBeforeInstall.value=false;requestId??=crypto.randomUUID();
  try{await api('/execute',{requestId,database:database(),administrator:{username:form.username,nickname:form.nickname,password:form.password},acceptTerms:true},controller.signal);if(!current('install',controller))return;clearPasswords();void poll()}
  catch(error){if(!current('install',controller))return;try{const job=await api('/status',undefined,controller.signal);if(!current('install',controller))return;if(job.id===requestId&&job.status!=='idle'){applyJob(job);if(installing.value)void poll();return}}catch{}installing.value=false;installationError.value=message(error)}
 }
 async function retryInstallation(){
  if(locked.value||!authenticated.value||!canResume.value||!recoveryId)return
  const controller=request('recovery');resuming.value=true;installationError.value=''
  try{await api('/resume-health',{requestId:recoveryId},controller.signal);if(!current('recovery',controller))return;installing.value=true;void poll()}
  catch(error){if(current('recovery',controller)){resuming.value=false;installationError.value=message(error)}}
 }
 async function resume(token?:string){if(token&&!authenticated.value)return openAccess(token);if(initial.job)applyJob(initial.job);if(installing.value)void poll();else if(step.value<5)void checkAuthorization()}
 function dispose(){disposed=true;for(const controller of requests.values())controller.abort();requests.clear();checkingEnvironment.value=checkingConnections.value=checkingAuthorization.value=accessBusy.value=installing.value=resuming.value=false;stopWatch();stopRedisWatch();clearPasswords()}
 if(initial.job)applyJob(initial.job)
 return {step,accepted,errors,notice,environment,connections,checkingEnvironment,checkingConnections,checkingAuthorization,installing,phases,installationError,form,redis,locked,progress,authorization,authorizationScenario,authorizationView,authorizationAllowed,authenticated,accessBusy,accessError,environmentChecks,environmentError,connectionError,recoveryRequired,canResume,resuming,retryInstallation,checkAuthorization,inspectEnvironment,testConnections,showStep,next,simulateInstallation,resume,dispose,environmentResult:ref(''),connectionResult:ref(''),installationResult:ref(''),changeAuthorization:()=>{},cancelInstallation:()=>{}}
}
