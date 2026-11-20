import {activeConsoleGroups,type ConsoleMenuGroup,type ConsoleMenuItem} from '../utils/console-navigation'
import type {ComputedRef} from 'vue'

type MenuState={identity:string;path:string;groups:string[];restored:boolean}
type MenuHandoff={identity:string;path:string;from:string;groups:string[]}
const emptyMenu=():MenuState=>({identity:'',path:'',groups:[],restored:false})
const navigationQuery='__qicore_menu'
const handoffCookie=(portal:string,token:string)=>'qicore-'+portal+'-menu-handoff-'+token

/** Called only after leave guards accept a same-tab document navigation. */
export function prepareConsoleMenuNavigation(portal:'admin'|'tenant',destination:string){
 if(!import.meta.client)return destination
 const state=useState<MenuState>(portal+'-menu-expansion',emptyMenu).value
 const target=new URL(destination,location.origin),path=target.pathname
 if(target.origin!==location.origin||!state.identity||!state.path.startsWith('/admin/')||!path.startsWith('/admin/')||path==='/admin/login')return destination
 const token=crypto.randomUUID(),value:MenuHandoff={identity:state.identity,path,from:location.origin+state.path,groups:state.groups}
 // Write synchronously before location.assign; no credentials or long-lived preference.
 document.cookie=handoffCookie(portal,token)+'='+encodeURIComponent(JSON.stringify(value))+'; Path=/; SameSite=Strict; Max-Age=30'+(location.protocol==='https:'?'; Secure':'')
 target.searchParams.set(navigationQuery,token)
 return target.pathname+target.search+target.hash
}

export function useConsoleMenuExpansion(portal:'admin'|'tenant',groups:ComputedRef<ConsoleMenuGroup[]>,tenantId:()=>string=()=>''){
 const auth=useApi(portal),route=useRoute()
 const identity=computed(()=>JSON.stringify([auth.session.value?.id,auth.session.value?.expiresAt,auth.session.value?.delegated,auth.session.value?.delegatedBy,tenantId()]))
 const state=useState<MenuState>(portal+'-menu-expansion',emptyMenu)
 const allowed=computed(()=>{
  const keys=new Set<string>();const visit=(items:readonly ConsoleMenuItem[])=>{for(const item of items)if('children' in item){keys.add(item.key);visit(item.children)}}
  for(const group of groups.value){keys.add(group.key);visit(group.items)}return keys
 })
 const inside=()=>(route.path==='/admin'||route.path.startsWith('/admin/'))&&route.path!=='/admin/login'&&(portal!=='tenant'||route.path!=='/admin')
 const openGroups=computed(()=>state.value.groups.filter(key=>allowed.value.has(key)))
 function reveal(){state.value.groups=inside()?[...new Set([...state.value.groups,...activeConsoleGroups(groups.value,route.path)])].filter(key=>allowed.value.has(key)):[]}
 function toggleGroup(key:string){if(!allowed.value.has(key))return;state.value.groups=openGroups.value.includes(key)?openGroups.value.filter(value=>value!==key):[...openGroups.value,key]}
 watch(identity,()=>{state.value.identity=identity.value;state.value.groups=[];reveal()},{flush:'sync'})
 if(state.value.identity!==identity.value){state.value.identity=identity.value;state.value.groups=[]}
 if(!state.value.restored){
  state.value.restored=true
  // The next server render consumes the navigation-only hint. Its HTML and
  // hydration payload agree from the first frame; refresh has no hint to restore.
  const token=route.query[navigationQuery]
  if(import.meta.server&&typeof token==='string'&&/^[a-f0-9-]{36}$/.test(token)){
   const cookie=useCookie<MenuHandoff|null>(handoffCookie(portal,token),{path:'/',sameSite:'strict',default:()=>null})
   const saved=cookie.value;cookie.value=null
   try{
    const referrer=useRequestHeaders(['referer']).referer
    const from=referrer?new URL(referrer):null,origin=useRequestURL({xForwardedHost:true,xForwardedProto:true}).origin
    if(from?.origin===origin&&saved?.identity===identity.value&&saved.path===route.path&&saved.from===from.origin+from.pathname&&Array.isArray(saved.groups)&&saved.groups.length<=64&&saved.groups.every(key=>typeof key==='string'&&key.length<=100))state.value.groups=saved.groups.filter(key=>allowed.value.has(key))
   }catch{/* An invalid hint never overrides route initialization. */}
  }
 }
 onMounted(()=>{if(navigationQuery in route.query){const query={...route.query};delete query[navigationQuery];void useRouter().replace({path:route.path,query,hash:route.hash})}})
 watch(()=>route.path,()=>{if(state.value.path!==route.path){state.value.path=route.path;reveal()}},{immediate:true,flush:'sync'})
 // Permission changes remove inaccessible groups permanently, without reopening a manually closed group.
 watch(allowed,()=>{state.value.groups=state.value.groups.filter(key=>allowed.value.has(key))},{flush:'sync'})
 return {openGroups,toggleGroup}
}
