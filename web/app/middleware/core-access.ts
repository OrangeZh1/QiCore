export default defineNuxtRouteMiddleware(async to => {
  const { data: session, error } = await useCoreSession()
  if (error.value?.statusCode === 401) return navigateTo('/login', { replace: true })
  if (error.value || !session.value) throw createError({ statusCode: error.value?.statusCode || 503, statusMessage: '无法读取当前账号' })
  const permission = to.meta.corePermission
  if (typeof permission === 'string' && !coreCan(session.value, permission)) {
    throw createError({ statusCode: 403, statusMessage: '没有访问权限' })
  }
})
