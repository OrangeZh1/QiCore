<script setup lang="ts">
import {dateTime as time} from '../../../utils/update-center'
import {schedulePreset,scheduleRule,scheduleDescription} from '../../../utils/task-schedule'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import AdminConsole from '../../../components/console/AdminConsole.vue'
definePageMeta({layout:'tenant'})
type Task={name:string;command:string;params:string;rule:string;enabled:boolean;remark:string;version:number;running:boolean}
type Command={value:string;label:string;description:string;grantable:boolean}
type Editor={task:Task|null;commands:Command[]}
const auth=useApi('tenant'),toast=useToast(),session=await auth.restore(),route=useRoute(),id=String(route.params.id),isNew=id==='new'
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='tenant'||session.delegated||!['tenant:tasks.read','tenant:tasks.write'].every(p=>session.permissions.includes(p)))throw createError({statusCode:403,statusMessage:'没有定时任务管理权限'})
const active=ref<'save'|'refresh'|'retry'|null>(null),previewBusy=ref(false),previewSource=ref<'manual'|'auto'>('manual'),previewedRule=ref(''),previewError=ref(''),times=ref<string[]>([]),error=ref(''),formError=ref(''),version=ref(0),running=ref(false),ready=ref(false),commands=ref<Command[]>([]),requestId=ref('')
const canEnable=computed(()=>auth.session.value?.permissions.includes('tenant:tasks.execute')===true)
const form=reactive({name:'',command:'',params:'',rule:'0 3 * * *',enabled:canEnable.value,remark:''})
const schedule=reactive(schedulePreset(form.rule)),scheduleText=computed(()=>scheduleDescription(schedule))
const modeOptions=[{label:'每隔几分钟',value:'minutes'},{label:'每小时',value:'hourly'},{label:'每天',value:'daily'},{label:'每周',value:'weekly'},{label:'自定义 Cron',value:'custom'}]
const weekdays=[{label:'周一',value:1},{label:'周二',value:2},{label:'周三',value:3},{label:'周四',value:4},{label:'周五',value:5},{label:'周六',value:6},{label:'周日',value:0}]
let mounted=false
watch(()=>[schedule.mode,schedule.interval,schedule.minute,schedule.time,schedule.weekday],()=>{if(schedule.mode!=='custom')form.rule=scheduleRule(schedule)})
const description=computed(()=>commands.value.find(c=>c.value===form.command)?.description||'')
let disposed=false,previewSequence=0
onBeforeUnmount(()=>{disposed=true;previewSequence++})
watch(()=>form.rule,()=>{previewSequence++;previewBusy.value=false;previewError.value='';if(mounted&&schedule.mode!=='custom')void preview('auto')})
async function fetchEditor():Promise<Editor>{const [listing,task]=await Promise.all([auth.api<{commands:Command[]}>('/admin/scheduled-tasks?page=1&pageSize=10'),isNew?Promise.resolve(null):auth.api<Task>('/admin/scheduled-tasks/'+id)]);return{commands:listing.commands,task}}
function apply(data:Editor){commands.value=data.commands;const task=data.task;if(task){Object.assign(form,{name:task.name,command:task.command,params:task.params,rule:task.rule,enabled:task.enabled,remark:task.remark});version.value=task.version;running.value=task.running;Object.assign(schedule,schedulePreset(task.rule))}ready.value=true}
const initial=await useAsyncData('scheduled-task-editor-'+id,fetchEditor)
if(initial.data.value)apply(initial.data.value)
else error.value='任务信息读取失败，请重试'
onMounted(()=>{mounted=true;requestId.value=crypto.randomUUID();if(ready.value)void preview()})
async function load(source:'refresh'|'retry'='refresh'){if(active.value)return;active.value=source;try{const data=await fetchEditor();if(!disposed){apply(data);error.value='';await preview('auto')}}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'读取失败'}finally{if(!disposed)active.value=null}}
async function preview(source:'manual'|'auto'='manual'){previewSource.value=source;const seq=++previewSequence,rule=form.rule;previewBusy.value=true;previewError.value='';try{const data=await auth.api<{times:string[]}>('/admin/scheduled-tasks/preview','POST',{rule});if(seq===previewSequence&&!disposed){times.value=data.times;previewedRule.value=rule}}catch(e){if(seq===previewSequence&&!disposed){previewError.value=e instanceof Error?e.message:'规则预览失败';times.value=[];previewedRule.value=''}}finally{if(seq===previewSequence&&!disposed)previewBusy.value=false}}
async function save(){if(active.value||!ready.value||running.value)return;
 if(form.enabled&&!canEnable.value){formError.value='当前角色仅可保存停用状态的定时任务';return}
 if(!commands.value.some(c=>c.grantable&&c.value===form.command)){formError.value='请选择当前角色有权配置的命令';return}
 active.value='save';formError.value='';try{await auth.api('/admin/scheduled-tasks'+(isNew?'':'/'+id),isNew?'POST':'PUT',{name:form.name,command:form.command,params:form.params,rule:form.rule,enabled:form.enabled,remark:form.remark,...(isNew?{requestId:requestId.value}:{version:version.value})});if(!disposed){toast.add({title:'定时任务已保存',color:'success'});await navigateTo('/admin/scheduled-tasks')}}catch(e){if(!disposed)formError.value=e instanceof Error?e.message:'保存失败'}finally{if(!disposed)active.value=null}}
