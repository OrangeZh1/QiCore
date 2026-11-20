import {api,isClientPreview} from './api'
import {runtimeConfig} from './runtime-config'
export type HelpCategory={id:string;name:string}
export type HelpArticle={id:string;title:string;updatedAt:string;category:HelpCategory;content?:string}
export type HelpListing={demo?:boolean;categories:HelpCategory[];items:HelpArticle[];page:number;pageSize:number;total:number}
export function helpEndpoint(){const config=runtimeConfig();return '/public/help/'+encodeURIComponent(config.tenantId)+'/'+encodeURIComponent(config.applicationKey)}
async function scoped<T>(endpoint:string,path:string){try{return await api<T>(path)}finally{if(helpEndpoint()!==endpoint)throw Error('站点已变化，请重新读取帮助内容')}}
export async function loadHelp(query:{q?:string;categoryId?:string;page:number},demo=false){
 const endpoint=helpEndpoint(),preview=isClientPreview&&demo
 const params=Object.entries({...query,pageSize:20}).filter(([,value])=>value!==undefined).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(String(value))).join('&')
 const value=await scoped<HelpListing>(endpoint,(preview?'/dev/help':endpoint)+'?'+params)
 if(preview&&value.demo!==true)throw Error('演示问答读取失败')
 return value
}
export async function loadHelpArticle(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw Error('帮助文章不存在');const endpoint=helpEndpoint(),value=await scoped<HelpArticle&{content:string}>(endpoint,endpoint+'/'+encodeURIComponent(id));if(value.id!==id)throw Error('帮助文章不匹配，请重新读取');return value}
