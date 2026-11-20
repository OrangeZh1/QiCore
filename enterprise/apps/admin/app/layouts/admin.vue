<script setup lang="ts">
import PlatformConsoleShell from '../components/console/PlatformConsoleShell.vue'
import {consolePageKey,type ConsolePageContext} from '../utils/console-page'
const auth=useApi()
// Login and SSR already supply a server-verified session; data APIs still authenticate every request.
const session=auth.session.value??await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root')throw createError({statusCode:403,statusMessage:'需要平台管理员身份'})
const context=reactive<ConsolePageContext>({owner:null,refresh:null,refreshing:false})
provide(consolePageKey,context)
for(const name of ['zjz-platform-open-groups','zjz-tenant-menu-open','zjz-system-menu-open']){
  const previous=useCookie(name,{path:'/'});if(previous.value!=null)previous.value=null
}
</script>
<template><PlatformConsoleShell :refreshing="context.refreshing" @refresh="context.refresh?.()"><slot/></PlatformConsoleShell></template>
