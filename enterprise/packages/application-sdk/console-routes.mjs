import { canonicalApplicationPage } from '../../apps/api/src/applications/console-pages.mjs'

export function projectSdkRoutes(pages) {
  const occupied = new Set()
  const publicPath = input => {
    const path = canonicalApplicationPage(input)
    if (!path) throw Error('APPLICATION_PAGE_RESERVED_OR_INVALID: ' + input)
    if (occupied.has(path)) throw Error('APPLICATION_PAGE_CONFLICT: ' + path)
    occupied.add(path)
    return path
  }
  function visit(routes, parent='') {
    for (const page of routes) {
      const raw = page.path.startsWith('/') ? page.path : parent + '/' + page.path
      if (/^\/(tenant|admin)(?:\/|$)/.test(raw)) {
        if ((raw === '/tenant' || raw === '/admin') && page.children?.length) page.path='/admin'
        else page.path=publicPath(raw)
      }
      if (page.alias) {
        const aliases=Array.isArray(page.alias)?page.alias:[page.alias]
        page.alias=aliases.map(alias=>/^\/(tenant|admin)(?:\/|$)/.test(alias)?publicPath(alias):alias)
      }
      if (page.children) visit(page.children,raw.replace(/\/$/,''))
    }
  }
  visit(pages)
}

export function setupEnterpriseConsole(_options,nuxt) {
  const app=nuxt.options.runtimeConfig.public.nativeApplication
  if(app?.routes){
    const routes=app.routes.map(path=>canonicalApplicationPage(path))
    if(routes.some(path=>!path)||new Set(routes).size!==routes.length)throw Error('APPLICATION_CONSOLE_ROUTE_CONFLICT')
    app.routes=routes
  }
  nuxt.hook('pages:extend',projectSdkRoutes)
}
