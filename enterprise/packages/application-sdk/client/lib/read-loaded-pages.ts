// Refresh only the range already visible in an infinite list, and publish it atomically.
export async function readLoadedPages<T extends {items:{id:string}[];page:number;pageSize:number;total:number}>(read:(page:number)=>Promise<T>,lastPage:number,current:()=>boolean):Promise<T|null>{
 let result:T|null=null;const items:T['items'][number][]=[]
 for(let page=1;page<=Math.max(1,lastPage);page++){
  const next=await read(page);if(!current())return null
  if(next.page!==page&&result)break
  result=next;items.push(...next.items)
  if(next.page*next.pageSize>=next.total||!next.items.length)break
 }
 return result?{...result,items:[...new Map(items.map(item=>[item.id,item])).values()]}:null
}
