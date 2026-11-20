// Reused from school-shop console-navigation; only page routes and grants are adapted.
export type ConsoleMenuItem = { label: string; icon: string; to: string; active?: boolean }
  | { key: string; label: string; icon: string; children: readonly ConsoleMenuItem[] }
export type ConsoleMenuGroup = { active?: boolean; to?: string; key: string; label: string; icon: string; items: readonly ConsoleMenuItem[] }

export const normalizeConsolePath = (path: string) => (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
// Use the server's effective grants for both navigation and direct page access.
const pagePermissions: Record<string, string[]> = { '': ['overview.read'], updates: ['services.read'], tenants: ['tenants.read'], 'saas-users': ['accounts.read'], administrators: ['accounts.read'], roles: ['roles.read'], site: ['settings.read'], storage: ['settings.read'], 'system-logs': ['audit.read'], environment: ['services.read'], 'data-security': ['backups.read'], 'system-cache': ['cache.read'], 'scheduled-tasks': ['tasks.read'], materials: ['materials.read'] }

type MenuProfile = { permissions: string[]; isOwner?: boolean }
export function platformLanding(profile:MenuProfile){
  const page=Object.entries(pagePermissions).find(([,grants])=>grants.some(key=>profile.permissions.includes(key)))?.[0]
  return page===undefined?'/admin/profile':'/admin'+(page?'/'+page:'')
}
export function canAccessConsolePath(path: string, profile: MenuProfile | null) {
  if (!profile) return false
  const page = normalizeConsolePath(path).split('/')[2] || ''
  if (['login', 'profile', 'password'].includes(page)) return true
  return (pagePermissions[page] || []).some(key => key === '@owner' ? profile.isOwner === true : profile.permissions.includes(key))
}
export function filterConsoleItems(items: readonly ConsoleMenuItem[], profile: MenuProfile | null): ConsoleMenuItem[] {
  return items.flatMap<ConsoleMenuItem>(item => {
    if ('children' in item) {
      const children = filterConsoleItems(item.children, profile)
      return children.length ? [{ ...item, children }] : []
    }
    return canAccessConsolePath(item.to, profile) ? [item] : []
  })
}
export function menuPath(path: string) {
  const [pathname, query] = path.split('?')
  const clean = normalizeConsolePath(pathname || '/')
  if (clean === '/admin/payments/wechat-virtual') return '/admin/payments/wechat?tab=virtual'
  if (clean === '/admin/payments/wechat') return '/admin/payments/wechat?tab=' + (new URLSearchParams(query).get('tab') === 'ordinary' ? 'ordinary' : 'virtual')
  if (clean === '/admin/help-editor') return '/admin/help'
  if (clean === '/admin/policy-editor') return '/admin/policies'
  if (clean === '/admin/decoration-editor') return new URLSearchParams(query).has('template') ? '/admin/decoration-templates' : '/admin/decoration'
  return clean.replace(/^(\/(?:admin|tenant)\/(?:tenants|saas-users|scheduled-tasks))\/[^/]+$/, '$1')
}

export function markConsoleItems(items: readonly ConsoleMenuItem[], path: string): ConsoleMenuItem[] {
  return items.map(item => 'children' in item
    ? { ...item, children: markConsoleItems(item.children, path) }
    : { ...item, active: menuPath(path) === menuPath(item.to) })
}
export function activeConsoleGroups(groups: readonly ConsoleMenuGroup[], path: string): string[] {
  function ancestors(items: readonly ConsoleMenuItem[]): string[] | undefined {
    for (const item of items) {
      if ('children' in item) {
        const nested = ancestors(item.children)
        if (nested) return [item.key, ...nested]
      } else if (menuPath(path) === menuPath(item.to)) return []
    }
  }
  for (const group of groups) {
    if (group.to === menuPath(path)) return []
    const nested = ancestors(group.items)
    if (nested) return [group.key, ...nested]
  }
  return []
}

export function consoleBreadcrumbs(groups: readonly ConsoleMenuGroup[], path: string): { label: string }[] {
  const channelName:Record<string,string>={'/admin/mini-program':'微信小程序','/admin/official-account':'微信公众号','/admin/h5':'H5端'}
  if(channelName[normalizeConsolePath(path)]&&groups.some(g=>g.key==='channels'&&g.to==='/admin/channels'))return[{label:'渠道管理'},{label:channelName[normalizeConsolePath(path)]!}]
  function find(items: readonly ConsoleMenuItem[]): { label: string }[] | null {
    for (const item of items) {
      if ('children' in item) { const nested = find(item.children); if (nested) return [{ label: item.label }, ...nested] }
      else if (menuPath(item.to) === menuPath(path)) return [{ label: item.label }]
    }
    return null
  }
  for (const group of groups) { if(group.to===normalizeConsolePath(path))return[{label:group.label}];const items = find(group.items); if (items) return [{ label: group.label }, ...items, ...(menuPath(path) !== normalizeConsolePath(path) && !normalizeConsolePath(path).startsWith('/admin/payments/wechat') ? [{ label: normalizeConsolePath(path)==='/admin/help-editor'?'帮助文章编辑':normalizeConsolePath(path)==='/admin/policy-editor'?'协议编辑':path.startsWith('/admin/decoration-editor')?'装修编辑器':path.includes('/scheduled-tasks/') ? (path.endsWith('/new')?'新增定时任务':'编辑定时任务') : path.includes('/tenants/') ? '租户详情' : '用户详情' }] : [])] }
  return []
}
