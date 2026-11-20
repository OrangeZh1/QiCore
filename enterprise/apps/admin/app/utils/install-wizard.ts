import {computed,reactive,ref,watch} from 'vue'

export const installSteps=[
 {title:'安装须知',caption:'开始之前',icon:'i-lucide-file-text'},
 {title:'环境检查',caption:'确认安装条件',icon:'i-lucide-server'},
 {title:'数据库配置',caption:'连接数据服务',icon:'i-lucide-database'},
 {title:'管理员设置',caption:'设置管理账号',icon:'i-lucide-user-round'},
 {title:'正式安装',caption:'初始化系统',icon:'i-lucide-settings'},
 {title:'安装完成',caption:'开启新的应用',icon:'i-lucide-circle-check'},
] as const
export const installPhases=['检查安装条件','核验安装授权','创建数据库结构','保存配置与管理员','检查服务与访问权限','记录安装结果']
export function installStep(value:unknown){return typeof value==='string'&&/^[1-6]$/.test(value)?Number(value)-1:0}
export function installTitle(value:unknown){return `${installSteps[installStep(value)]!.title} · 安装引导 · QiCore`}
export type InstallForm={host:string;port:number|string;database:string;databaseUsername:string;databasePassword:string;username:string;nickname:string;password:string;confirmPassword:string}
export function installFieldErrors(form:InstallForm,step:number){
 const errors:Record<string,string>={}
 if(step===2){
  if(!/^[A-Za-z0-9.:-]{1,253}$/.test(form.host.trim()))errors.host='请填写有效的数据库主机'
  if(!Number.isInteger(Number(form.port))||Number(form.port)<1||Number(form.port)>65535)errors.port='端口须为 1–65535 的整数'
  if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(form.database))errors.database='数据库名称最多 64 位，支持字母、数字、下划线、点及短横线'
  if(!form.databaseUsername.trim()||form.databaseUsername.length>100||/[\0\r\n]/.test(form.databaseUsername))errors.databaseUsername='请填写有效的数据库用户名'
  if(!form.databasePassword)errors.databasePassword='请输入数据库密码'
  else if(form.databasePassword.length>256||form.databasePassword.includes('\0'))errors.databasePassword='数据库密码格式不正确'
 }
 if(step===3){
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(form.username))errors.username='账号须为 3–32 位字母、数字、点、横线或下划线，首位为字母或数字'
  if(!form.nickname.trim()||form.nickname.length>40)errors.nickname='请输入 1–40 位显示名称'
  if(!form.password)errors.password='请输入登录密码'
  else if(form.password.length<6)errors.password='密码至少需要 6 位'
  else if(form.password.length>128)errors.password='密码过长'
  if(!form.confirmPassword||form.confirmPassword!==form.password)errors.confirmPassword='两次输入的密码不一致'
 }
 return errors
}
type CheckState='idle'|'passed'|'failed'
type PhaseState='waiting'|'running'|'passed'|'failed'
export type InstallAuthorization={state:string;allowed:boolean;domain:string;source:string;checkedAt?:string|null}
export const authorizationViews:Record<string,{title:string;hint:string;badge:string}>={
 unchecked:{title:'等待检测安装授权',hint:'按当前访问域名核对本机授权状态。',badge:'待检测'},
 active:{title:'当前域名已通过授权校验',hint:'授权有效，可以继续查看安装流程。',badge:'已授权'},
 updates_unavailable:{title:'当前授权不允许安装此版本',hint:'请核对版本权益或完成相应续期后重新检测。',badge:'安装受限'},
 unlicensed:{title:'当前域名尚未获得授权',hint:'请联系服务提供方开通授权或核对绑定域名，再重新检测。',badge:'未授权'},
 expired:{title:'软件授权已到期',hint:'请完成授权续期后重新检测。',badge:'已到期'},
 suspended:{title:'软件授权已停用',hint:'请联系服务提供方核实授权状态，恢复后再继续。',badge:'已停用'},
 verification_failed:{title:'授权信息未通过安全验证',hint:'签名或实例信息不匹配，请核对安装包来源及系统时间。',badge:'验签失败'},
 domain_mismatch:{title:'访问域名与授权域名不一致',hint:'请使用已授权的域名访问，或完成域名变更后重新检测。',badge:'域名不匹配'},
 grace:{title:'当前处于离线宽限期',hint:'首次安装需要有效的在线授权状态，请恢复授权连接后重新检测。',badge:'离线宽限'},
 unavailable:{title:'暂时无法确认安装授权',hint:'请检查本地 API 与授权服务状态后重试，检测失败不代表未授权。',badge:'检测失败'},
}
const pause=(signal:AbortSignal)=>new Promise<void>(resolve=>{
 const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()}
 const timer=setTimeout(done,700);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done()
})
// Only the injected authorization reader can access the network. Installation is in-memory preview state.
export function createInstallPreview(initial=0,delay=pause,readAuthorization?:(signal:AbortSignal)=>Promise<InstallAuthorization>){
 const step=ref(initial),accepted=ref(false),errors=ref<Record<string,string>>({}),notice=ref('')
 const environment=ref<CheckState>('idle'),connections=ref<CheckState>('idle')
 const checkingEnvironment=ref(false),checkingConnections=ref(false),installing=ref(false)
 const authorization=ref<InstallAuthorization>({state:'unchecked',allowed:false,domain:'',source:'verified-local-receipt'}),checkingAuthorization=ref(false),authorizationScenario=ref('live')
 const authorizationView=computed(()=>authorizationViews[authorization.value.state]||authorizationViews.unavailable!)
 const authorizationAllowed=computed(()=>authorization.value.state==='active'&&authorization.value.allowed===true)
 const environmentResult=ref('success'),connectionResult=ref('success'),installationResult=ref('success')
 const phases=ref<PhaseState[]>(installPhases.map(()=>'waiting')),installationError=ref('')
 const canResume=computed(()=>phases.value[4]==='failed'),resuming=ref(false)
 const form=reactive<InstallForm>({host:'127.0.0.1',port:3306,database:'qicore',databaseUsername:'',databasePassword:'',username:'admin',nickname:'总管理员',password:'',confirmPassword:''})
 const redis=reactive({host:'127.0.0.1',port:6379,database:0,username:'',password:'',tls:false,hasPassword:false,keepPassword:false})
 let environmentRequest:AbortController|undefined,connectionRequest:AbortController|undefined,installRequest:AbortController|undefined
 let authorizationRequest:AbortController|undefined
 const locked=computed(()=>checkingEnvironment.value||checkingConnections.value||installing.value||checkingAuthorization.value)
 const progress=computed(()=>Math.round(phases.value.filter(state=>state==='passed').length/installPhases.length*100))
 function clearPasswords(){form.databasePassword='';form.password='';form.confirmPassword='';redis.password=''}
 const stopRedisWatch=watch(()=>({...redis}),()=>{environmentRequest?.abort();environmentRequest=undefined;checkingEnvironment.value=false;environment.value='idle'},{flush:'sync'})
 const stopWatch=watch(()=>[form.host,form.port,form.database,form.databaseUsername,form.databasePassword],()=>{
  connectionRequest?.abort();connectionRequest=undefined;checkingConnections.value=false;connections.value='idle'
 },{flush:'sync'})
 function validate(target:number){errors.value=installFieldErrors(form,target);return !Object.keys(errors.value).length}
 async function checkAuthorization(){
  if(locked.value)return
  const request=new AbortController();authorizationRequest=request;checkingAuthorization.value=true;notice.value='';const scenario=authorizationScenario.value
  authorization.value={...authorization.value,state:'unchecked',allowed:false}
  try{
   let value:InstallAuthorization
   if(scenario==='live'){if(!readAuthorization)throw Error('UNAVAILABLE');value=await readAuthorization(request.signal)}
   else{await delay(request.signal);value={state:scenario,allowed:scenario==='active',domain:authorization.value.domain||'preview.example.com',source:'preview'}}
   if(request.signal.aborted||authorizationRequest!==request)return
   authorization.value={...value,allowed:value.state==='active'&&value.allowed===true}
  }catch{if(!request.signal.aborted&&authorizationRequest===request)authorization.value={...authorization.value,state:'unavailable',allowed:false,source:scenario==='live'?'verified-local-receipt':'preview'}}
  finally{if(authorizationRequest===request){checkingAuthorization.value=false;authorizationRequest=undefined}}
 }
 function changeAuthorization(value:string){if(locked.value)return;authorizationScenario.value=value;void checkAuthorization()}
 async function inspectEnvironment(){
  if(locked.value)return
  const request=new AbortController();environmentRequest=request;checkingEnvironment.value=true;notice.value='';environment.value='idle';const result=environmentResult.value
  try{await delay(request.signal);if(request.signal.aborted||environmentRequest!==request)return;environment.value=result==='success'?'passed':'failed'}
  finally{if(environmentRequest===request){checkingEnvironment.value=false;environmentRequest=undefined}}
 }
 async function testConnections(){
  if(locked.value||!validate(2))return
  const request=new AbortController();connectionRequest=request;checkingConnections.value=true;connections.value='idle';notice.value='';const result=connectionResult.value
  try{await delay(request.signal);if(request.signal.aborted||connectionRequest!==request)return;connections.value=result==='success'?'passed':'failed'}
  finally{if(connectionRequest===request){checkingConnections.value=false;connectionRequest=undefined}}
 }
 function showStep(target:number){
  if(locked.value||!Number.isInteger(target)||target<0||target>5)return
  step.value=target;errors.value={};notice.value=''
 }
 function next(){
  if(locked.value)return
  notice.value=''
  if(!authorizationAllowed.value){notice.value=authorizationView.value.hint;return}
  if(step.value===0&&!accepted.value){notice.value='请先阅读并勾选安装须知';return}
  if(step.value===1&&environment.value!=='passed'){notice.value='请先完成环境检查预览';return}
  if(step.value===2){if(!validate(2))return;if(connections.value!=='passed'){notice.value='请先完成连接检查预览';return}}
  if(step.value===3&&!validate(3))return
  if(step.value<4)showStep(step.value+1)
 }
 async function runInstallation(resume=false){
  if(locked.value)return
  if(!authorizationAllowed.value){notice.value=authorizationView.value.hint;return}
  const request=new AbortController();installRequest=request;installing.value=true;resuming.value=resume;installationError.value='';notice.value='';if(!resume)phases.value=installPhases.map(()=>'waiting');const result=installationResult.value
  try{
   for(let index=resume?4:0;index<installPhases.length;index++){
    phases.value[index]='running';await delay(request.signal)
    if(request.signal.aborted||installRequest!==request)return
    if(index===2&&result==='failure'){phases.value[index]='failed';installationError.value='创建数据库结构未完成。此为失败效果演示，当前数据库没有发生任何变化。';return}
    if(index===4&&result==='health-failure'&&!resume){phases.value[index]='failed';installationError.value='服务启动检查未通过。此为恢复效果演示，当前数据库没有发生任何变化。';return}
    phases.value[index]='passed'
   }
   clearPasswords();step.value=5
  }finally{if(installRequest===request){installing.value=resuming.value=false;installRequest=undefined}}
 }
 const simulateInstallation=()=>runInstallation(),retryInstallation=()=>canResume.value?runInstallation(true):Promise.resolve()
 function cancelInstallation(){if(!installRequest)return;installRequest.abort();installRequest=undefined;installing.value=resuming.value=false;phases.value=phases.value.map(state=>state==='running'?'waiting':state);notice.value='已停止本次安装演示，可以重新开始。'}
 function dispose(){environmentRequest?.abort();connectionRequest?.abort();installRequest?.abort();authorizationRequest?.abort();environmentRequest=connectionRequest=installRequest=authorizationRequest=undefined;checkingEnvironment.value=checkingConnections.value=installing.value=resuming.value=checkingAuthorization.value=false;stopWatch();stopRedisWatch();clearPasswords()}
 return{step,accepted,errors,notice,environment,connections,checkingEnvironment,checkingConnections,installing,environmentResult,connectionResult,installationResult,phases,installationError,form,redis,locked,progress,authorization,checkingAuthorization,authorizationScenario,authorizationView,authorizationAllowed,canResume,resuming,retryInstallation,checkAuthorization,changeAuthorization,inspectEnvironment,testConnections,showStep,next,simulateInstallation,cancelInstallation,dispose}
}
