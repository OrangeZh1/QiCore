export type CoreSession = {
  account: { id: string; login: string; avatar: string | null; displayName: string; roleId: string; role: { title: string; permissions: string[] } }
  site?: { name: string; logo: string | null; favicon: string | null; defaultAvatar: string | null; copyright: string; filing: {icpNumber: string; icpLink: string; policeNumber: string; policeLink: string} }
  brand: string
  menus: { title: string; path: string; icon?: string }[]
}

export type CoreOverview = {
  frameworkVersion: string
  application: { key: string; title: string; version: string } | null
  accounts: { total: number; enabled: number } | null
  roles: number | null
}

export function useCoreSession() {
  return useFetch<CoreSession>('/api/me', { key: 'core-session' })
}

export function coreCan(session: CoreSession | null | undefined, permission: string) {
  return !!session && (session.account.roleId === 'admin' || session.account.role.permissions.includes(permission))
}

export function coreError(error: unknown, fallback = '操作失败，请重试') {
  return (error as { data?: { message?: string } } | null)?.data?.message || fallback
}

export const corePermissionNames: Record<string, string> = {
  'core.accounts.read': '查看账号',
  'core.roles.read': '查看角色与权限',
  'core.materials.read': '查看素材', 'core.materials.write': '管理素材',
  'core.storage.read': '查看存储设置', 'core.storage.write': '管理存储设置',
  'core.site.read': '查看站点设置', 'core.site.write': '管理站点设置',
  'core.content.read': '查看内容', 'core.content.write': '管理内容',
}
