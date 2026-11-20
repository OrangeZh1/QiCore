import {frameworkH5Asset} from '../../utils/framework-h5'
export default defineEventHandler(async event=>{
 const path=String(getRouterParam(event,'path')||'')
 if(!path||path.includes('..')||path.includes('\\')||!/^[-\w./]+\.(?:js|css|json|png|jpg|jpeg|webp|svg|gif|woff2?|ttf|mp3)$/.test(path)||path==='h5-routes.json'||path==='static/runtime.json')throw createError({statusCode:404})
 const value=await frameworkH5Asset(path,true)??(!process.env.QICORE_COMPONENTS?await useStorage('assets:h5').getItemRaw(path):null);if(value===null)throw createError({statusCode:404})
 const types:Record<string,string>={js:'application/javascript',css:'text/css',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',gif:'image/gif',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',mp3:'audio/mpeg'}
 setHeader(event,'content-type',types[path.split('.').pop()!]||'application/octet-stream');setHeader(event,'x-content-type-options','nosniff');setHeader(event,'cache-control',path.startsWith('assets/')?'public, max-age=31536000, immutable':'public, max-age=300')
 return value
})
