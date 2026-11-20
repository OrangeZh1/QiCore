import {sendProxy,serveStatic} from 'h3'
import {stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {installedWebApplications,applicationWebFile} from '../../../../utils/native-applications'

export default defineEventHandler(async event=>{
 const app=(await installedWebApplications()).find(app=>app.key===getRouterParam(event,'applicationKey')&&app.version===getRouterParam(event,'version'))
 const path=String(getRouterParam(event,'path')||''),[kind,...parts]=path.split('/'),file=parts.join('/')
 if(!app||!file||!/^[-\w./]+\.(?:js|mjs|css|json|png|jpg|jpeg|webp|svg|gif|ico|woff2?|ttf|mp3)$/.test(file)||file==='h5-routes.json'||file==='static/runtime.json')throw createError({statusCode:404})
 const directory=kind==='admin'?app.web.admin?.publicDir:kind==='h5'?app.web.h5?.directory:null
 if(!directory)throw createError({statusCode:404})
 if(kind==='h5'&&app.h5Origin){if(file.includes('..')||file.includes('\\'))throw createError({statusCode:404});return sendProxy(event,app.h5Origin+'/__qicore_dev/'+app.key+'/h5/'+file)}
 const types:Record<string,string>={js:'application/javascript',mjs:'application/javascript',css:'text/css',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',gif:'image/gif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',mp3:'audio/mpeg'}
 const original=event.path.split('?')[0]!,files=new Map<string,string>()
 setHeader(event,'x-content-type-options','nosniff');setHeader(event,'vary','Accept-Encoding')
 return serveStatic(event,{
  encodings:{br:'.br',gzip:'.gz'},indexNames:[],
  async getMeta(id){
   const suffix=id.startsWith(original)?id.slice(original.length):null
   if(suffix===null||!['','.br','.gz'].includes(suffix))return
   let target:string,info:Awaited<ReturnType<typeof stat>>
   try{target=await applicationWebFile(app.root,directory+'/'+file+suffix);info=await stat(target)}catch{return}
   files.set(id,target);setHeader(event,'cache-control','public, max-age=31536000, immutable')
   return{type:types[file.split('.').pop()!],size:info.size,mtime:info.mtime,etag:`W/"${info.size}-${info.mtimeMs.toString(36)}"`,encoding:suffix==='.br'?'br':suffix==='.gz'?'gzip':undefined}
  },
  getContents:id=>createReadStream(files.get(id)!)
 })
})
