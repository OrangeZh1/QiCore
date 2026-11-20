<script setup lang="ts">
import TenantConsoleShell from '../components/tenant/TenantConsoleShell.vue'
import ConsoleErrorState from '@orangezh1/qisvc-console-ui/components/ConsoleErrorState'
import {consolePageKey,type ConsolePageContext} from '../utils/console-page'
import type {AdminSession} from '../composables/useApi'
const props=withDefaults(defineProps<{standalone?:boolean}>(),{standalone:false})
const editorMode=computed(()=>props.standalone)
const auth=useApi('tenant'),authenticated=ref(false),authenticationError=ref(''),retrying=ref(false)
const context=reactive<ConsolePageContext>({owner:null,refresh:null,refreshing:false})
provide(consolePageKey,context)
async function restore(){
  authenticationError.value=''
  try{const session=await auth.api<AdminSession>('/admin/auth/me');if(session.role!=='tenant')throw Object.assign(new Error('需要后台身份'),{status:403});auth.session.value=session;authenticated.value=true}
  catch(e:any){if(e.status===401)return false;authenticationError.value=e.message||'暂时无法验证登录状态'}
}
async function retry(){if(retrying.value)return;retrying.value=true;try{if(await restore()===false)await navigateTo('/admin/login',{replace:true})}finally{retrying.value=false}}
// Login, middleware and SSR supply a verified session. Scoped data APIs still
// recheck the account, tenant and license; do not repeat /auth/me on entry.
if(auth.session.value?.role==='tenant'&&Date.parse(auth.session.value.expiresAt)>Date.now())authenticated.value=true
else if(await restore()===false)await navigateTo('/admin/login',{replace:true})
</script>
<template><div v-if="!authenticationError&&authenticated&&editorMode" class="tenant-editor-host"><slot/></div><TenantConsoleShell v-else-if="!authenticationError&&authenticated" :refreshing="context.refreshing" @refresh="context.refresh?.()"><slot/></TenantConsoleShell><div v-else-if="authenticationError" class="mx-auto max-w-xl px-5 py-20"><ConsoleErrorState title="暂时无法进入后台" :description="authenticationError"><template #actions><UButton :loading="retrying" @click="retry">重试</UButton><UButton color="neutral" variant="outline" to="/admin/login">返回登录</UButton></template></ConsoleErrorState></div></template>
