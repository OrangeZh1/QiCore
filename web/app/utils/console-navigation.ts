export type ConsoleMenuItem = {label:string;icon:string;to:string;active?:boolean}
  | {key:string;label:string;icon:string;children:readonly ConsoleMenuItem[]}
export type CoreMenuItem = {to:string;label:string;icon:string;permission:string}
  | {key:string;label:string;icon:string;children:readonly CoreMenuItem[]}
export type CoreMenuGroup = {key:string;label:string;icon:string;items:readonly CoreMenuItem[]}

const editors: Record<string,string> = {
  '/admin/policy-editor':'/admin/policies',
  '/admin/help-editor':'/admin/help',
  '/admin/decoration-editor':'/admin/decoration',
  '/admin/administrators':'/admin/accounts',
}
export function canonicalMenuPath(path:string) {
  const clean = path.replace(/\/+$/, '') || '/'
  return editors[clean] || clean
}
export function visibleMenu(items:readonly CoreMenuItem[], path:string, allowed:(permission:string)=>boolean):ConsoleMenuItem[] {
  return items.flatMap<ConsoleMenuItem>(item=>{
    if ('children' in item) {
      const children=visibleMenu(item.children,path,allowed)
      return children.length?[{...item,children}]:[]
    }
    return allowed(item.permission)?[{...item,active:canonicalMenuPath(path)===item.to}]:[]
  })
}
export function activeTrail(items:readonly ConsoleMenuItem[]):{label:string;key?:string;to?:string}[] {
  for (const item of items) {
    if ('children' in item) {
      const nested=activeTrail(item.children)
      if(nested.length)return [{label:item.label,key:item.key},...nested]
    } else if(item.active) return [{label:item.label,to:item.to}]
  }
  return []
}
