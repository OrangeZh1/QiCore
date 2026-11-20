<script setup lang="ts">
import ReleaseHistoryList from '../../components/console/ReleaseHistoryList.vue'
import ReleaseNotesContent from '../../components/console/ReleaseNotesContent.vue'
definePageMeta({layout:'admin'})
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsolePagination from '@orangezh1/qisvc-console-ui/components/ConsolePagination'
import ConsoleQueryButton from '../../components/console/ConsoleQueryButton.vue'
import UpdateProgress from '../../components/console/UpdateProgress.vue'
import {updatePreview,previewScenes} from '../../utils/update-preview'
import AdminConsole from '../../components/console/AdminConsole.vue'
import {releaseNoteLines,releasePresentation,operationTitle,operationSteps,updateStepIndex,dateTime,expiry,applicationTenantQuota} from '../../utils/update-center'

type FileChange={path:string;size:number;kind:'added'|'modified'|'deleted'|'unchanged'}
type Release={name?:string;files?:FileChange[];version:string;releaseNotes:string;installedAt?:string;mandatory?:boolean;miniProgramUpdateRequired?:boolean}
type Application={componentType?:'app'|'plugin';packageKey:string;key:string|null;name:string;description:string;source:string;version:string|null;update:{state:string;label:string;description:string;currentVersion:string|null;latestVersion:string|null;checkedAt:string|null;canCheck:boolean;releaseNotes?:string;manifestSha256?:string;files?:FileChange[]};license:{state:string;allowed:boolean;label:string;expiresAt:string|null;expiryKnown:boolean;updatesExpiresAt:string|null;updatesEligible:boolean;tenantLimit?:number|null;tenantLimitKnown?:boolean;tenantUsed?:number|null;tenantUsageKnown?:boolean;tenantRemaining?:number|null};history?:{available:boolean;items:Release[]};management:{available:boolean;canInstall?:boolean;canRepair?:boolean;canUninstall?:boolean;reason:string}}
type Applications={installed:Application[];purchased:Application[];catalog:{state:string;checkedAt:string|null;description:string}}
type UpdateTask={operation?:string;integrity?:{path:string;kind:'modified'|'missing'|'unknown'|'unsafe'}[];packageKey?:string|null;id:string;status:string;step:string;code?:string;version:string|null;fromVersion:string|null;updatedAt:string}
type UpdateCenter={backups?:{ready:boolean;code:string|null};packageKey?:string|null;applications?:Applications;tasks?:UpdateTask[];productName:string;allowed:boolean;canCheck:boolean;license:{state:string;label:string;description:string;companyName:string|null;domain:string;expiresAt:string|null;expiryKnown:boolean;updatesExpiresAt:string|null;verified:boolean;checkedAt:string|null;lastCheckFailed:boolean};update:{state:string;label:string;description:string;currentVersion:string;latestVersion:string|null;checkedAt:string|null;releaseNotes:string;manifestSha256?:string;files?:FileChange[];mandatory:boolean;miniProgramUpdateRequired:boolean};automatic:{authorizationIntervalSeconds:number;updateIntervalSeconds:number};installer:{available:boolean;canInstall:boolean;reason:string};history:{available:boolean;items:Release[];total:number|null;description:string}}
const preview=import.meta.dev&&useRoute().query.preview==='update'
const previewScene=ref('available'),previewStep=ref('AUTHORIZE')
function showPreview(){if(preview){data.value=updatePreview(previewScene.value,previewStep.value);error.value='';feedback.value=''}}
watch(previewScene,showPreview)
function nextPreviewStep(){const steps=['AUTHORIZE','PULL','BACKUP','HEALTH','CLEANUP'];const i=steps.indexOf(previewStep.value);if(i===steps.length-1)previewScene.value='succeeded';else{previewStep.value=steps[i+1]!;showPreview()}}
const appAction=ref<{key:string;kind:'check'|'execute'|'install'|'repair'|'uninstall'}|null>(null),appRequests=new Map<string,{requestId:string;targetVersion:string;manifestSha256:string}>()
const executing=ref(false),resuming=ref(false),resumingId=ref(''),requestId=ref(''),targetVersion=ref(''),targetDigest=ref(''),applicationOpen=ref(false),selectedApplication=ref<Application|null>(null)
const toast=useToast()
const auth=useApi(),data=ref<UpdateCenter|null>(null),action=ref<'refresh'|'updates'|'authorization'|'retry'|null>(null),error=ref(''),feedback=ref(''),detailOpen=ref(false),selectedRelease=ref<Release|null>(null)
const session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('services.read'))throw createError({statusCode:403,statusMessage:'没有框架与应用访问权限'})
const initial=await useAsyncData(preview?'admin-update-preview':'admin-update-center',():Promise<UpdateCenter>=>preview?Promise.resolve(updatePreview()):auth.api<UpdateCenter>('/admin/updates'))
data.value=initial.data.value??null
if(initial.error.value)error.value='框架与应用信息暂时无法读取，请重试。'
const applications=computed(()=>data.value?.applications)
const canManage=computed(()=>preview||!!session?.permissions.includes('services.update'))
const frameworkOpen=ref(false),historyOpen=ref(false),repairOpen=ref(false),repairTarget=ref<Application|null>(null)
type Operation='install'|'repair'|'uninstall'
type OperationPreview={targetVersion:string;manifestSha256:string;releaseNotes?:string;tenants:number;pending:number;integrity:{path:string;kind:string}[]}
const operation=ref<Operation>('repair'),operationPreview=ref<OperationPreview|null>(null),operationError=ref(''),operationChecking=ref<'initial'|'refresh'|null>(null),operationExecuting=ref(false)
const operationNames={install:'安装',repair:'修复',uninstall:'卸载'} as const
const operationName=computed(()=>operationNames[operation.value])
const operationRequests=new Map<string,{requestId:string;packageKey:string;operation:Operation;targetVersion:string;manifestSha256:string}>()
let operationRead:AbortController|undefined
const group=ref<'installed'|'purchased'>('installed'),q=ref(''),search=ref(''),page=ref(1),pageSize=ref(8)
const applicationTabs=computed(()=>[{value:'installed',label:`已经安装（${applications.value?.installed.length||0}）`},{value:'purchased',label:`已经购买未安装（${applications.value?.purchased.length||0}）`}])
const filteredApplications=computed(()=>(applications.value?.[group.value]||[]).filter(app=>!search.value||[app.name,app.packageKey,app.key||''].some(value=>value.toLowerCase().includes(search.value))))
const visibleApplications=computed(()=>filteredApplications.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value))
function selectGroup(value:string|number){group.value=value==='purchased'?'purchased':'installed';page.value=1}
function filter(reset=false){if(reset)q.value='';search.value=q.value.trim().toLowerCase();page.value=1}
function setPageSize(value:number){pageSize.value=value;page.value=1}
watch(()=>filteredApplications.value.length,total=>{page.value=Math.min(page.value,Math.max(1,Math.ceil(total/pageSize.value)))})
function operationAvailable(app:Application,kind:Operation){return canManage.value&&!!app.management[{install:'canInstall',repair:'canRepair',uninstall:'canUninstall'}[kind] as 'canInstall'|'canRepair'|'canUninstall']}
function inspectRepair(app:Application){void inspectOperation(app,'repair')}
async function inspectOperation(app:Application,kind:Operation){
 const pending=unfinishedTask(app.packageKey);if(pending){showProgress(app.packageKey,pending.id);return}
 if(disposed||appAction.value||action.value||executing.value||resuming.value||operationExecuting.value)return
 repairTarget.value=app;operation.value=kind;operationPreview.value=null;operationError.value='';repairOpen.value=true
 if(!operationAvailable(app,kind)){operationError.value=unavailableReason(app);return}
 await checkOperation('initial')
}
async function checkOperation(source:'initial'|'refresh'='refresh'){
 if(!repairTarget.value||operationExecuting.value||!operationAvailable(repairTarget.value,operation.value))return
 operationRead?.abort();const controller=new AbortController();operationRead=controller;operationChecking.value=source;operationPreview.value=null;operationError.value=''
 const target=repairTarget.value,kind=operation.value;appAction.value={key:target.packageKey,kind};interruptBackgroundRead()
 try{const result=await auth.api<OperationPreview>('/admin/updates/applications/check','POST',{packageKey:target.packageKey,operation:kind},{signal:controller.signal});if(!disposed&&operationRead===controller&&!controller.signal.aborted)operationPreview.value=result}
 catch(e){if(!disposed&&operationRead===controller&&!controller.signal.aborted)operationError.value=e instanceof Error?e.message:'应用检查未完成'}
 finally{if(operationRead===controller){operationRead=undefined;operationChecking.value=null;appAction.value=null}}
}
async function executeOperation(){
 const target=repairTarget.value,checked=operationPreview.value,kind=operation.value
 if(disposed||!target||!checked||checked.pending||operationChecking.value||operationExecuting.value||appAction.value||action.value||executing.value||resuming.value||!operationAvailable(target,kind))return
 interruptBackgroundRead();if(polling)return
 const key=target.packageKey+':'+kind,old=operationRequests.get(key),terminal=old&&data.value?.tasks?.some(task=>task.id===old.requestId&&['blocked','rolled_back','succeeded'].includes(task.status))
 const request=old&&!terminal&&old.targetVersion===checked.targetVersion&&old.manifestSha256===checked.manifestSha256?old:{requestId:crypto.randomUUID(),packageKey:target.packageKey,operation:kind,targetVersion:checked.targetVersion,manifestSha256:checked.manifestSha256}
 operationRequests.set(key,request);operationExecuting.value=true;appAction.value={key:target.packageKey,kind};operationError.value=''
 repairOpen.value=false;showProgress(target.packageKey,request.requestId)
 try{await auth.api('/admin/updates/applications/execute','POST',request);if(disposed)return;await load(false,'mutation')}
 catch(e){if(!disposed)reportProgressError(request.requestId,e instanceof Error?e.message:'提交结果暂未确认，请重新打开原操作检查状态；重试会沿用同一请求')}
 finally{operationExecuting.value=false;appAction.value=null}
}
watch(repairOpen,open=>{if(!open&&!operationExecuting.value){operationRead?.abort();operationRead=undefined;operationChecking.value=null;operationPreview.value=null;appAction.value=null}},{flush:'sync'})
function unavailableReason(app:Application){return app.management.reason+(!canManage.value?' 当前账号没有应用管理权限。':'')}
function inspectApplication(app:Application){selectedApplication.value=app;applicationOpen.value=true}
watch(applications,value=>{if(selectedApplication.value){const fresh=[...(value?.installed||[]),...(value?.purchased||[])].find(a=>a.packageKey===selectedApplication.value?.packageKey);if(fresh)selectedApplication.value=fresh}})
const latestRelease=computed<Release|null>(()=>data.value?.update.state==='available'&&data.value.update.latestVersion?{version:data.value.update.latestVersion,releaseNotes:data.value.update.releaseNotes,mandatory:data.value.update.mandatory,miniProgramUpdateRequired:data.value.update.miniProgramUpdateRequired,files:data.value.update.files}:null)
const activeTask=computed(()=>data.value?.tasks?.find(t=>['running','recovery_required'].includes(t.status)))
const progressOpen=ref(false),progressKey=ref(''),progressId=ref(''),progressError=ref(''),frameworkProgressId=ref(''),frameworkDismissed=ref(''),frameworkError=ref('')
const componentTasks=(key:string)=>(data.value?.tasks||[]).filter(t=>(t.packageKey||data.value?.packageKey||'')===key)
const progressTasks=computed(()=>componentTasks(progressKey.value).slice().reverse())
const progressTask=computed(()=>progressId.value?progressTasks.value.find(t=>t.id===progressId.value):progressTasks.value.find(t=>['running','recovery_required'].includes(t.status))||progressTasks.value[0])
const otherProgressTasks=computed(()=>progressTasks.value.filter(task=>task.id!==progressTask.value?.id))
const progressName=computed(()=>[...(applications.value?.installed||[]),...(applications.value?.purchased||[])].find(a=>a.packageKey===progressKey.value)?.name||(progressKey.value===data.value?.packageKey?'框架':'应用'))
function showProgress(key:string,id=''){if(key===(data.value?.packageKey||'')){frameworkProgressId.value=id||unfinishedTask(key)?.id||componentTasks(key).at(-1)?.id||'';frameworkDismissed.value='';frameworkError.value='';return}progressKey.value=key;progressId.value=id;progressError.value='';progressOpen.value=true}
function reportProgressError(id:string,message:string){if(frameworkProgressId.value===id){frameworkError.value=message;return}if(progressId.value===id||progressTask.value?.id===id)progressError.value=message;else toast.add({title:'任务提交未完成',description:message,color:'error'})}
const unfinishedTask=(key:string)=>componentTasks(key).find(task=>['running','recovery_required'].includes(task.status))
const frameworkTask=computed(()=>componentTasks(data.value?.packageKey||'').find(task=>task.id===frameworkProgressId.value))
watch(()=>data.value?.tasks,()=>{const key=data.value?.packageKey||'',pending=unfinishedTask(key);if(pending&&pending.id!==frameworkProgressId.value){frameworkProgressId.value=pending.id;frameworkDismissed.value='';frameworkError.value=''}},{immediate:true})
function cardProgress(key:string){const task=unfinishedTask(key);return task?{task,title:task.status==='running'?'正在'+operationTitle(task.operation):['ACTIVE_HEALTHY_CLOSEOUT_BLOCKED','ROLLBACK_CLOSEOUT_BLOCKED'].includes(task.code||'')?'等待收尾':'需要恢复',stage:operationSteps(task.operation)[updateStepIndex(task.step,task.operation)]}:null}

