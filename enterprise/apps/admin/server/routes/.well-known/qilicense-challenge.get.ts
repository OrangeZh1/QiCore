import {installProxy} from '../../utils/install-proxy'
export default defineEventHandler(async event=>{
 const result=await installProxy(event,'/challenge?token='+encodeURIComponent(String(getQuery(event).token||'')))
 return result.data
})
