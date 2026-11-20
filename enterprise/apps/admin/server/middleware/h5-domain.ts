import {h5Html} from '../utils/h5-entry'
import {isH5PlatformHost} from '../../../api/src/core/h5-entry.mjs'
export default defineEventHandler(async event=>{
 const path=event.path.split('?')[0]||'/'
 if(/^\/(?:admin|tenant)(?:\/|$)/i.test(path)||path==='/install'||path.startsWith('/.well-known/')||path.startsWith('/api/')||path.startsWith('/h5-assets/')||path.startsWith('/h5/')||path.startsWith('/_nuxt/')||path.startsWith('/application-assets/'))return
 const host=getRequestHeader(event,'host')||''
 try{if(isH5PlatformHost(host))return}catch{throw createError({statusCode:400,statusMessage:'访问域名无效'})}
 if(process.env.QICORE_COMPONENTS)return h5Html(event,undefined,path)
 const manifest=await useStorage('assets:h5').getItem<Record<string,string>>('h5-routes.json')
 if(path!=='/'&&!Object.hasOwn(manifest||{},path.replace(/\/$/,'')))return
 return h5Html(event,undefined,path)
})
