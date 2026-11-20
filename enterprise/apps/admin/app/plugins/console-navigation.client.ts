import type {RouteLocationNormalized} from 'vue-router'
import type {VNode} from 'vue'

export default defineNuxtPlugin(nuxt=>{
 const router=useRouter(),route=useRoute(),{target}=useConsoleNavigation()
 let active:RouteLocationNormalized|undefined
 const clear=()=>{active=undefined;target.value=null}
 function begin(to:RouteLocationNormalized,from:RouteLocationNormalized){
  if(nuxt.isHydrating)return
  const portal=/^\/admin(?:\/|$)/.test(to.path)?'tenant':undefined
  if(!portal||!(from.path==='/admin'||from.path.startsWith('/admin/'))||[to.path,from.path].some(path=>path.endsWith('/login')||path==='/admin')){clear();return}
  if(to.path===from.path){
   if(target.value?.path===to.path){active=to;target.value.fullPath=to.fullPath}
   else clear()
   return
  }
  const interrupted=!!target.value
  active=to;target.value={path:to.path,fullPath:to.fullPath,portal,document:false,error:''}
  const pending=target.value,transition=to.meta.pageTransition
  if(transition!==false){
   const beforeEnter=typeof transition==='object'?transition.onBeforeEnter:undefined
   // Replacing a still-pending Suspense must not wait for that abandoned page's exit.
   to.meta.pageTransition={...(typeof transition==='object'?transition:{}),...(interrupted?{mode:'default' as const}:{}),onBeforeEnter:async element=>{
    // Suspense resolves before out-in removes the old page. Reveal content only
    // after insertion; KeepAlive also calls beforeEnter in its detached container.
    for(const hook of [beforeEnter].flat())hook?.(element)
    await nextTick()
    if(element.isConnected&&target.value===pending&&active===router.currentRoute.value&&!pending.document&&!pending.error)clear()
   }}
  }
 }
 // A failed/older navigation must not dismiss a newer destination's feedback.
 router.afterEach((to,_from,failure)=>{if(failure&&to===active&&!target.value?.document)clear()})
 router.onError((_error,to)=>{
  if(to!==active||!target.value)return
  target.value={...target.value,document:false,error:'页面暂时无法打开，请重新打开。'}
 })
 nuxt.hook('page:finish',(page?:VNode)=>{
  if(active?.meta.pageTransition===false&&page?.type===active.matched.at(-1)?.components?.default&&active===router.currentRoute.value&&target.value?.fullPath===route.fullPath&&!target.value.document)clear()
 })
 nuxt.hook('app:error',clear)
 window.addEventListener('pageshow',event=>{if(event.persisted)clear()})
 return{provide:{beginConsoleNavigation:begin,consoleDocumentNavigation:()=>{if(target.value)target.value.document=true}}}
})
