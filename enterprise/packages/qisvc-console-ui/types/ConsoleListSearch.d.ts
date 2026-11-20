import type { DefineComponent } from 'vue'
import type { ConsoleInputProps } from './ConsoleInput'

export type ConsoleListSearchProps = Omit<ConsoleInputProps, 'modelValue' | 'onUpdate:modelValue' | 'maxlength' | 'icon' | 'size'> & {
  modelValue?: string
  maxlength?: number | string
  'onUpdate:modelValue'?: (value: string) => void
}

declare const component: DefineComponent<ConsoleListSearchProps> & { new(): {
  $emit: (event: 'update:modelValue', value: string) => void
} }
export default component
