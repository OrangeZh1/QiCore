<script setup lang="ts">
const props = withDefaults(defineProps<{
  page: number
  pageSize: number
  total: number
  pageSizeOptions?: number[]
  alwaysVisible?: boolean
}>(), {
  pageSizeOptions: () => [10, 20, 50, 100],
})

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const shouldPaginate = computed(() => props.pageSize > 0 && props.total > props.pageSize)
const pageSizeItems = computed(() => props.pageSizeOptions.map(value => ({ label: String(value), value })))

watch([totalPages, () => props.page], ([lastPage, currentPage]) => {
  if (currentPage > lastPage) emit('update:page', lastPage)
  else if (currentPage < 1) emit('update:page', 1)
}, { immediate: true })

function updatePageSize(value: unknown) {
  const next = Number(value)
  if (!Number.isInteger(next) || next < 1 || next === props.pageSize) return
  emit('update:pageSize', next)
  emit('update:page', 1)
}
</script>

<template>
  <nav v-if="alwaysVisible || shouldPaginate" class="qisvc-console-pagination flex flex-col gap-3 border-t border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-end" aria-label="列表分页">
    <span class="text-xs text-muted">共有 {{ total }} 条，每页显示</span>
    <USelect :model-value="pageSize" :items="pageSizeItems" value-key="value" size="sm" class="w-20" aria-label="每页显示条数" @update:model-value="updatePageSize" />
    <div class="flex items-center justify-end gap-2">
      <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-chevron-left" :disabled="page <= 1" @click="emit('update:page', page - 1)">上一页</UButton>
      <span class="grid min-w-9 place-items-center rounded-md border border-default bg-elevated px-2 py-1 text-sm font-medium text-highlighted" aria-current="page">{{ page }}</span>
      <span class="text-xs text-muted">/ {{ totalPages }}</span>
      <UButton color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-chevron-right" :disabled="page >= totalPages" @click="emit('update:page', page + 1)">下一页</UButton>
    </div>
  </nav>
</template>
