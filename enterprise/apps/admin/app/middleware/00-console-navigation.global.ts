export default defineNuxtRouteMiddleware((to,from)=>{
 if(import.meta.client)useNuxtApp().$beginConsoleNavigation(to,from)
})
