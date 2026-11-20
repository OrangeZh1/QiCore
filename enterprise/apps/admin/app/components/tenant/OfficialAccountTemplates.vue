<script setup lang="ts">
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import type {OfficialTemplate} from '~/types/official-account'
const props=defineProps<{disabled:boolean}>(),model=defineModel<OfficialTemplate[]>({required:true})
function add(){if(!props.disabled)model.value.push({id:crypto.randomUUID(),name:'',templateId:'',enabled:true,remark:''})}
</script>
<template><section class="surface-card official-content space-y-5 p-5 sm:p-7">
 <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-sm font-semibold">模板消息配置<span class="ml-2 font-normal text-muted">共 {{model.length}} 个模板</span></h2><UButton type="button" icon="i-lucide-plus" :disabled="disabled" @click="add">添加模板</UButton></div>
 <section v-for="(row,index) in model" :key="row.id" class="space-y-4 border-t border-default pt-5" :aria-label="'模板 '+(index+1)">
  <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold">模板 {{index+1}}</h3><UButton type="button" icon="i-lucide-trash-2" color="error" variant="ghost" :disabled="disabled" :aria-label="'移除模板 '+(index+1)" @click="model.splice(index,1)">移除</UButton></div>
  <div class="grid gap-4 sm:grid-cols-2"><UFormField label="通知名称" required><ConsoleInput v-model="row.name" required :maxlength="60" :disabled="disabled" :aria-label="'模板 '+(index+1)+' 通知名称'" class="w-full"/></UFormField><UFormField label="模板 ID" required><ConsoleInput v-model="row.templateId" required pattern="[A-Za-z0-9_-]+" :maxlength="128" :disabled="disabled" :aria-label="'模板 '+(index+1)+' ID'" class="w-full"/></UFormField><UFormField label="备注" class="sm:col-span-2"><ConsoleInput v-model="row.remark" :maxlength="300" :disabled="disabled" :aria-label="'模板 '+(index+1)+' 备注'" class="w-full"/></UFormField></div>
 </section>
 <p v-if="!model.length" class="py-8 text-center text-sm text-muted">暂无模板消息配置</p><p class="border-t border-default pt-4 text-xs text-muted">模板 ID 从本公众号的微信公众平台取得。此处仅保存模板资料，当前尚不支持按业务事件自动发送模板消息。</p>
</section></template>
