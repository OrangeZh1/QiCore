<script setup lang="ts">
import { computed } from 'vue'
import ConsoleSidebarLink from './ConsoleSidebarLink.vue'

export interface ConsoleSidebarGroupItem {
  label: string
  icon: string
  to: string
  active?: boolean
  external?: boolean
}

const props = withDefaults(defineProps<{
  groupKey: string
  label: string
  icon: string
  items: ConsoleSidebarGroupItem[]
  open?: boolean
  collapsed?: boolean
}>(), {
  open: false,
  collapsed: false,
})

const emit = defineEmits<{ toggle: [key: string] }>()
const containsActiveItem = computed(() => props.items.some(item => item.active))
const submenuId = computed(() => `qisvc-console-sidebar-group-${props.groupKey}`)
const dropdownItems = computed(() => [props.items.map(item => ({
  label: item.label,
  icon: item.icon,
  to: item.external ? undefined : item.to,
  href: item.external ? item.to : undefined,
  target: item.external ? '_blank' : undefined,
  active: item.active,
  class: item.active ? 'rounded-md bg-elevated text-highlighted' : 'text-muted',
  'aria-current': item.active ? 'page' : undefined,
}))])
</script>

<template>
  <div v-if="collapsed" class="qisvc-console-sidebar-group-collapsed">
    <UDropdownMenu
      :items="dropdownItems"
      :content="{ side: 'right', align: 'start', sideOffset: 8 }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        square
        :icon="icon"
        :aria-label="label"
        :title="label"
        :ui="{ leadingIcon: 'qisvc-console-sidebar-group-icon' }"
        class="qisvc-console-sidebar-group-trigger qisvc-console-sidebar-control size-10"
        :data-active="containsActiveItem || undefined"
      />
    </UDropdownMenu>
  </div>

  <div v-else class="qisvc-console-sidebar-group">
    <button
      type="button"
      class="qisvc-console-sidebar-group-trigger group flex min-h-10 w-full items-center rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      :data-active="containsActiveItem || undefined"
      :data-open="open || undefined"
      :aria-expanded="open"
      :aria-controls="submenuId"
      @click="emit('toggle', groupKey)"
    >
      <UIcon :name="icon" class="qisvc-console-sidebar-group-icon shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <UIcon
        name="i-lucide-chevron-right"
        class="qisvc-console-sidebar-group-chevron size-4 shrink-0 transition duration-200"
        :class="open ? 'rotate-90' : ''"
      />
    </button>
    <div
      :id="submenuId"
      class="qisvc-console-sidebar-submenu-grid"
      :data-open="open || undefined"
      :aria-hidden="!open"
      :inert="!open"
    >
      <div class="qisvc-console-sidebar-submenu-viewport">
        <nav class="qisvc-console-sidebar-submenu" :aria-label="label">
          <ConsoleSidebarLink
            v-for="item in items"
            :key="item.to"
            :label="item.label"
            :icon="item.icon"
            :to="item.to"
            :active="item.active"
            :external="item.external"
            subitem
          />
        </nav>
      </div>
    </div>
  </div>
</template>
