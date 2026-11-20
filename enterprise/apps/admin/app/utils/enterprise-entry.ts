export function enterpriseAlias(path: string): string | undefined {
  const clean = path.replace(/\/+$/, '') || '/'
  const aliases: Record<string,string> = {
    '/': '/admin/workbench', '/admin': '/admin/workbench', '/login': '/admin/login',
    '/admin/accounts': '/admin/administrators', '/admin/applications': '/admin/workbench',
    '/admin/password': '/admin/profile#password',
  }
  return aliases[clean]
}
