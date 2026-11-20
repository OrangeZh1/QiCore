<script setup lang="ts">
type Action='preview'|'upload_trial'
type Project={projectId:string;templateId:string;version:string;name:string;artifactSha256:string}
type Selection=Omit<Project,'name'>&{operationId:string;action:Action;settingsVersion:number}
type Task={operationId:string;version:string;action:Action;status:string;progress:number;message:string;qrCode:string|null}
const props=defineProps<{endpoint:string;settingsVersion:number;canWrite:boolean;dirty:boolean;ready:boolean}>()
const auth=useApi('tenant'),projects=ref<Project[]>([]),selected=ref(''),catalogBusy=ref(false),error=ref('')
const current=ref<Task|null>(null),pending=ref<Selection|null>(null),submitBusy=ref<Action|null>(null),dialogOpen=ref(false),dialogAction=ref<Action>('preview'),taskError=ref(''),recovering=ref(false),recoveryError=ref(''),initialized=ref(false)
const active=(row:Task)=>!['SUCCEEDED','FAILED','CANCELLED'].includes(row.status)
const taskActive=computed(()=>!!current.value&&active(current.value))
const blocked=computed(()=>!props.canWrite||props.dirty||!props.ready||!initialized.value||recovering.value||!!recoveryError.value||!!submitBusy.value||!!pending.value||taskActive.value)
const runningAction=computed(()=>submitBusy.value||(taskActive.value?current.value!.action:null))
const storageKey='qicore:mini-upload:'+auth.session.value?.id+':'+props.endpoint
let disposed=false,refreshing=false,recoveryId='',timer:ReturnType<typeof setTimeout>|undefined
const abort=new AbortController()
function remember(){try{const value=pending.value||(taskActive.value?{operationId:current.value!.operationId,action:current.value!.action}:null);if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey)}catch{/* Server tasks remain recoverable if browser storage is unavailable. */}}
function accept(row:Task){current.value=row;dialogAction.value=row.action;taskError.value='';if(pending.value?.operationId===row.operationId)pending.value=null;remember()}
async function recover(){
 if(disposed||recovering.value)return
 recovering.value=true
 try{
  const value=await auth.api<{items:Task[]}>(props.endpoint+'/upload-tasks?page=1','GET',undefined,{signal:abort.signal})
  if(disposed)return
  const id=pending.value?.operationId||recoveryId
  let row=value.items.find(row=>row.operationId===id)
  if(id&&!row){try{row=await auth.api<Task>(props.endpoint+'/upload-tasks/'+encodeURIComponent(id),'GET',undefined,{signal:abort.signal})}catch(e:any){if(e.status!==404)throw e;if(!pending.value){taskError.value='原任务已不存在，请重新生成预览或上传体验版。';recoveryId='';remember()}}}
  if(disposed)return
  row??=value.items.find(active)
  if(row){accept(row);dialogOpen.value=true}
  recoveryError.value='';initialized.value=true
 }catch(e:any){if(!disposed)recoveryError.value=e.message||'暂时无法确认已有任务，请重试'}finally{if(!disposed)recovering.value=false}
}
async function catalog(){
 if(disposed||catalogBusy.value)return
 catalogBusy.value=true;error.value=''
 try{const value=await auth.api<{projects:Project[];ready:boolean}>(props.endpoint+'/upload-catalog','GET',undefined,{signal:abort.signal});if(disposed)return;projects.value=value.projects;if(!value.projects.some(p=>p.templateId===selected.value))selected.value=value.projects[0]?.templateId||'';if(!value.ready)error.value='当前授权暂无可用版本，或上传服务尚未就绪'}catch(e:any){if(!disposed)error.value=e.message}finally{if(!disposed)catalogBusy.value=false}
}
async function submit(action:Action){
 if(disposed||!props.canWrite||submitBusy.value||recovering.value||!initialized.value||recoveryError.value||taskActive.value)return
 if(!pending.value){
  if(blocked.value)return
  const project=projects.value.find(p=>p.templateId===selected.value);if(!project)return
  pending.value={operationId:crypto.randomUUID(),projectId:project.projectId,templateId:project.templateId,version:project.version,artifactSha256:project.artifactSha256,action,settingsVersion:props.settingsVersion};remember();current.value=null
 }
 dialogAction.value=pending.value.action;dialogOpen.value=true;submitBusy.value=pending.value.action;taskError.value=''
 try{const row=await auth.api<Task>(props.endpoint+'/upload-tasks','POST',pending.value,{signal:abort.signal});if(!disposed)accept(row)}
 catch(e:any){if(!disposed){taskError.value=e.message;if(e.status&&e.status<500&&![408,429].includes(e.status)){pending.value=null;remember();if(e.status===409)await recover()}}}
 finally{if(!disposed)submitBusy.value=null}
}
async function refreshTask(){
 if(disposed||refreshing||!taskActive.value||!props.canWrite)return
 refreshing=true;const id=current.value!.operationId
 try{const row=await auth.api<Task>(props.endpoint+'/upload-tasks/'+id+'/refresh','POST',{}, {signal:abort.signal});if(!disposed&&current.value?.operationId===id)accept(row)}catch(e:any){if(!disposed)taskError.value=e.message||'进度暂时不可用，正在重试'}finally{refreshing=false}
}
async function poll(){if(disposed)return;try{await refreshTask()}finally{if(!disposed)timer=setTimeout(poll,5000)}}
onMounted(async()=>{
 try{const value=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(value&&typeof value.operationId==='string'&&['preview','upload_trial'].includes(value.action)){recoveryId=value.operationId;if(value.templateId)pending.value=value;dialogAction.value=value.action;dialogOpen.value=true}}catch{/* Ignore an unreadable local recovery hint. */}
 await recover();if(!disposed)void poll()
})
onBeforeUnmount(()=>{disposed=true;abort.abort();clearTimeout(timer)})
</script>
<template><section class="surface-card p-5 sm:p-7">
 <div class="mb-5"><h2 class="text-base font-semibold">预览与体验版</h2><p class="mt-1 text-sm text-muted">通过 License 获取授权版本，自动绑定当前站点及其小程序配置。</p></div>
 <UAlert v-if="error" class="mb-4" color="error" :title="error"/>
 <UAlert v-if="recoveryError" class="mb-4" color="error" :title="recoveryError"><template #actions><UButton :loading="recovering" @click="recover">重新检查任务</UButton></template></UAlert>
 <div class="flex flex-wrap items-center gap-3">
  <USelect v-model="selected" :items="projects.map(p=>({label:p.name+' · '+p.version,value:p.templateId}))" placeholder="请选择授权版本" aria-label="授权版本" class="w-full sm:w-72" :disabled="catalogBusy||!!runningAction||!!pending"/>
  <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :class="{'[&_.iconify]:animate-spin':catalogBusy}" :disabled="catalogBusy" @click="catalog">获取版本</UButton>
  <UButton :loading="runningAction==='preview'" :disabled="blocked||!selected" @click="submit('preview')">生成预览</UButton>
  <UButton color="neutral" variant="outline" :loading="runningAction==='upload_trial'" :disabled="blocked||!selected" @click="submit('upload_trial')">上传体验版</UButton>
  <UButton v-if="current||pending" color="neutral" variant="link" @click="dialogOpen=true">{{dialogAction==='preview'?'查看预览':'查看上传进度'}}</UButton>
 </div>
 <p v-if="dirty" class="mt-3 text-sm text-warning">请先保存当前修改。</p><p v-else-if="!ready" class="mt-3 text-sm text-muted">保存完整的小程序配置、上传密钥和公网 HTTPS 地址后可上传。</p>
 <UModal v-model:open="dialogOpen" :title="dialogAction==='preview'?'小程序预览':'上传体验版'" :description="dialogAction==='preview'?'预览生成后将自动显示二维码，使用微信扫码预览。':'上传完成后可前往微信公众平台管理体验版。'">
  <template #body><div class="space-y-4" aria-live="polite">
   <UAlert v-if="taskError" color="error" :title="taskError"/>
   <template v-if="current?.status==='SUCCEEDED'">
    <img v-if="dialogAction==='preview'&&current.qrCode" :src="current.qrCode" alt="小程序预览二维码" class="mx-auto size-64 max-w-full object-contain"/>
    <UAlert v-else-if="dialogAction==='preview'" color="warning" title="预览已完成，但未返回二维码，请重新生成预览。"/>
    <UAlert v-else color="success" title="体验版上传完成"/>
   </template>
   <UAlert v-else-if="current&&!taskActive" color="error" :title="current.message"/>
   <div v-else-if="submitBusy||taskActive" class="space-y-3 text-center"><UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-primary"/><p>{{current?.message||(dialogAction==='preview'?'正在提交预览任务…':'正在提交上传任务…')}}</p><UProgress v-if="current" :model-value="current.progress" :max="100" aria-label="任务进度"/><p v-if="current" class="text-sm text-muted">{{current.progress}}%</p></div>
   <p v-else-if="pending" class="text-sm text-muted">提交结果尚未确认，请继续原任务以避免重复上传。</p>
   <UButton v-if="pending&&!submitBusy" :disabled="!canWrite||recovering||!!recoveryError" @click="submit(pending.action)">恢复原任务</UButton>
  </div></template>
 </UModal>
</section></template>
