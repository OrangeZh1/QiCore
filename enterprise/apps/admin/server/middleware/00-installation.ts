export default defineEventHandler(event=>{
 const raw=event.path.split('?')[0]||'/'
 let decoded:string
 try { decoded=decodeURIComponent(raw) } catch { throw createError({statusCode:400,statusMessage:'地址无效'}) }
 const surface=decoded.replaceAll('\\','/')
 if (/^\/+tenant(?:\/|$)/i.test(surface)) throw createError({statusCode:404,statusMessage:'页面不存在'})
 if (/^\/+admin(?:\/|$)/i.test(surface) && (decoded!==raw || surface!==raw || !/^\/admin(?:\/|$)/.test(raw))) throw createError({statusCode:404,statusMessage:'页面不存在'})
 // Installation must precede application and H5 handlers that need the installed API.
 if(!useRuntimeConfig().public.installationMode||!['GET','HEAD'].includes(event.method))return
 const path=event.path.split('?')[0]||'/'
 if(path==='/install'||path==='/install/'||path==='/health'||path.startsWith('/api/')||path.startsWith('/_nuxt')||path.startsWith('/brand/')||path.startsWith('/.well-known/')||path.startsWith('/__nuxt_error'))return
 setHeader(event,'cache-control','no-store, private')
 return sendRedirect(event,'/install',302)
})
