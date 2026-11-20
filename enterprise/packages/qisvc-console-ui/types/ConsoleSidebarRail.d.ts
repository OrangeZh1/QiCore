import type { DefineComponent } from 'vue'
declare const component: DefineComponent<{
  managed?: boolean
  showSidebarTheme?: boolean
  brandName?: string
  brandCaption?: string
  brandBadge?: string
  brandLogoDarkSrc?: string
  brandLogoSrc?: string
  brandTo?: string
  navigationLabel?: string
  userName?: string
  userDescription?: string
  userAvatarUrl?: string | null
  userInitial?: string
  sidebar?: Record<string, unknown>
  sidebarClass?: string
}>
export default component
