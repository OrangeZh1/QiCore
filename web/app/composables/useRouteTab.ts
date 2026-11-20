import {computed} from 'vue'

export function routeTabValue<T extends string>(value:unknown,fallback:T,allowed:readonly string[]):T{
 return (typeof value==='string'&&allowed.includes(value)?value:fallback) as T
}

/** Page navigation belongs in the URL; form fields and modal tabs do not. */
export function useRouteTab<T extends string>(fallback:T,values:readonly string[]|(()=>readonly string[]),key='tab'){
 const route=useRoute(),router=useRouter(),allowed=()=>typeof values==='function'?values():values
 return computed<T>({get:()=>routeTabValue(route.query[key],fallback,allowed()),set:value=>{
  if(!allowed().includes(value)||routeTabValue(route.query[key],fallback,allowed())===value)return
  void router.push({path:route.path,query:{...route.query,[key]:value===fallback?undefined:value},hash:route.hash})
 }})
}
