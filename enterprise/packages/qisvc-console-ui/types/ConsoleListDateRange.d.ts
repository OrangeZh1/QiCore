import type { DefineComponent } from 'vue'

export type ConsoleListDateRangeProps = {
  label: string
  disabled?: boolean
  start?: string
  end?: string
  'onUpdate:start'?: (value: string) => void
  'onUpdate:end'?: (value: string) => void
}

declare const component: DefineComponent<ConsoleListDateRangeProps> & { new(): {
  $emit: (event: 'update:start' | 'update:end', value: string) => void
} }
export default component
