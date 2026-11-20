import type { DefineComponent, PropType } from 'vue'

type WithEmits<T> = T & { new(): { $emit: {
  (event: 'update:page' | 'update:pageSize', value: number): void
} } }

declare const component: WithEmits<DefineComponent<{
  page: { type: NumberConstructor; required: true }
  pageSize: { type: NumberConstructor; required: true }
  total: { type: NumberConstructor; required: true }
  pageSizeOptions: { type: PropType<number[]>; default: () => number[] }
  alwaysVisible: { type: BooleanConstructor; required: false }
}>>

export default component
