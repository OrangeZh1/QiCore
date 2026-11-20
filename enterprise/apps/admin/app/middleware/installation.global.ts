export default defineNuxtRouteMiddleware(to=>{
 if(useRuntimeConfig().public.installationMode&&to.path.replace(/\/+$/,'')!=='/install')return navigateTo('/install',{replace:true})
})
