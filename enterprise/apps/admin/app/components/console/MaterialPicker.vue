<script setup lang="ts">
import ConsoleDialog from './ConsoleDialog.vue'
import type {Material} from './MaterialBrowser.vue'
import {defineConsoleAsyncComponent} from '../../utils/async-component'
const MaterialBrowser=defineConsoleAsyncComponent(()=>import('./MaterialBrowser.vue'),'素材库')
const props=withDefaults(defineProps<{purpose?:'library'|'policy'|'site'|'account'|'tenant'|'profile';kind?:'image'|'video'|'file';siteKind?:'icon'|'logo'|'login'|'avatar';portal?:'admin'|'tenant';endpoint?:string;imageFit?:'cover'|'contain';imageSize?:number;imageShape?:'square'|'banner'}>(),{purpose:'library',kind:'image',portal:'admin',endpoint:'/admin/materials'})
const open=defineModel<boolean>('open',{default:false}),selected=ref<Material[]>([]),busy=ref(false),error=ref(''),platformAuth=useApi('admin'),tenantAuth=useApi('tenant')
const auth=computed(()=>props.portal==='tenant'?tenantAuth:platformAuth)
const contentMounted=ref(open.value)
const emit=defineEmits<{select:[result:{id:string;value?:string;url?:string}];busy:[value:boolean]}>()
watch(open,value=>{if(value){contentMounted.value=true;selected.value=[];error.value=''}})
function afterLeave(){if(!open.value){contentMounted.value=false;selected.value=[];error.value=''}}
let selectionNumber=0,selectionController:AbortController|undefined
function cancelSelection(){selectionNumber++;selectionController?.abort();const wasBusy=busy.value;busy.value=false;if(wasBusy)emit('busy',false)}
watch(()=>[props.endpoint,props.portal],()=>{cancelSelection();selected.value=[];error.value=''})
onBeforeUnmount(cancelSelection)
async function confirm(){
 const row=selected.value[0];if(!row||busy.value)return
 const number=++selectionNumber,controller=new AbortController();selectionController=controller;busy.value=true;emit('busy',true);error.value=''
 try{const result=await auth.value.api<{id:string;value?:string;url?:string}>(props.endpoint+'/'+row.id+'/select','POST',{purpose:props.purpose,...(props.imageShape?{shape:props.imageShape}:{}),...(props.imageFit?{fit:props.imageFit}:{}),...(props.imageSize?{size:props.imageSize}:{}),...(props.siteKind?{siteKind:props.siteKind}:{})},{signal:controller.signal});if(number!==selectionNumber)return;emit('select',result);open.value=false}
 catch(e){if(number===selectionNumber&&!controller.signal.aborted)error.value=e instanceof Error?e.message:'选择失败'}
 finally{if(number===selectionNumber){busy.value=false;emit('busy',false)}}
}
</script>
<template><ConsoleDialog v-model:open="open" :title="kind==='image'?'选择图片':kind==='video'?'选择视频':'选择文件'" :dismissible="!busy" :close="!busy" size="wide" @after:leave="afterLeave"><template #body><MaterialBrowser v-if="contentMounted" v-model:selected="selected" :purpose="purpose" :kind="kind" :portal="portal" :endpoint="endpoint" :key="endpoint" picker full-height/><UAlert v-if="error" :title="error" color="error" class="mt-3"/></template><template #footer><div class="flex w-full items-center justify-end gap-3"><span class="mr-auto text-sm text-muted">已选择 {{selected.length}} / 1</span><UButton color="neutral" variant="outline" :disabled="busy" @click="open=false">取消</UButton><UButton :disabled="!selected.length||busy" :loading="busy" @click="confirm">确定</UButton></div></template></ConsoleDialog></template>
