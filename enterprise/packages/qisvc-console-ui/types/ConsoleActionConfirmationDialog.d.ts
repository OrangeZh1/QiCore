import type { DefineComponent, PropType } from 'vue'

export type ConsoleActionConfirmationColor = 'error' | 'warning' | 'primary' | 'neutral'

type WithEmits<T> = T & { new(): { $emit: {
  (event: 'update:open', value: boolean): void
  (event: 'confirm'): void
} } }

declare const component: WithEmits<DefineComponent<{
  open: { type: PropType<boolean>; required: true }
  title: { type: PropType<string>; required: true }
  description: { type: PropType<string>; required: true }
  subject: { type: PropType<string>; default: string }
  confirmLabel: { type: PropType<string>; default: string }
  cancelLabel: { type: PropType<string>; default: string }
  icon: { type: PropType<string>; default: string }
  color: { type: PropType<ConsoleActionConfirmationColor>; default: ConsoleActionConfirmationColor }
  loading: { type: PropType<boolean>; default: boolean }
}>>

export default component
