import type { DefineComponent, VNode } from 'vue'

declare const component: DefineComponent & { new(): {
  $slots: { default?: () => VNode[] }
} }
export default component
