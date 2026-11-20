import {createError,getQuery,getRequestHeader,setHeader} from 'h3'
import type {H3Event} from 'h3'
import {readFile} from 'node:fs/promises'
import {installedWebApplications,applicationWebFile} from './native-applications'
import {frameworkH5Asset} from './framework-h5'

export async function h5Html(event:H3Event,tenantId?:string,pagePath='/'){
 const config=useRuntimeConfig(),query=getQuery(event),host=getRequestHeader(event,'host')||''
 let context:any
 try{const response=await $fetch<any>(String(config.apiInternalBase)+'/public/h5/runtime',{query:{host,...(tenantId?{tenantId}:{}),...(typeof query.application==='string'?{applicationKey:query.application}:{})}});context=response.data}
 catch(e:any){throw createError({statusCode:e.statusCode||e.status||503,statusMessage:e.data?.error?.message||'H5 站点暂不可用'})}
 let template:string|null,manifest:Record<string,string>|null
 if(context.contentSource==='framework'){
  template=await frameworkH5Asset('index.html');manifest=await frameworkH5Asset('h5-routes.json')
 }else if(process.env.QICORE_COMPONENTS||process.env.QICORE_DEV_WORKSPACE){
  const app=(await installedWebApplications()).find(app=>app.key===context.applicationKey)
  if(!app?.web.h5)throw createError({statusCode:503,statusMessage:'当前应用尚未安装 H5 页面'})
  template=app.h5Origin?await $fetch<string>(app.h5Origin+'/__qicore_dev/'+app.key+'/h5/') :await readFile(await applicationWebFile(app.root,app.web.h5.directory+'/index.html'),'utf8')
  manifest=JSON.parse(await readFile(await applicationWebFile(app.root,app.web.h5.directory+'/h5-routes.json'),'utf8'))
 }else{
  const assets=useStorage('assets:h5');template=await assets.getItem<string>('index.html');manifest=await assets.getItem<Record<string,string>>('h5-routes.json')
 }
 if(!template||!manifest)throw createError({statusCode:503,statusMessage:'H5 页面尚未构建'})
 const path=pagePath==='/'?'/':pagePath.replace(/\/$/,'')
 if(!Object.hasOwn(manifest,path))throw createError({statusCode:404,statusMessage:'页面不存在'})
 const names={...manifest,'/':context.homeTitle,'/profile':context.profileTitle},titles=Object.fromEntries(Object.entries(names).map(([key,name])=>[key,String(name)+' · '+context.siteName]))
 const title=titles[path];if(!title)throw createError({statusCode:404,statusMessage:'页面不存在'})
 const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
 const runtime=JSON.stringify({...context,basePath:tenantId?'/h5/'+encodeURIComponent(context.tenantId)+'/':'/',titles}).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')
 setHeader(event,'content-type','text/html; charset=utf-8');setHeader(event,'cache-control','no-store');setHeader(event,'referrer-policy','same-origin');setHeader(event,'x-content-type-options','nosniff')
 return String(template).replace(/<title>[^<]*<\/title>/,()=>'<title>'+escape(title)+'</title>').replace(/(<script id="qicore-h5-runtime" type="application\/json">)[\s\S]*?(<\/script>)/,(_match,start,end)=>start+runtime+end).replace('</head>',()=>'<link rel="icon" href="'+escape(context.favicon||'data:,')+'"></head>')
}
