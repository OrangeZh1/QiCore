import type { DefineComponent } from 'vue'
declare const component: DefineComponent<{
  label: string
  icon: string
  to: string
  active?: boolean
  collapsed?: boolean
  subitem?: boolean
  external?: boolean
  tone?: 'console' | 'account'
}>
export default component
