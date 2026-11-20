<script setup lang="ts">
import {operationSteps,operationTitle,updateStepIndex,updateNotice,dateTime,type UpdateTask} from '../../utils/update-center'
const props=defineProps<{task:UpdateTask;canResume:boolean;busy:boolean}>()
defineEmits<{resume:[]}>()
const notice=computed(()=>updateNotice(props.task))
const current=computed(()=>updateStepIndex(props.task.step,props.task.operation)),steps=computed(()=>operationSteps(props.task.operation)),operation=computed(()=>operationTitle(props.task.operation))
const complete=(index:number)=>props.task.status==='succeeded'||index<current.value
const repaired=computed(()=>props.task.operation==='repair'&&props.task.status==='succeeded')
const versionLabel=computed(()=>{
 const task=props.task,version=task.version||task.fromVersion
 if(task.operation==='install')return version?'安装版本 v'+version:'安装版本待确认'
 if(task.operation==='repair')return version?'修复版本 v'+version:'修复版本待确认'
 if(task.operation==='uninstall')return task.fromVersion?'卸载版本 v'+task.fromVersion:'卸载版本待确认'
 return task.fromVersion&&task.version?'v'+task.fromVersion+' → v'+task.version:task.version?'目标版本 v'+task.version:'版本待确认'
})
</script>
<template>
  <section aria-live="polite" :aria-label="operation+'流程'">
    <div class="flex items-start gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-lg" :class="task.status==='succeeded'?'bg-success/10 text-success':task.status==='running'?'bg-primary/10 text-primary':notice.color==='error'?'bg-error/10 text-error':'bg-warning/10 text-warning'"><UIcon :name="notice.icon" class="size-5" :class="{'animate-spin':task.status==='running'}"/></span><div class="min-w-0"><h2 class="font-semibold">{{notice.title}}</h2><p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span>{{versionLabel}}</span><time class="tabular-nums" :datetime="task.updatedAt">{{task.status==='succeeded'?'完成于':'更新于'}} {{dateTime(task.updatedAt)}}</time></p></div></div>
    <ol class="progress-steps my-5" :aria-label="operation+'步骤，当前第 '+(current+1)+' 步'">
      <li v-for="(step,index) in steps" :key="step" :class="{'is-complete':complete(index),'is-current':index===current}" :aria-current="index===current?'step':undefined"><span class="step-marker" :class="complete(index)?'bg-success/15 text-success':index===current?task.status==='running'?'bg-primary text-white':notice.color==='error'?'bg-error/15 text-error':'bg-warning/15 text-warning':'bg-elevated text-muted'"><UIcon v-if="complete(index)" name="i-lucide-check" class="size-3.5"/><UIcon v-else-if="index===current&&task.status==='running'" name="i-lucide-loader-circle" class="size-3.5 animate-spin"/><span v-else>{{index+1}}</span></span><span class="mt-2 block text-xs" :class="index>current&&task.status!=='succeeded'?'text-muted':'font-medium text-highlighted'">{{step}}</span><span class="mt-1 block text-[11px] text-muted">{{complete(index)?'已完成':index===current?task.status==='running'?'进行中':'已停止':task.status==='running'?'等待中':'未执行'}}</span></li>
    </ol>
    <div>
      <div class="flex flex-wrap items-start justify-between gap-3"><p class="max-w-3xl text-sm leading-6 text-muted">{{notice.description}}</p><UButton v-if="canResume&&['ACTIVE_HEALTHY_CLOSEOUT_BLOCKED','ROLLBACK_CLOSEOUT_BLOCKED'].includes(task.code||'')" size="sm" :loading="busy" @click="$emit('resume')">重试清理收尾</UButton></div>
      <details v-if="task.code" class="mt-3 text-xs text-dimmed"><summary class="w-fit cursor-pointer">技术详情</summary><p class="mt-2">错误码：{{task.code}} · 任务：{{task.id}}</p></details>
      <ul v-if="task.integrity?.length" class="mt-3 space-y-2 text-sm" :class="repaired?'text-muted':'text-warning'" :aria-label="repaired?'已修复的程序文件':'需要处理的本地文件'"><li v-for="file in task.integrity" :key="file.path" class="break-all">{{repaired?'已恢复':{modified:'本地修改或损坏',missing:'缺少文件',unknown:'不明文件',unsafe:'不安全文件'}[file.kind]}}：{{file.path}}</li></ul>
    </div>
  </section>
</template>
<style scoped>.progress-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.progress-steps li{position:relative;min-width:0;text-align:center;line-height:1.5}.progress-steps li:not(:last-child)::after{content:'';position:absolute;left:calc(50% + 18px);top:11px;width:calc(100% - 28px);height:1px;background:var(--ui-border)}.progress-steps li.is-complete::after{background:var(--ui-success)}.step-marker{position:relative;z-index:1;display:grid;place-items:center;width:24px;height:24px;margin:auto;border-radius:50%;font-size:11px;font-weight:600}@media(prefers-reduced-motion:reduce){.animate-spin{animation:none}}</style>
