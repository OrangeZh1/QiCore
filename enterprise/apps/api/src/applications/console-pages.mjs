// Host-owned enterprise pages, retired platform operations and public aliases
// cannot be claimed by an application. Workbench is the explicit extension slot.
const reserved = new Set([
  'apps','login','password','accounts','profile','applications','users','administrators','roles',
  'channels','h5','member-levels','member-tags','help','help-editor','decoration','decoration-editor',
  'decoration-theme','decoration-navigation','decoration-login','page-routes','decoration-templates',
  'policy-editor','policies','user-settings','user-registration','customer-service','points-ledger',
  'after-sales','subscriptions','notifications','message-records','sms','site','storage','mini-program',
  'official-account','payment-channel','payments','entitlements','entitlement-ledger','transactions','packages',
  'recharge','recharge-orders','materials','environment','data-security','scheduled-tasks','system-cache',
  'system-logs','tenants','saas-users','updates',
])

export function canonicalApplicationPage(path) {
  if (typeof path !== 'string') return null
  const slug = /^\/(?:admin|tenant)\/([a-z][a-z0-9-]{1,63})$/.exec(path)?.[1]
  return slug && !reserved.has(slug) ? '/admin/' + slug : null
}

// Signed descriptor bytes stay intact. Only the exposed, authorized route
// catalog is projected onto the public enterprise URL namespace.
export function canonicalConsoleRoutes(routes) {
  const used = new Set()
  return routes.map(route => {
    const path = canonicalApplicationPage(route.path)
    if (!path || used.has(path)) throw Error('APPLICATION_CONSOLE_ROUTE_CONFLICT')
    used.add(path)
    return { ...route, path }
  })
}