</script>
<template><AdminConsole :refreshing="active==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading :title="isNew?'新增定时任务':'编辑定时任务'"><template #actions><UButton to="/admin/scheduled-tasks" icon="i-lucide-arrow-left" color="neutral" variant="ghost" :disabled="active==='save'">返回</UButton></template></ConsolePageHeading>
  <UAlert v-if="error" :title="error" color="error"><template #actions><UButton :loading="active==='retry'" :disabled="!!active" @click="load('retry')">重试</UButton></template></UAlert>
  <UAlert v-if="running" title="任务正在执行，请稍后刷新再编辑。" color="warning"/>
  <form v-if="ready" id="scheduled-task-form" class="task-settings space-y-5" @submit.prevent="save"><section class="surface-card p-5 sm:p-7"><fieldset class="min-w-0 space-y-6" :disabled="!!active||running">
    <ConsoleSettingsField label="名称 *" input-id="task-name"><ConsoleInput id="task-name" v-model="form.name" placeholder="请输入名称" :maxlength="60" required class="w-full"/></ConsoleSettingsField>
    <ConsoleSettingsField label="类型"><p class="py-2 text-sm">定时任务</p></ConsoleSettingsField>
    <ConsoleSettingsField label="命令 *" input-id="task-command"><ConsoleInput id="task-command" v-model="form.command" class="w-full" required :maxlength="64" placeholder="请输入命令，如 sessions:cleanup" list="task-command-options"/><datalist id="task-command-options"><option v-for="item in commands.filter(c=>c.grantable)" :key="item.value" :value="item.value">{{item.label}}</option></datalist><p class="mt-2 text-xs leading-5 text-muted">{{description||'填写项目中已注册的命令名称。'}}</p></ConsoleSettingsField>
    <ConsoleSettingsField label="参数" input-id="task-params"><ConsoleInput id="task-params" v-model="form.params" :maxlength="1000" placeholder="请输入参数，例如：--limit 100"/></ConsoleSettingsField>
    <ConsoleSettingsField label="状态"><USwitch v-model="form.enabled" :label="form.enabled?'启用':'停用'" :disabled="!canEnable&&!form.enabled"/><p v-if="!canEnable" class="mt-2 text-xs text-muted">当前角色可保存停用的任务；启用需要执行权限。</p></ConsoleSettingsField>
    <ConsoleSettingsField label="执行规则 *" input-id="task-schedule-mode">
      <div class="task-schedule-controls flex flex-wrap items-center gap-2"><div class="w-32 shrink-0"><USelect id="task-schedule-mode" v-model="schedule.mode" :items="modeOptions" class="w-full" aria-label="执行周期"/></div>
        <div v-if="schedule.mode==='minutes'" class="w-32 shrink-0"><USelect v-model="schedule.interval" :items="[1,5,10,15,20,30].map(n=>({label:n+' 分钟',value:n}))" class="w-full" aria-label="间隔分钟"/></div>
        <div v-if="schedule.mode==='hourly'" class="flex w-32 shrink-0 items-center gap-2"><div class="w-20 shrink-0"><ConsoleInput v-model.number="schedule.minute" type="number" :min="0" :max="59" required aria-label="每小时的第几分钟"/></div><span class="text-sm text-muted">分</span></div>
        <div v-if="schedule.mode==='weekly'" class="w-20 shrink-0"><USelect v-model="schedule.weekday" :items="weekdays" class="w-full" aria-label="星期"/></div>
        <div v-if="schedule.mode==='daily'||schedule.mode==='weekly'" class="w-32 shrink-0"><ConsoleInput v-model="schedule.time" type="time" required aria-label="执行时间"/></div>
        <UButton v-if="schedule.mode!=='custom'" class="w-20 shrink-0 justify-center" color="neutral" variant="outline" :loading="previewBusy&&previewSource==='manual'" @click="preview('manual')">预览</UButton>
      </div>
      <div v-if="schedule.mode==='custom'" class="mt-3 flex gap-2"><ConsoleInput id="task-rule" v-model="form.rule" class="min-w-0 flex-1" required :maxlength="100" placeholder="例如：0 3 * * *" aria-label="Cron 表达式"/><UButton class="w-20 shrink-0 justify-center" color="neutral" variant="outline" :loading="previewBusy&&previewSource==='manual'" @click="preview('manual')">预览</UButton></div>
      <p class="mt-3 text-sm font-medium">{{scheduleText}}</p>
      <p v-if="schedule.mode==='custom'" class="mt-2 text-xs leading-5 text-muted">五项依次为分钟、小时、日期、月份、星期。示例 0 3 * * * 表示每天 03:00 执行。</p>
      <p v-if="previewError" class="mt-2 text-xs text-error">{{previewError}}</p>
      <div class="mt-4 min-h-[264px]" :aria-busy="previewBusy"><table class="w-full text-sm"><thead class="bg-elevated/50 text-muted"><tr><th class="w-16 px-3 py-3 text-left font-normal">序号</th><th class="px-3 py-3 text-left font-normal">接下来 5 次执行时间<span v-if="times.length&&previewedRule!==form.rule" class="ml-2 text-xs font-normal">{{previewBusy?'更新中…':'待更新'}}</span></th></tr></thead><tbody><tr v-for="(value,index) in times" :key="value" class="border-b border-default"><td class="px-3 py-3">{{index+1}}</td><td class="px-3 py-3 tabular-nums">{{time(value)}}</td></tr><tr v-if="!times.length"><td colspan="2" class="h-[220px] text-center text-muted">{{previewBusy?'计算中…':'选择执行时间后，点击预览'}}</td></tr></tbody></table></div>
    </ConsoleSettingsField>
    <ConsoleSettingsField label="备注" input-id="task-remark"><UTextarea id="task-remark" v-model="form.remark" :maxlength="200" :rows="3" class="w-full"/><p class="mt-1 text-right text-xs text-muted">{{form.remark.length}} / 200</p></ConsoleSettingsField>
    <UAlert v-if="formError" :title="formError" color="error"/>
  </fieldset></section>
  <div class="sticky bottom-0 z-10 border-t border-default bg-default/95 px-5 py-4 backdrop-blur"><ConsoleFormActions><UButton color="neutral" variant="outline" to="/admin/scheduled-tasks" :disabled="active==='save'">取消</UButton><UButton type="submit" form="scheduled-task-form" :loading="active==='save'" :disabled="!ready||!!active||running">保存</UButton></ConsoleFormActions></div></form>
</div></AdminConsole></template>
<style scoped>
.task-settings{--settings-label-width:8rem;--settings-content-width:28rem}
</style>
