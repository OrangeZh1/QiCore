import {installProxy} from '../../../../utils/install-proxy'
export default defineEventHandler(event=>{
 if(import.meta.dev&&!useRuntimeConfig().installSocket&&event.method==='GET'&&event.path==='/api/v1/install/authorization')return proxyRequest(event,String(useRuntimeConfig().apiInternalBase).replace(/\/$/,'')+'/install/authorization')
 return installProxy(event,event.path.slice('/api/v1/install'.length))
})
