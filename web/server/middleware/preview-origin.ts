// Keep browser sessions on the configured origin when opening a local development preview.
export default defineEventHandler((event) => {
  if (!import.meta.dev || event.method !== 'GET' || !getHeader(event, 'accept')?.includes('text/html')) return
  const configured = process.env.PUBLIC_ORIGIN
  if (!configured) return

  const canonical = new URL(configured)
  const request = getRequestURL(event)
  const loopback = ['localhost', '127.0.0.1', '[::1]']
  if (request.origin !== canonical.origin && request.protocol === canonical.protocol &&
      request.port === canonical.port && loopback.includes(request.hostname) && loopback.includes(canonical.hostname)) {
    return sendRedirect(event, canonical.origin + request.pathname + request.search, 302)
  }
})
