import type { DefineComponent } from 'vue'
export interface ConsoleSidebarGroupItem {
  label: string
  icon: string
  to: string
  active?: boolean
  external?: boolean
}
declare const component: DefineComponent<{
  groupKey: string
  label: string
  icon: string
  items: ConsoleSidebarGroupItem[]
  open?: boolean
  collapsed?: boolean
}>
export default component
