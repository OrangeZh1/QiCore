<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- Nuxt UI table rows, columns, and generated slot names are host-defined. */
import ConsoleEmptyState from './ConsoleEmptyState.vue'
import ConsoleErrorState from './ConsoleErrorState.vue'
import ConsoleLoadingState from './ConsoleLoadingState.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  data: any[]
  columns: any[]
  loading?: boolean
  error?: string | boolean
  errorTitle?: string
  errorDescription?: string
  selectable?: boolean
  selectableRow?: (row: any) => boolean
  showSequence?: boolean
  rowKey?: string
  page?: number
  pageSize?: number
  total?: number
  clientPagination?: boolean
  pagination?: boolean
  pageSizeItems?: number[]
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
  minTableWidth?: string
}>(), {
  loading: false,
  error: false,
  errorTitle: '列表加载失败',
  errorDescription: '请检查连接后重新加载。',
  selectable: false,
  selectableRow: () => true,
  showSequence: true,
  rowKey: 'id',
  page: 1,
  pageSize: 20,
  total: undefined,
  clientPagination: true,
  pagination: true,
  pageSizeItems: () => [10, 20, 50, 100],
  emptyIcon: 'i-lucide-inbox',
  emptyTitle: '暂无数据',
  emptyDescription: '符合条件的数据会显示在这里。',
  minTableWidth: '760px',
})

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
  retry: []
}>()
const selectedIds = defineModel<Array<string | number>>('selectedIds', { default: () => [] })
const slots = defineSlots<{
  toolbar?: (props: Record<string, never>) => any
  selection?: (props: { selectedCount: number, clearSelection: () => void }) => any
  emptyActions?: (props: Record<string, never>) => any
  errorActions?: (props: Record<string, never>) => any
  [name: string]: ((props: any) => any) | undefined
}>()
const internalPage = ref(props.page)
const internalPageSize = ref(props.pageSize)

watch(() => props.page, value => { internalPage.value = value })
watch(() => props.pageSize, value => { internalPageSize.value = value })

const resolvedTotal = computed(() => props.total ?? props.data.length)
const totalPages = computed(() => Math.max(1, Math.ceil(resolvedTotal.value / internalPageSize.value)))
const visibleData = computed(() => props.clientPagination
  ? props.data.slice((internalPage.value - 1) * internalPageSize.value, internalPage.value * internalPageSize.value)
  : props.data)
const rangeStart = computed(() => resolvedTotal.value ? (internalPage.value - 1) * internalPageSize.value + 1 : 0)
const rangeEnd = computed(() => Math.min(internalPage.value * internalPageSize.value, resolvedTotal.value))
const pageSizeOptions = computed(() => props.pageSizeItems.map(value => ({ label: `${value} 条/页`, value })))
const forwardedSlotNames = computed(() => Object.keys(slots).filter(name => !['toolbar', 'selection', 'emptyActions', 'errorActions'].includes(name)))
const normalizedColumns = computed(() => props.columns.map((column) => {
  if (column.id !== 'actions') return column
  const meta = column.meta ?? {}
  const classes = meta.class ?? {}
  return {
    ...column,
    meta: {
      ...meta,
      class: {
        ...classes,
        th: [classes.th, 'qisvc-data-table-actions'],
        td: [classes.td, 'qisvc-data-table-actions'],
      },
    },
  }
}))
const displayColumns = computed(() => [
  ...normalizedColumns.value.filter(column => column.id === 'select'),
  ...(props.selectable && !normalizedColumns.value.some(column => column.id === 'select') ? [{ id: 'select', header: '', meta: { class: { th: 'qisvc-data-table-select', td: 'qisvc-data-table-select' } } }] : []),
  ...(props.showSequence ? [{ id: 'sequence', header: '序号', meta: { class: { th: 'qisvc-data-table-sequence', td: 'qisvc-data-table-sequence' } } }] : []),
  ...normalizedColumns.value.filter(column => column.id !== 'select'),
])
const pageIds = computed<Array<string | number>>(() => visibleData.value.filter(row => props.selectableRow(row)).map(row => row[props.rowKey]))
const pageSelectedCount = computed(() => pageIds.value.filter(id => selectedIds.value.includes(id)).length)
const pageSelectionState = computed<boolean | 'indeterminate'>(() => {
  if (!pageIds.value.length || pageSelectedCount.value === 0) return false
  return pageSelectedCount.value === pageIds.value.length ? true : 'indeterminate'
})

watch([() => props.data.length, resolvedTotal, () => props.loading], () => {
  if (!props.loading && internalPage.value > totalPages.value) setPage(totalPages.value)
})

