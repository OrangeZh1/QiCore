import type {RouteLocationNormalized} from 'vue-router'

/** Preserve the same draft protection when page tabs change via browser history. */
export function usePageLeaveGuard(guard:(to:RouteLocationNormalized,from:RouteLocationNormalized)=>boolean|void|Promise<boolean|void>){
 onBeforeRouteLeave(guard)
 onBeforeRouteUpdate((to,from)=>{
  if(to.path===from.path&&['tab','replyTab'].some(key=>to.query[key]!==from.query[key]))return guard(to,from)
 })
}
