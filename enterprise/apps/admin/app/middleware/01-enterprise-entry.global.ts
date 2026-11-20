import { enterpriseAlias } from '../utils/enterprise-entry'

export default defineNuxtRouteMiddleware(to => {
  if (useRuntimeConfig().public.installationMode) return
  const target = enterpriseAlias(to.path)
  if (target) {
    const [path, anchor] = target.split('#')
    return navigateTo({ path, query: to.query, hash: anchor ? '#' + anchor : to.hash }, { replace: true, redirectCode: 302 })
  }
  if (/^\/tenant(?:\/|$)/.test(to.path)) throw createError({ statusCode: 404, statusMessage: '页面不存在' })
})