function setPage(value: number) {
  internalPage.value = value
  emit('update:page', value)
}
function setPageSize(value: number) {
  internalPageSize.value = value
  emit('update:pageSize', value)
  setPage(1)
}
function setPageSelected(value: boolean) {
  selectedIds.value = value
    ? [...new Set([...selectedIds.value, ...pageIds.value])]
    : selectedIds.value.filter(id => !pageIds.value.includes(id))
}
function setRowSelected(id: string | number, value: boolean) {
  selectedIds.value = value
    ? selectedIds.value.includes(id) ? selectedIds.value : [...selectedIds.value, id]
    : selectedIds.value.filter(selectedId => selectedId !== id)
}
function clearSelection() { selectedIds.value = [] }
</script>

<template>
  <section class="qisvc-data-table qisvc-surface-card surface-card min-w-0" v-bind="$attrs">
    <div v-if="$slots.toolbar" class="flex min-h-16 flex-col gap-3 border-b border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <slot name="toolbar" />
    </div>

    <div v-if="selectable && selectedIds.length" class="flex min-h-14 flex-col gap-3 border-b border-default bg-elevated/25 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <slot name="selection" :selected-count="selectedIds.length" :clear-selection="clearSelection">
        <span class="text-sm text-muted">已选择 <strong class="text-highlighted">{{ selectedIds.length }}</strong> 项</span>
        <UButton class="rounded-md sm:ml-auto" size="sm" color="neutral" variant="outline" @click="clearSelection">取消选择</UButton>
      </slot>
    </div>

    <ConsoleLoadingState v-if="loading" label="正在载入列表…" />
    <ConsoleErrorState v-else-if="error" :title="errorTitle" :description="typeof error === 'string' ? error : errorDescription">
      <template #actions>
        <slot name="errorActions"><UButton class="rounded-md" size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="emit('retry')">重新加载</UButton></slot>
      </template>
    </ConsoleErrorState>
    <UTable
      v-else-if="data.length"
      :data="visibleData"
      :columns="displayColumns"
      :ui="{
        root: 'w-full min-w-0 overflow-x-auto overscroll-x-contain',
        base: 'w-max min-w-full table-auto',
        thead: 'bg-elevated/45',
        th: 'h-11 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted first:pl-5',
        td: 'px-4 py-2 align-middle text-sm first:pl-5',
        tr: 'border-b border-default last:border-b-0 hover:bg-elevated/45',
      }"
    >
      <template v-if="selectable" #select-header><UCheckbox size="sm" :ui="{ base: 'rounded-[3px]' }" :model-value="pageSelectionState" aria-label="选择当前页" @update:model-value="setPageSelected($event === true)" /></template>
      <template v-if="selectable" #select-cell="{ row }"><UCheckbox v-if="selectableRow(row.original)" size="sm" :ui="{ base: 'rounded-[3px]' }" :model-value="selectedIds.includes(row.original[rowKey])" :aria-label="`选择第 ${((internalPage - 1) * internalPageSize) + row.index + 1} 行`" @click.stop @update:model-value="setRowSelected(row.original[rowKey], $event === true)" /><span v-else class="inline-grid size-5 place-items-center text-dimmed" role="img" aria-label="此行不可选择"><UIcon name="i-lucide-lock" class="size-3.5" /></span></template>
      <template v-if="showSequence" #sequence-cell="{ row }"><span class="tabular-nums text-muted">{{ ((internalPage - 1) * internalPageSize) + row.index + 1 }}</span></template>
      <template v-for="slotName in forwardedSlotNames" #[slotName]="slotProps" :key="slotName">
        <div v-if="slotName === 'actions-cell'" class="qisvc-data-table-action-group">
          <slot :name="slotName" v-bind="slotProps" />
        </div>
        <slot v-else :name="slotName" v-bind="slotProps" />
      </template>
    </UTable>
    <ConsoleEmptyState v-else compact class="min-h-52 justify-center" :title="emptyTitle" :description="emptyDescription" :icon="emptyIcon"><template v-if="$slots.emptyActions" #actions><slot name="emptyActions" /></template></ConsoleEmptyState>

    <footer v-if="pagination && !loading && !error && resolvedTotal" class="flex flex-col gap-3 border-t border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p class="text-xs tabular-nums text-muted">显示 {{ rangeStart }}–{{ rangeEnd }} 条，共 {{ resolvedTotal }} 条</p>
      <div class="flex items-center gap-2">
        <USelect :model-value="internalPageSize" :items="pageSizeOptions" value-key="value" class="w-28" size="sm" @update:model-value="setPageSize(Number($event))" />
        <UButton class="rounded-md" color="neutral" variant="outline" size="sm" icon="i-lucide-chevron-left" :disabled="internalPage <= 1" aria-label="上一页" @click="setPage(internalPage - 1)" />
        <span class="min-w-16 text-center text-xs tabular-nums text-muted">{{ internalPage }} / {{ totalPages }}</span>
        <UButton class="rounded-md" color="neutral" variant="outline" size="sm" icon="i-lucide-chevron-right" :disabled="internalPage >= totalPages" aria-label="下一页" @click="setPage(internalPage + 1)" />
      </div>
    </footer>
  </section>
</template>

<style scoped>
:deep(table[data-slot='base']) {
  min-width: max(100%, v-bind(minTableWidth));
}
</style>
