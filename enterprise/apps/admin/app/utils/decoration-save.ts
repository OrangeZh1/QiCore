import {normalizeDecorationScheme} from '../../../api/src/core/decoration-contract.mjs'
import type {DecorationScheme} from '../../../api/src/core/decoration-types'
type Draft={id:string;name:string;scheme:DecorationScheme}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const normalized=<T extends Draft>(row:T):T=>({...row,scheme:normalizeDecorationScheme(row.scheme)})
// Merge independent editor regions. Never silently overwrite concurrent edits to the same region.
export function mergeDecorationDraft<T extends Draft>(base:T,local:T,remote:T):T{
 const b=normalized(base),l=normalized(local),r=normalized(remote),result={...r}
 const choose=<V>(before:V,ours:V,theirs:V,label:string):V=>{
  if(equal(ours,before))return theirs
  if(equal(theirs,before)||equal(ours,theirs))return ours
  throw Object.assign(Error('另一个窗口也修改了'+label+'，当前修改已保留。请先核对另一窗口，再重新读取方案。'),{code:'DECORATION_MERGE_CONFLICT'})
 }
 result.name=choose(b.name,l.name,r.name,'方案名称')
 const labels={home:'首页',profile:'个人中心',theme:'主题风格',navigation:'底部导航'}
 for(const key of ['home','profile','theme','navigation'] as const)result.scheme={...result.scheme,[key]:choose(b.scheme[key],l.scheme[key],r.scheme[key],labels[key])}
 return result
}
export async function saveDecorationDraft<T extends Draft,V extends {version:number;schemes:T[]}>(options:{base:T;local:T;version:number;action:'save'|'save-and-activate';read:()=>Promise<V>;write:(body:unknown)=>Promise<V>}):Promise<V>{
 const write=(row:T,version:number)=>options.write({version,id:row.id,action:options.action,name:row.name,scheme:row.scheme})
 try{return await write(options.local,options.version)}catch(e:any){
  if(e.code!=='DECORATION_CONFLICT')throw e
  const latest=await options.read(),remote=latest.schemes.find(row=>row.id===options.local.id)
  if(!remote)throw Error('此方案已在其他窗口删除，当前修改仍保留在编辑器中。')
  return write(mergeDecorationDraft(options.base,options.local,remote),latest.version)
 }
}
