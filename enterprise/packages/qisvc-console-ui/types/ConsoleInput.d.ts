import type { DefineComponent } from 'vue'
import type { InputProps, InputSlots } from '@nuxt/ui'

export type ConsoleInputProps = Omit<InputProps<string | number>, 'modelValue' | 'modelModifiers'> & {
  modelValue?: string | number
  modelModifiers?: Record<string, boolean>
  'onUpdate:modelValue'?: (value: string | number) => void
}

declare const component: DefineComponent<ConsoleInputProps> & { new(): {
  $slots: InputSlots
  $emit: (event: 'update:modelValue', value: string | number) => void
} }
export default component
