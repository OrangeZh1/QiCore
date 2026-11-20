<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import ConsoleAvatar from './ConsoleAvatar.vue'

withDefaults(defineProps<{
  name?: string
  avatarUrl?: string | null
  avatarFallbackSrc?: string
  items: DropdownMenuItem[] | DropdownMenuItem[][]
  disabled?: boolean
}>(), { name: '用户', disabled: false })
</script>

<template>
  <UDropdownMenu :items="items" size="sm" :content="{ align: 'end', side: 'bottom', sideOffset: 6 }" :disabled="disabled" :ui="{ content: 'w-36 min-w-36 rounded-lg', item: 'min-h-7 items-center px-2 py-1.5 text-xs gap-2', itemLeadingIcon: 'size-3.5', itemTrailingIcon: 'size-3.5' }" class="qisvc-console-user-menu">
    <UButton color="neutral" variant="ghost" :disabled="disabled" :aria-label="name + '用户菜单'" class="qisvc-console-account-trigger min-w-0 gap-2">
      <slot name="avatar" v-bind="{ name, avatarUrl }">
        <ConsoleAvatar :src="avatarUrl" :fallback-src="avatarFallbackSrc" :alt="name" size="sm" class="qisvc-console-account-avatar shrink-0" />
      </slot>
      <span class="qisvc-console-account-name min-w-0 truncate text-xs">{{ name }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-3.5 shrink-0" />
    </UButton>
  </UDropdownMenu>
</template>

<style scoped>
.qisvc-console-account-name { flex: 0 1 auto; max-width: 10rem; }
.qisvc-console-account-avatar { width: 1.75rem; height: 1.75rem; font-size: .6875rem; }
.qisvc-console-account-trigger { transition: background-color 160ms ease, color 160ms ease, transform 160ms ease; }
.qisvc-console-account-trigger:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) {
  .qisvc-console-account-trigger { transition: none; }
  .qisvc-console-account-trigger:active { transform: none; }
}
</style>
