import {menuPath,type ConsoleMenuGroup,type ConsoleMenuItem} from './console-navigation.ts'
export type ApplicationConsoleRoute={path:string;label:string;group:string;icon:string;permission:string;applicationKey:string;afterSales?:boolean}
const groups:Record<string,[string,string]>={workbench:['工作台','i-lucide-layout-dashboard'],users:['用户管理','i-lucide-users'],production:['制作管理','i-lucide-layers'],transactions:['交易管理','i-lucide-credit-card'],materials:['素材管理','i-lucide-images'],content:['内容管理','i-lucide-file-text'],decoration:['装修管理','i-lucide-panels-top-left'],channels:['渠道管理','i-lucide-waypoints'],permissions:['权限管理','i-lucide-shield-check'],settings:['系统设置','i-lucide-settings']}
export function applicationMenus(base:ConsoleMenuGroup[],routes:ApplicationConsoleRoute[],current:string){
 const offsets=new Map<string,number>()
 const result=base.map(group=>({...group,items:[...group.items]}))
 for(const route of routes){
  const definition=groups[route.group];if(!definition)continue
  let group=result.find(g=>g.key===route.group)
  if(group?.to===route.path)continue
  if(!group){group={key:route.group,label:definition[0],icon:definition[1],items:[]};result.push(group)}
  if(route.group==='workbench'&&!group.items.length&&!group.to){group.to=route.path;continue}
  if(group.to){group.items.push({label:group.label,icon:group.icon,to:group.to});delete group.to}
  if(!group.items.some(item=>'to' in item&&item.to===route.path)){const index=offsets.get(group.key)||0;group.items.splice(index,0,{label:route.label,icon:route.icon,to:route.path});offsets.set(group.key,index+1)}
 }
 const ordered=result.sort((a,b)=>Object.keys(groups).indexOf(a.key)-Object.keys(groups).indexOf(b.key))
 const target=menuPath(current)
 let claimed=false
 function active(to:string) {
  if (claimed || target!==menuPath(to)) return false
  claimed=true
  return true
 }
 function mark(items:readonly ConsoleMenuItem[]):ConsoleMenuItem[] {
  return items.map(item=>'children' in item ? {...item,children:mark(item.children)} : {...item,active:active(item.to)})
 }
 return ordered.map(group=>group.to ? {...group,active:active(group.to)} : {...group,items:mark(group.items)})
}
