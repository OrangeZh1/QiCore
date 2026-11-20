import type { DefineComponent, VNode } from 'vue'

export type ConsoleSettingsFieldProps = { label: string; inputId?: string }
declare const component: DefineComponent<ConsoleSettingsFieldProps> & { new(): {
  $slots: { default?: () => VNode[] }
} }
export default component
