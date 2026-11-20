import type { DefineComponent, PropType } from 'vue'
/* eslint-disable @typescript-eslint/no-explicit-any -- the shared table intentionally forwards host-defined rows, columns, and slots. */

type TableSlot = (props: any) => any
export type ConsoleDataTableSlots = {
  toolbar?: TableSlot
  selection?: (props: { selectedCount: number, clearSelection: () => void }) => any
  emptyActions?: TableSlot
  errorActions?: TableSlot
  [name: string]: TableSlot | undefined
}

type WithComponentContract<T, S> = T & { new(): {
  $slots: S
  $emit: {
    (event: 'update:page' | 'update:pageSize', value: number): void
    (event: 'update:selectedIds', value: Array<string | number>): void
    (event: 'retry'): void
  }
} }

declare const component: WithComponentContract<DefineComponent<{
  data: { type: PropType<any[]>; required: true }
  columns: { type: PropType<any[]>; required: true }
  loading: { type: BooleanConstructor; default: false }
  error: { type: PropType<string | boolean>; default: false }
  errorTitle: { type: StringConstructor; default: '列表加载失败' }
  errorDescription: { type: StringConstructor; default: '请检查连接后重新加载。' }
  selectable: { type: BooleanConstructor; default: false }
  selectedIds: { type: PropType<Array<string | number>>; default: () => Array<string | number> }
  selectableRow: { type: PropType<(row: any) => boolean> }
  showSequence: { type: BooleanConstructor; default: true }
  rowKey: { type: StringConstructor; default: 'id' }
  page: { type: NumberConstructor; default: 1 }
  pageSize: { type: NumberConstructor; default: 10 }
  total: NumberConstructor
  clientPagination: { type: BooleanConstructor; default: true }
  pagination: { type: BooleanConstructor; default: true }
  pageSizeItems: { type: PropType<number[]> }
  emptyIcon: StringConstructor
  emptyTitle: StringConstructor
  emptyDescription: StringConstructor
  minTableWidth: StringConstructor
}>, ConsoleDataTableSlots>
export default component
