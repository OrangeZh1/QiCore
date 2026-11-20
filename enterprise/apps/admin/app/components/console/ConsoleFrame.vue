<script setup lang="ts">
import ConsoleShell from '@orangezh1/qisvc-console-ui/components/ConsoleShell'
import ConsoleTopbar from '@orangezh1/qisvc-console-ui/components/ConsoleTopbar'
import ConsoleUserMenu from '@orangezh1/qisvc-console-ui/components/ConsoleUserMenu'
import ConsoleThemeToggle from '@orangezh1/qisvc-console-ui/components/ConsoleThemeToggle'
import SiteLegalFooter from './SiteLegalFooter.vue'
import ConsoleNavigationState from './ConsoleNavigationState.vue'
const props=defineProps<{portal:'admin'|'tenant';brandTo:string;breadcrumbs:{label:string;to?:string}[];refreshing?:boolean;fill?:boolean;stretch?:boolean;workspace?:boolean;profileTo?:string;standalone?:boolean}>()
const emit=defineEmits<{refresh:[]}>()
const {target}=useConsoleNavigation()
const auth=useApi(props.portal),branding=useSiteBranding(),site=branding.resolvedSite||branding.site,leaving=ref<'header'|null>(null),leaveError=ref('')
const brand=computed(()=>props.portal==='admin'?site.value!.platform:site.value!.tenant)
const logo=computed(()=>brand.value.logo||'/brand/qicore.png')
const accountItems=computed(()=>[...(props.profileTo?[[{label:'个人资料',icon:'i-lucide-user-round',to:props.profileTo}]]:[]),[{label:'退出登录',icon:'i-lucide-log-out',onSelect:()=>leave('header')}]])
async function leave(source:'header'){
  if(leaving.value)return
  leaving.value=source;leaveError.value=''
  const destination=`/admin/login`
  try{
    await auth.api('/admin/auth/logout','POST')
    auth.session.value=null;await navigateTo(destination,{replace:true,external:true})
  }
  catch(e){leaveError.value=e instanceof Error?e.message:'退出未完成，请重试'}
  finally{leaving.value=null}
}
</script>
<template>
  <div v-if="standalone" class="min-h-dvh bg-muted text-default">
    <header class="flex min-h-16 w-full bg-default items-center justify-between gap-3 border-b border-default px-5 py-3 sm:px-8"><div class="flex items-center gap-3"><img :src="logo" :alt="brand.name" class="size-9 shrink-0 object-contain"/><span class="hidden whitespace-nowrap font-semibold sm:inline">{{brand.name}}</span></div><div class="flex items-center gap-2"><slot name="context"/><ConsoleThemeToggle/><ConsoleUserMenu :name="auth.session.value?.nickname" :avatar-url="auth.session.value?.avatar" :avatar-fallback-src="brand.defaultAvatar||'/brand/admin-avatar.png'" :disabled="leaving!==null" :items="accountItems"><template v-if="leaving==='header'" #avatar><UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" aria-label="正在退出"/></template></ConsoleUserMenu></div></header>
    <main class="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-12"><UAlert v-if="leaveError" class="mb-6" color="error" :title="leaveError"/><ConsoleNavigationState v-if="target"/><div :style="{display:target?'none':'contents'}" :inert="!!target" :aria-hidden="target?true:undefined"><slot/></div><SiteLegalFooter class="mt-12"/></main>
  </div>
  <ConsoleShell v-else managed-sidebar :brand-name="brand.name" :brand-caption="portal==='admin'?'平台管理后台':'管理后台'" :brand-logo-src="logo" :brand-logo-dark-src="logo" :brand-to="brandTo" :show-sidebar-theme="false" :sidebar="{ui:{footer:'hidden'}}" :storage-key="'zjz-'+(portal==='admin'?'platform':'tenant')+'-console'" class="console-frame" :class="{'console-frame-fill':fill,'console-frame-stretch':stretch,'console-frame-workspace':workspace}" :stage-class="'w-full px-5 py-4 sm:px-8 sm:py-12 lg:px-14 lg:pb-14 lg:pt-16'+(fill?' console-frame-stage flex min-h-0 flex-1 flex-col':stretch?' console-frame-stage flex flex-1 flex-col':'')">
    <template #navigation="{collapsed}"><slot name="navigation" :collapsed="collapsed"/></template>
    <template #header><ConsoleTopbar :breadcrumbs="breadcrumbs" :refreshing="refreshing" :refresh-disabled="!!target" @refresh="emit('refresh')"><template #actions><slot name="context"/><ConsoleThemeToggle/><ConsoleUserMenu :name="auth.session.value?.nickname" :avatar-url="auth.session.value?.avatar" :avatar-fallback-src="brand.defaultAvatar||'/brand/admin-avatar.png'" :disabled="leaving!==null" :aria-busy="leaving==='header'" :items="accountItems"><template v-if="leaving==='header'" #avatar><span class="flex size-7 items-center justify-center" role="status"><UIcon name="i-lucide-loader-circle" class="size-5 animate-spin"/><span class="sr-only">正在退出</span></span></template></ConsoleUserMenu></template></ConsoleTopbar></template>
    <UAlert v-if="leaveError" class="mb-6" color="error" :title="leaveError"/>
    <ConsoleNavigationState v-if="target"/><div :style="{display:target?'none':'contents'}" :inert="!!target" :aria-hidden="target?true:undefined"><slot/></div><SiteLegalFooter :class="fill?'mt-3 shrink-0':'mt-8'"/>
  </ConsoleShell>
</template>
<style scoped>
.console-frame :deep(.qisvc-console-page-heading){min-height:60px;align-items:flex-start;margin-block:0 20px}.console-frame :deep(.qisvc-console-page-heading + *){margin-block-start:0}
.console-frame :deep(.qisvc-console-sidebar-group-trigger[data-open="true"]),.console-frame :deep(.qisvc-console-sidebar-group-trigger){color:var(--ui-text);background:transparent;font-weight:400}.console-frame :deep(.qisvc-console-sidebar-group-trigger:hover){background:var(--ui-bg-elevated)}
.console-frame-fill :deep(.qisvc-console-panel){height:100dvh;min-height:0;overflow:hidden}.console-frame-fill :deep(.qisvc-console-panel-body){min-height:0;overflow:hidden!important}.console-frame-fill :deep(.console-frame-stage){height:100%;min-height:0}.console-frame-fill :deep(.console-page-content){display:flex;flex:1;min-height:0;flex-direction:column}
.console-frame-stretch :deep(.qisvc-console-panel){min-height:100dvh}.console-frame-stretch :deep(.qisvc-console-panel-body){display:flex;flex:1;flex-direction:column}.console-frame-stretch :deep(.console-frame-stage){flex:1}.console-frame-stretch :deep(.console-page-content){display:flex;flex:1;flex-direction:column;min-width:0}
.console-frame-workspace :deep(.console-frame-stage){padding:20px 28px!important}.console-frame-workspace :deep(.qisvc-console-page-heading){min-height:34px;margin:0;flex-shrink:0}.console-frame-workspace :deep(.qisvc-console-page-heading-title){font-size:21px}@media(max-width:640px){.console-frame-workspace :deep(.console-frame-stage){padding:12px!important}}
</style>
