<script setup lang="ts">
export type ConsoleActionConfirmationColor = 'error' | 'warning' | 'primary' | 'neutral'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  subject?: string
  confirmLabel?: string
  cancelLabel?: string
  icon?: string
  color?: ConsoleActionConfirmationColor
  loading?: boolean
}>(), {
  subject: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  icon: 'i-lucide-triangle-alert',
  color: 'error',
  loading: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const iconClass = computed(() => ({
  error: 'bg-error/10 text-error',
  warning: 'bg-warning/10 text-warning',
  primary: 'bg-primary/10 text-primary',
  neutral: 'bg-elevated text-muted',
})[props.color])
</script>

<template>
  <UModal
    :open="open"
    :dismissible="!loading"
    :close="false"
    :title="title"
    :description="description"
    :ui="{
      overlay: 'qisvc-dialog-overlay qisvc-action-confirmation-overlay',
      content: 'qisvc-action-confirmation-content',
      header: 'sr-only',
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <section aria-live="polite">
        <div class="grid size-11 place-items-center rounded-lg" :class="iconClass">
          <UIcon :name="icon" class="size-5" aria-hidden="true" />
        </div>
        <h2 class="mt-5 text-lg font-semibold text-highlighted sm:text-xl">{{ title }}</h2>
        <p class="mt-2 text-sm leading-6 text-muted">{{ description }}</p>
        <div v-if="subject" class="mt-4 break-words rounded-lg border border-default bg-elevated/50 px-3.5 py-3 text-sm font-medium text-highlighted">
          {{ subject }}
        </div>
      </section>
    </template>
    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton class="justify-center sm:min-w-24" color="neutral" variant="outline" :disabled="loading" @click="emit('update:open', false)">
          {{ cancelLabel }}
        </UButton>
        <UButton class="justify-center sm:min-w-24" :color="color" :icon="icon" :loading="loading" @click="emit('confirm')">
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
