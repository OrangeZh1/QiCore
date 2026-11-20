import {h5Html} from '../../utils/h5-entry'
export default defineEventHandler(event=>{
 const parts=String(getRouterParam(event,'path')||'').split('/').filter(Boolean),tenantId=parts.shift()
 if(!tenantId||!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId))throw createError({statusCode:404,statusMessage:'站点不存在'})
 return h5Html(event,tenantId,parts.length?'/'+parts.join('/'):'/')
})
