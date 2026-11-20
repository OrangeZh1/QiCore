import type { DefineComponent } from 'vue'
declare const component: DefineComponent<{
  storageKey: string
  managedSidebar?: boolean
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
  withPanel?: boolean
  sidebar?: Record<string, unknown>
  sidebarClass?: string
  panelClass?: string
  stageClass?: string
}>
export default component
