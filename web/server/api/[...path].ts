export default defineEventHandler((event)=>{
  const config=useRuntimeConfig(event)
  const upstream=new URL(config.apiOrigin)
  const path=getRequestURL(event).pathname
  if(!path.startsWith('/api/')) throw createError({statusCode:400})
  return proxyRequest(event,upstream.origin+path+getRequestURL(event).search,{
    headers:{'x-qicore-client-ip':event.node.req.socket.remoteAddress||''}
  })
})
