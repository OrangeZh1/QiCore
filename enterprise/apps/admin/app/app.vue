<script setup lang="ts">
import {consoleTitle} from './utils/console-title'
import {installTitle} from './utils/install-wizard'
import type {RouteLocationNormalizedLoaded} from 'vue-router'
const route=useRoute(),branding=useSiteBranding()
const {target:navigationTarget}=useConsoleNavigation()
const titlePath=computed(()=>(navigationTarget.value?.fullPath||route.fullPath).split('#')[0]!)
const tenantContext=useTenantContext()
// A legacy link can switch sites while resolving to the same canonical path.
const tenantPageKey=(target:RouteLocationNormalizedLoaded)=>{
 const key=typeof target.meta.key==='function'?target.meta.key(target):target.meta.key||target.path
 // During a pending navigation useRoute still names the previous page. Decide
 // from the target so choosing a site cannot remount its own selector/login.
 if(!target.path.startsWith('/admin/')||target.path==='/admin/login')return key
 return `${tenantContext.current.value?.accountId||''}:${tenantContext.tenantId.value}:${key}`
}
const installation=computed(()=>route.path.replace(/\/+$/,'')==='/install')
if(!installation.value&&!branding.site.value){try{await branding.load()}catch{throw createError({statusCode:503,statusMessage:'网站配置暂不可用，请稍后重试'})}}
const site=computed(()=>branding.resolvedSite.value!)
useHead(()=>installation.value?{title:installTitle(route.query.step),link:[{key:'site-favicon',rel:'icon',type:'image/png',href:'/brand/qicore.png'}]}:{title:consoleTitle(titlePath.value,site.value.platform.name,site.value.tenant.name),link:[{key:'site-favicon',rel:'icon',type:'image/png',href:(route.path.startsWith('/admin')?site.value.tenant.favicon:site.value.platform.favicon)||'/brand/qicore.png'}]})
</script>
<template><UApp><NuxtLayout><NuxtPage :page-key="tenantPageKey" /></NuxtLayout></UApp></template>
