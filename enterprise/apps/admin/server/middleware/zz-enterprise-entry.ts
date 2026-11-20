import { enterpriseAlias } from '../../app/utils/enterprise-entry'
import { isTenantPage } from '../../app/utils/tenant-routes'

export default defineEventHandler(async event => {
  if (useRuntimeConfig(event).public.installationMode) return
  const url = getRequestURL(event)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (/^\/tenant(?:\/|$)/i.test(pathname)) throw createError({statusCode:404,statusMessage:'页面不存在'})
  const target = enterpriseAlias(pathname)
  if (target && ['GET','HEAD'].includes(event.method)) {
    let [path, anchor] = target.split('#')
    if (pathname === '/' || pathname === '/admin') {
      const cookie = getRequestHeader(event,'cookie') || ''
      if (!cookie) path = '/admin/login'
      else {
        try {
          const {data:s} = await $fetch<any>(String(useRuntimeConfig(event).apiInternalBase)+'/admin/auth/me',{headers:{cookie,'X-Console-Portal':'tenant'}})
          if (s?.role !== 'tenant' || s.delegated || s.tenantIds?.length !== 1 || (s.tenantId && s.tenantId !== s.tenantIds[0])) path = '/admin/login'
        } catch (error:any) {
          if (![401,403].includes(error.statusCode || error.status)) throw error
          path = '/admin/login'
        }
      }
    }
    setHeader(event,'cache-control','no-store, private')
    return sendRedirect(event, path + url.search + (anchor ? '#' + anchor : ''), 302)
  }
  if (/^\/admin(?:\/|$)/i.test(pathname) && !isTenantPage(pathname)) throw createError({statusCode:404,statusMessage:'页面不存在'})
})
