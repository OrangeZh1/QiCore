export default defineEventHandler(event=>{
 const base=String(useRuntimeConfig().apiInternalBase).replace(/\/$/,'')
 return proxyRequest(event,base+event.path.slice('/api/v1'.length))
})
