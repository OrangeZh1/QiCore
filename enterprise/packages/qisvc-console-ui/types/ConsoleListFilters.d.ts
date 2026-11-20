import type { DefineComponent, VNode } from 'vue'

declare const component: DefineComponent & { new(): {
  $slots: { default?: () => VNode[]; search?: () => VNode[] }
} }
export default component