const applicationHistoryOpen=ref(false)
function showApplicationHistory(app:Application){selectedApplication.value=app;applicationHistoryOpen.value=true}
async function beginUpdate(){
  const key=data.value?.packageKey||'',pending=unfinishedTask(key);if(pending){showProgress(key,pending.id);return}
  if(disposed||appAction.value||executing.value||resuming.value||action.value||!canManage.value||!data.value?.installer.canInstall||!data.value.update.latestVersion)return
  interruptBackgroundRead();if(polling)return
  // Preserve the request key after an uncertain response; a retry must not create another task.
  const terminal=componentTasks(data.value.packageKey||'').some(task=>task.id===requestId.value&&['blocked','rolled_back','succeeded'].includes(task.status))
  if(terminal||targetVersion.value!==data.value.update.latestVersion||targetDigest.value!==(data.value.update.manifestSha256||'')||!requestId.value){requestId.value=crypto.randomUUID();targetVersion.value=data.value.update.latestVersion;targetDigest.value=data.value.update.manifestSha256||''}
  if(preview){previewStep.value='AUTHORIZE';previewScene.value='running';showProgress(data.value.packageKey||'');return}
  executing.value=true;error.value='';showProgress(data.value.packageKey||'',requestId.value)
  try{await auth.api('/admin/updates/execute','POST',{requestId:requestId.value,targetVersion:targetVersion.value,...(data.value.update.manifestSha256?{packageKey:data.value.packageKey,manifestSha256:data.value.update.manifestSha256}:{})});await load(false,'mutation')}
  catch(e){if(!disposed)reportProgressError(requestId.value,e instanceof Error?e.message:'更新请求未完成；再次点击将使用同一请求重试')}finally{executing.value=false}
}
async function resumeCloseout(task=progressTask.value){if(preview){previewScene.value='succeeded';return}if(disposed||resuming.value||executing.value||action.value||!canManage.value||!task)return;interruptBackgroundRead();if(polling)return;const id=task.id;resuming.value=true;resumingId.value=id;progressError.value='';frameworkError.value='';try{await auth.api('/admin/updates/resume-closeout','POST',{taskId:id});await load(false,'mutation')}catch(e){reportProgressError(id,e instanceof Error?e.message:'收尾未完成')}finally{resuming.value=false;resumingId.value=''}}
const licenseColor=computed(()=>data.value?.license.state==='suspended'?'error':data.value?.allowed?'success':'warning')
function noteColor(tag:string){return tag==='修复'?'success':tag==='新增'?'info':tag==='安全'?'error':['优化','调整'].includes(tag)?'warning':'neutral'}
let disposed=false,polling=false,lastPoll=0,readSequence=0,timer:ReturnType<typeof setInterval>|undefined,reading:{controller:AbortController;quiet:boolean}|undefined
function interruptBackgroundRead(){if(reading?.quiet){reading.controller.abort();reading=undefined;readSequence++;polling=false}}
async function load(quiet=false,source:'refresh'|'retry'|'mutation'='refresh'){
  if(preview){showPreview();return}
  if(disposed||action.value||(source!=='mutation'&&(executing.value||resuming.value||appAction.value)))return
  if(!quiet)interruptBackgroundRead()
  if(polling)return
  if(quiet&&(document.visibilityState!=='visible'||Date.now()-lastPoll<(activeTask.value?.status==='running'?2500:10000)))return
  const sequence=++readSequence,controller=new AbortController();reading={controller,quiet}
  lastPoll=Date.now();polling=true;if(!quiet){if(source!=='mutation')action.value=source;error.value=''}
  try{const result=await auth.api<UpdateCenter>('/admin/updates','GET',undefined,{signal:controller.signal});if(!disposed&&sequence===readSequence){data.value=result;error.value='';if(!quiet&&source==='refresh'){const selected=result.tasks?.find(task=>task.id===frameworkProgressId.value);if(selected?.status==='succeeded'){frameworkProgressId.value='';frameworkDismissed.value='';frameworkError.value=''}else if(selected&&['running','recovery_required'].includes(selected.status))frameworkDismissed.value=''}}}
  catch(e){if(!disposed&&sequence===readSequence&&!controller.signal.aborted){error.value=e instanceof Error?e.message:'更新信息读取失败';if(!auth.session.value)await navigateTo('/admin/login',{replace:true})}}
  finally{if(sequence===readSequence){polling=false;reading=undefined;if(action.value==='refresh'||action.value==='retry')action.value=null}}
}
async function check(kind:'updates'|'authorization'){
  if(preview){toast.add({title:data.value?.update.label||'检查完成',color:'success'});return}
  if(disposed||appAction.value||action.value||executing.value||resuming.value)return
  interruptBackgroundRead();if(polling)return
  action.value=kind;error.value='';feedback.value=''
    try{await auth.api('/admin/license/check','POST',{kind});const next=await auth.api<UpdateCenter>('/admin/updates');if(!disposed){data.value=next;feedback.value=kind==='authorization'?(next.license.lastCheckFailed?'本次授权检查未完成，保留上次可信状态。':`授权检查完成：${next.license.label}`):'';if(kind==='updates')toast.add({title:next.update.label,description:next.update.state==='unavailable'?next.update.description:undefined,color:next.update.state==='unavailable'?'warning':'success'})}}
  catch(e){if(!disposed){error.value=e instanceof Error?e.message:'检查未完成，请重试';if(!auth.session.value)await navigateTo('/admin/login',{replace:true})}}
  finally{action.value=null}
}
const selectedComponent=ref<'framework'|'application'>('framework')
function inspect(release:Release,component:'framework'|'application'='framework'){selectedComponent.value=component;selectedRelease.value=releasePresentation(release,component);detailOpen.value=true}
async function checkApplication(app:Application){
  const pending=unfinishedTask(app.packageKey);if(pending){showProgress(app.packageKey,pending.id);return}
  if(preview){feedback.value='开发预览：未发送真实应用检查请求';return}
  if(disposed||appAction.value||action.value||executing.value||resuming.value||!app.update.canCheck)return
  interruptBackgroundRead();if(polling)return
  appAction.value={key:app.packageKey,kind:'check'};error.value=''
  try{await auth.api('/admin/updates/check','POST',{packageKey:app.packageKey});await load(false,'mutation')}
  catch(e){if(!disposed)error.value=e instanceof Error?e.message:'应用检查未完成'}finally{appAction.value=null}
}
async function updateApplication(app:Application){
  const pending=unfinishedTask(app.packageKey);if(pending){showProgress(app.packageKey,pending.id);return}
  if(preview){feedback.value='开发预览：未执行真实应用更新';return}
  if(disposed||appAction.value||action.value||executing.value||resuming.value||!canManage.value||!app.management.available||!app.update.latestVersion||!app.update.manifestSha256)return
  interruptBackgroundRead();if(polling)return
  const key=app.packageKey,old=appRequests.get(key),input=old&&!componentTasks(key).some(t=>t.id===old.requestId&&['blocked','rolled_back','succeeded'].includes(t.status))&&old.targetVersion===app.update.latestVersion&&old.manifestSha256===app.update.manifestSha256?old:{requestId:crypto.randomUUID(),targetVersion:app.update.latestVersion,manifestSha256:app.update.manifestSha256}
  appRequests.set(key,input);appAction.value={key,kind:'execute'};error.value='';showProgress(key,input.requestId)
  try{await auth.api('/admin/updates/execute','POST',{...input,packageKey:key});await load(false,'mutation')}
  catch(e){if(!disposed)reportProgressError(input.requestId,e instanceof Error?e.message:'应用更新请求未完成；重试将沿用原请求')}finally{appAction.value=null}
}
function inspectApplicationUpdate(app:Application){if(app.update.latestVersion)inspect({name:app.name,version:app.update.latestVersion,releaseNotes:app.update.releaseNotes||'',files:app.update.files},'application')}
function onVisible(){if(!appAction.value)void load(true)}
onMounted(()=>{if(preview)return;lastPoll=Date.now();timer=setInterval(()=>{if(activeTask.value?.status==='running'||Date.now()-lastPoll>=30000)onVisible()},5000);document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible)})
onBeforeUnmount(()=>{disposed=true;operationRead?.abort();operationRead=undefined;operationChecking.value=null;reading?.controller.abort();reading=undefined;readSequence++;polling=false;action.value=null;if(timer)clearInterval(timer);if(import.meta.client){document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible)}})
</script>

<template>
  <AdminConsole :refreshing="action==='refresh'" @refresh="load()">
    <div class="space-y-5">
      <ConsolePageHeading title="框架与应用"/>
      <div v-if="preview" class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning/5 px-5 py-4">
        <div><p class="text-sm font-semibold text-warning">开发预览 · 模拟更新流程</p><p class="mt-1 text-xs text-muted">版本、应用与进度均为示例，不调用真实安装或更新接口。</p></div>
        <div class="flex flex-wrap items-center gap-3"><USelect v-model="previewScene" :items="previewScenes" aria-label="预览更新状态" class="w-44"/><UButton v-if="previewScene==='running'" size="sm" variant="soft" @click="nextPreviewStep">预览下一步</UButton><a href="/admin/updates" class="text-sm text-muted underline underline-offset-4">退出预览</a></div>
      </div>
      <ConsoleErrorState v-if="error" title="操作未完成" :description="error"><template #actions><UButton color="neutral" variant="outline" size="sm" :disabled="!!action||executing||resuming" :loading="action==='retry'" @click="load(false,'retry')">重试</UButton></template></ConsoleErrorState>
      <template v-if="data">
        <UAlert v-if="data.backups?.ready===false" color="warning" title="更新前数据库备份当前不可用" description="请先检查数据安全页面与服务器配置。备份未通过时，不会执行迁移或切换程序。"/>
        <section class="surface-card overflow-hidden" aria-labelledby="framework-title">
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><UIcon name="i-lucide-layers" class="size-5"/></span>
              <h2 id="framework-title" class="font-semibold">{{data.productName}}</h2><span class="text-sm text-muted tabular-nums">v{{data.update.currentVersion}}</span><UBadge :color="licenseColor" variant="subtle">{{data.license.label}}</UBadge>
              <span role="status" class="text-xs" :class="data.update.state==='unavailable'?'text-warning':'text-muted'">{{data.update.label}}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <UButton color="neutral" variant="link" size="sm" class="px-0" @click="historyOpen=true">更新记录</UButton>
              <UButton color="neutral" variant="link" size="sm" class="px-0" @click="frameworkOpen=true">授权详情</UButton>
              <UButton color="neutral" variant="outline" size="sm" :disabled="!!appAction||!!action||executing||resuming||!data.canCheck" :aria-busy="action==='updates'" @click="check('updates')"><UIcon name="i-lucide-refresh-cw" class="size-4 shrink-0" :class="{'animate-spin':action==='updates'}"/>检查框架更新</UButton>
              <UButton v-if="canManage&&(latestRelease||unfinishedTask(data.packageKey||''))" size="sm" :disabled="!unfinishedTask(data.packageKey||'')&&(!!appAction||executing||resuming||!!action||!data.installer.canInstall)" :aria-busy="executing" :title="data.installer.reason" @click="beginUpdate"><UIcon name="i-lucide-refresh-cw" class="size-4 shrink-0" :class="{'animate-spin':executing}"/>更新框架</UButton>
            </div>
          </div>
          <p v-if="data.update.state==='unavailable'" role="alert" class="border-t border-default px-5 py-3 text-sm text-warning">{{data.update.description}}</p>
          <div v-if="latestRelease" class="flex flex-wrap items-center justify-between gap-3 border-t border-default bg-primary/5 px-5 py-3 text-sm"><p class="font-medium text-primary">发现新版本 v{{latestRelease.version}}<UBadge v-if="latestRelease.mandatory" color="error" variant="subtle" class="ml-2">重要更新</UBadge></p><UButton variant="link" size="sm" class="px-0" @click="inspect(latestRelease)">查看框架更新内容</UButton></div>
        </section>
        <section v-if="frameworkProgressId&&frameworkDismissed!==frameworkProgressId" class="surface-card px-5 py-4" aria-label="框架更新进度"><div v-if="frameworkTask&&frameworkTask.status!=='running'" class="mb-2 flex justify-end"><UButton variant="link" color="neutral" size="xs" class="p-0" @click="frameworkDismissed=frameworkProgressId">收起</UButton></div><UAlert v-if="frameworkError" class="mb-3" color="error" :title="frameworkError"/><UpdateProgress v-if="frameworkTask" :task="frameworkTask" :can-resume="canManage" :busy="resumingId===frameworkTask.id" @resume="resumeCloseout(frameworkTask)"/><p v-else class="text-sm text-muted" role="status">正在提交或读取框架更新状态…</p></section>
        <UAlert v-if="!data.allowed" :color="licenseColor" :title="data.license.label" :description="data.license.description" variant="subtle"/>
        <p v-if="latestRelease&&!data.installer.canInstall&&!activeTask" class="text-sm text-muted">{{data.installer.reason}}</p>


        <section aria-label="应用管理" class="space-y-3">
          <p v-if="!applications||applications.catalog.state!=='verified'" role="status" class="flex items-start gap-2 text-sm text-warning"><UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0"/>{{applications?.catalog.description||'应用信息暂未读取，请刷新重试。'}}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <UTabs :model-value="group" :items="applicationTabs" :content="false" variant="link" aria-label="应用安装状态" @update:model-value="selectGroup"/>
            <form class="flex min-w-0 flex-wrap items-center gap-2" @submit.prevent="filter()"><ConsoleListSearch v-model="q" placeholder="搜索应用名称" class="sm:!w-56"/><div class="flex shrink-0 items-center gap-2"><ConsoleQueryButton type="submit" size="sm">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" size="sm" @click="filter(true)">重置</ConsoleQueryButton></div></form>
          </div>
          <ul v-if="visibleApplications.length" class="application-grid" :aria-label="group==='installed'?'已经安装的应用':'已经购买未安装的应用'">
            <li v-for="app in visibleApplications" :key="app.packageKey" class="surface-card flex min-w-0 flex-col overflow-hidden">
              <div class="flex-1 p-4">
                <div class="flex min-w-0 items-center gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><UIcon name="i-lucide-package" class="size-4"/></span><div class="min-w-0"><h3 class="line-clamp-2 break-words text-sm font-medium" :title="app.name">{{app.name}}</h3><p class="mt-1 text-xs text-muted">{{group==='purchased'?'待安装':app.source==='development'?'本地开发':app.source==='bundled'?'当前内置':'已安装'}}</p></div></div>
                <dl class="mt-4 space-y-2.5 text-xs"><div class="flex flex-wrap items-center justify-between gap-2"><dt class="text-muted">应用版本</dt><dd class="flex flex-wrap items-center justify-end gap-2"><span>{{group==='purchased'?'尚未安装':app.update?.currentVersion?'v'+app.update.currentVersion:'未登记独立版本'}}</span><template v-if="group==='installed'"><UBadge v-if="app.update.state==='current'" color="neutral" variant="subtle" size="sm">已是最新</UBadge><span v-else class="text-[11px]" :class="app.update.state==='unavailable'?'text-warning':'text-muted'">{{app.update.label||'尚未检查'}}</span><UButton v-if="app.update.latestVersion" variant="link" size="xs" class="p-0" @click="inspectApplicationUpdate(app)">更新内容</UButton></template></dd></div><div class="flex flex-wrap items-center justify-between gap-2"><dt class="text-muted">授权状态</dt><dd><UBadge :color="app.license.allowed?'success':'warning'" variant="subtle" size="sm">{{app.license.label}}</UBadge></dd></div><div v-if="app.componentType!=='plugin'" class="flex flex-wrap items-center justify-between gap-2"><dt class="text-muted">租户额度</dt><dd>{{applicationTenantQuota(app.license).summary}}</dd></div></dl>

                <div v-if="cardProgress(app.packageKey)" class="mt-3 flex items-center gap-1.5 text-xs" :class="cardProgress(app.packageKey)!.task.status==='running'?'text-primary':'text-warning'" role="status"><UIcon v-if="cardProgress(app.packageKey)!.task.status==='running'" name="i-lucide-loader-circle" class="size-3.5 animate-spin"/><span>{{cardProgress(app.packageKey)!.title}} · {{cardProgress(app.packageKey)!.stage}}</span></div>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-4 py-2">
                <UButton v-if="group==='installed'" variant="link" size="sm" class="px-0" :aria-label="'查看'+app.name+'详情'" @click="inspectApplication(app)">详情</UButton><UButton v-if="group==='installed'" variant="link" size="sm" class="px-0" @click="showApplicationHistory(app)">更新日志</UButton>
                <UButton v-if="unfinishedTask(app.packageKey)" variant="link" size="sm" class="px-0" :disabled="!canManage" @click="showProgress(app.packageKey,unfinishedTask(app.packageKey)!.id)">{{operationTitle(unfinishedTask(app.packageKey)?.operation)}}</UButton><template v-else-if="group==='installed'"><UButton :disabled="!canManage||(!unfinishedTask(app.packageKey)&&((app.update.state==='available'?!app.management.available:!app.update.canCheck)||!!appAction||!!action||executing||resuming))" :aria-busy="appAction?.key===app.packageKey&&['check','execute'].includes(appAction.kind)" color="primary" variant="link" size="sm" class="px-0 disabled:text-muted aria-disabled:text-muted" :title="app.update.state==='available'?unavailableReason(app):app.update.description" @click="app.update.state==='available'?updateApplication(app):checkApplication(app)">{{appAction?.key===app.packageKey&&['check','execute'].includes(appAction.kind)?(appAction.kind==='check'?'检查中…':'更新中…'):(app.update.state==='available'?'更新':'检查更新')}}</UButton><UButton :disabled="!canManage||(!unfinishedTask(app.packageKey)&&(!!appAction||!!action||executing||resuming))" variant="link" size="sm" class="px-0" :aria-label="'修复'+app.name" @click="inspectRepair(app)">修复</UButton><UButton :disabled="!canManage||(!unfinishedTask(app.packageKey)&&(!operationAvailable(app,'uninstall')||!!appAction||!!action||executing||resuming))" color="error" variant="link" size="sm" class="px-0 disabled:text-muted aria-disabled:text-muted" :title="unavailableReason(app)" @click="inspectOperation(app,'uninstall')">卸载</UButton></template>
                <UButton v-else :disabled="!canManage||(!unfinishedTask(app.packageKey)&&(!operationAvailable(app,'install')||!!appAction||!!action||executing||resuming))" size="sm" :title="unavailableReason(app)" @click="inspectOperation(app,'install')">安装</UButton>
              </div>
            </li>
          </ul>
          <div v-else class="surface-card flex items-center justify-center gap-3 px-5 py-8 text-sm text-muted" role="status"><UIcon name="i-lucide-package" class="size-5 shrink-0 opacity-50"/><p>{{!applications?'应用信息暂未读取':search?'未找到匹配的应用':group==='installed'?'尚未安装应用':!data.allowed?'框架授权不可用，暂不能获取可安装应用':'暂无已购买未安装的应用'}}</p></div>
          <ConsolePagination v-if="filteredApplications.length>8" always-visible :page="page" :page-size="pageSize" :total="filteredApplications.length" :page-size-options="[8,16,32]" @update:page="page=$event" @update:page-size="setPageSize"/>
        </section>

      </template>
      <ConsoleDrawer v-model:open="frameworkOpen" title="框架授权">
        <template #body><div v-if="data" class="drawer-detail space-y-6"><section><h3 class="drawer-section-title">{{data.productName}}</h3><dl class="drawer-facts mt-2"><dt>框架版本</dt><dd>v{{data.update.currentVersion}}</dd><dt>授权状态</dt><dd><UBadge :color="licenseColor" variant="subtle">{{data.license.label}}</UBadge></dd><dt>授权主体</dt><dd>{{data.license.companyName||'未提供'}}</dd><dt>授权域名</dt><dd>{{data.license.domain}}</dd><dt>使用授权</dt><dd>{{expiry(data.license.expiresAt,data.license.expiryKnown)}}</dd><dt>更新服务</dt><dd>{{expiry(data.license.updatesExpiresAt,data.license.expiryKnown)}}</dd><dt>最近核验</dt><dd>{{dateTime(data.license.checkedAt)}}</dd><dt>最近检查更新</dt><dd>{{dateTime(data.update.checkedAt)}}</dd></dl></section><p v-if="feedback" role="status" class="text-sm text-muted">{{feedback}}</p></div></template>
        <template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="frameworkOpen=false">关闭</UButton><UButton :disabled="!!appAction||!!action||executing||resuming||!data?.canCheck" :aria-busy="action==='authorization'" @click="check('authorization')"><UIcon name="i-lucide-shield-check" class="size-4 shrink-0" :class="{'animate-pulse':action==='authorization'}"/>{{action==='authorization'?'核验授权':'检查授权'}}</UButton></ConsoleFormActions></template>
      </ConsoleDrawer>
      <ConsoleDrawer v-model:open="historyOpen" title="框架更新记录">
        <template #body><template v-if="data"><p v-if="!data.history.available||!data.history.items.length" role="status" class="py-4 text-sm text-muted">{{!data.history.available?data.history.description:'尚无成功安装的框架更新版本。'}}</p><ReleaseHistoryList v-else :items="data.history.items" component="framework" :current-version="data.update.currentVersion"/></template></template>
        <template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="historyOpen=false">关闭</UButton></ConsoleFormActions></template>
      </ConsoleDrawer>
      <ConsoleDialog v-model:open="repairOpen" :title="operationName+'应用'" :dismissible="!operationExecuting" :close="!operationExecuting">
        <template #body><div v-if="repairTarget" class="space-y-4"><h3 class="font-medium">{{repairTarget.name}}</h3><p v-if="operationChecking==='initial'" role="status" class="text-sm text-muted">正在检查应用版本与执行条件…</p><UAlert v-if="operationError" color="error" :title="operationError"/><template v-if="operationPreview"><p class="text-sm">{{operationName}}版本：v{{operationPreview.targetVersion}}</p><p class="text-sm leading-6 text-muted">{{operation==='install'?'安装完成后，可创建使用此应用的租户。':operation==='repair'?'恢复当前版本的程序文件，保留业务数据、配置和版本。修复前记录文件差异，成功后清理旧程序，不保留本地回退副本。':'将停用并卸载应用程序，关联租户暂时无法使用该应用；业务数据、配置、绑定和授权全部保留。'}}</p><p v-if="operation==='uninstall'" class="text-sm">关联租户 {{operationPreview.tenants}} 个 · 未完成任务 {{operationPreview.pending}} 个</p><UAlert v-if="operationPreview.pending" color="warning" title="请先处理未完成的支付、退款或应用任务"/><ReleaseNotesContent v-if="operationPreview.releaseNotes&&operation==='install'" :notes="operationPreview.releaseNotes" component="application"/><ul v-if="operationPreview.integrity.length" class="max-h-48 space-y-2 overflow-y-auto text-xs" aria-label="将修复的程序文件"><li v-for="file in operationPreview.integrity" :key="file.path" class="break-all">{{file.kind==='missing'?'缺失':'已修改或损坏'}}：{{file.path}}</li></ul></template></div></template>
        <template #footer><ConsoleFormActions class="w-full"><UButton v-if="repairTarget&&operationAvailable(repairTarget,operation)" color="neutral" variant="outline" :disabled="!!operationChecking||operationExecuting" @click="checkOperation('refresh')"><UIcon name="i-lucide-refresh-cw" :class="{'animate-spin':operationChecking==='refresh'}"/>重新检查</UButton><UButton color="neutral" variant="outline" :disabled="operationExecuting" @click="repairOpen=false">取消</UButton><UButton :color="operation==='uninstall'?'error':'primary'" :loading="operationExecuting" :disabled="!!operationChecking||!operationPreview||!!operationPreview.pending||!!operationError" @click="executeOperation">{{operation==='uninstall'?'保留数据并卸载':'开始'+operationName}}</UButton></ConsoleFormActions></template>
      </ConsoleDialog>
      <ConsoleDialog v-model:open="progressOpen" :title="progressName+' · '+operationTitle(progressTask?.operation)" size="content">
        <template #body><div class="space-y-4"><UAlert v-if="progressError" color="error" :title="progressError"/><UpdateProgress v-if="progressTask" :task="progressTask" :can-resume="canManage" :busy="resumingId===progressTask.id" @resume="resumeCloseout()"/><p v-else role="status" class="text-sm text-muted">{{progressError?'可关闭后重新检查任务状态。':'正在提交或读取任务状态…'}}</p><details v-if="otherProgressTasks.length" class="border-t border-default pt-3"><summary class="cursor-pointer text-xs text-muted">其他历史任务（{{otherProgressTasks.length}}）</summary><ul class="mt-2 divide-y divide-default" aria-label="其他历史任务"><li v-for="task in otherProgressTasks" :key="task.id" class="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"><span>{{operationTitle(task.operation)}} · {{dateTime(task.updatedAt)}} · {{{running:'进行中',succeeded:'已完成',blocked:'未开始',rolled_back:'已回滚',recovery_required:'待处理'}[task.status]||task.status}}</span><UButton variant="link" size="xs" @click="progressId=task.id">查看</UButton></li></ul></details></div></template>
        <template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="progressOpen=false">关闭</UButton></ConsoleFormActions></template>
      </ConsoleDialog>
      <ConsoleDrawer v-model:open="applicationHistoryOpen" :title="(selectedApplication?.name||'应用')+'更新日志'">
        <template #body><template v-if="selectedApplication"><p v-if="!selectedApplication.history?.available||!selectedApplication.history.items.length" class="py-4 text-sm text-muted">{{selectedApplication.history?.available?'尚无已完成的独立更新。':'更新日志暂不可用。'}}</p><ReleaseHistoryList v-else :items="selectedApplication.history.items" component="application" :current-version="selectedApplication.version"/></template></template>
        <template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="applicationHistoryOpen=false">关闭</UButton></ConsoleFormActions></template>
      </ConsoleDrawer>
      <ConsoleDialog v-model:open="detailOpen" :title="(selectedRelease?.name||'框架')+' v'+(selectedRelease?.version||'')+' 更新内容'" size="content">
        <template #body><div class="text-default"><ReleaseNotesContent :notes="selectedRelease?.releaseNotes||''" :component="selectedComponent" :mini-program-update-required="selectedRelease?.miniProgramUpdateRequired"/><section v-if="selectedRelease?.files" class="mt-6 border-t border-default pt-4"><h3 class="text-sm font-semibold">文件变更</h3><p class="my-3 text-xs text-muted">来自可信发行清单，点击更新后将核对服务器实际文件。新增 {{selectedRelease.files.filter(f=>f.kind==='added').length}} · 修改 {{selectedRelease.files.filter(f=>f.kind==='modified').length}} · 删除 {{selectedRelease.files.filter(f=>f.kind==='deleted').length}}</p><ul class="max-h-64 overflow-y-auto text-xs"><li v-for="file in selectedRelease.files.filter(f=>f.kind!=='unchanged')" :key="file.path" class="flex gap-3 border-b border-default py-2"><span class="shrink-0">{{{added:'新增',modified:'修改',deleted:'删除',unchanged:'未变'}[file.kind]}}</span><span class="min-w-0 flex-1 break-all">{{file.path}}</span><span class="shrink-0">{{file.size}} B</span></li></ul></section></div></template>
        <template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="detailOpen=false">关闭</UButton></ConsoleFormActions></template>
      </ConsoleDialog>
      <ConsoleDrawer v-model:open="applicationOpen" :title="selectedApplication?.name||'应用详情'">
        <template #body>
          <div v-if="selectedApplication" class="space-y-5">
            <section><div class="flex items-center gap-3"><span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><UIcon name="i-lucide-package" class="size-5"/></span><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><UBadge :color="selectedApplication.license.allowed?'success':'warning'" variant="subtle">{{selectedApplication.license.label}}</UBadge><UBadge color="neutral" variant="subtle">{{selectedApplication.source==='development'?'本地开发':selectedApplication.source==='bundled'?'当前内置':selectedApplication.source==='native'?'已安装':'未安装'}}</UBadge></div><p class="mt-1.5 text-xs text-muted">{{selectedApplication.version?'v'+selectedApplication.version:selectedApplication.source==='catalog'?'尚未安装':'未登记独立版本'}}</p></div></div><p v-if="selectedApplication.description" class="mt-3 whitespace-pre-line break-words text-sm leading-6 text-muted">{{selectedApplication.description}}</p></section>
            <section class="border-t border-default pt-4"><h3 class="text-sm font-semibold">授权与更新</h3><dl class="application-detail-facts mt-3"><dt>授权域名</dt><dd>{{data?.license.domain||'待获取'}}</dd><dt>使用授权</dt><dd>{{expiry(selectedApplication.license.expiresAt,selectedApplication.license.expiryKnown)}}</dd><dt>更新服务</dt><dd>{{expiry(selectedApplication.license.updatesExpiresAt,selectedApplication.license.expiryKnown)}}</dd><dt>在线更新权益</dt><dd>{{selectedApplication.license.updatesEligible?'有效':'当前不可用'}}</dd><template v-if="selectedApplication.componentType!=='plugin'"><dt>租户额度</dt><dd>{{applicationTenantQuota(selectedApplication.license).summary}}</dd></template></dl></section>
            <div v-if="selectedApplication.history?.available" class="border-t border-default pt-3"><UButton variant="link" size="sm" class="px-0" @click="applicationOpen=false;showApplicationHistory(selectedApplication)">查看更新日志</UButton></div>

          </div>
        </template>
        <template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="applicationOpen=false">关闭</UButton></ConsoleFormActions></template>
      </ConsoleDrawer>
    </div>
  </AdminConsole>
</template>
<style scoped>
.application-detail-facts{display:grid;grid-template-columns:6rem minmax(0,1fr);column-gap:16px;row-gap:11px}.application-detail-facts dt{font-size:12px;line-height:1.7;color:var(--ui-text-muted)}.application-detail-facts dd{min-width:0;margin:0;font-size:13px;line-height:1.6;overflow-wrap:anywhere}.application-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
@media(max-width:1279px){.application-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:639px){.application-grid{grid-template-columns:minmax(0,1fr)}}
</style>
