<!-- Reused from school-shop AreaSidebarGroup; shared console primitives are unchanged. -->
<script setup lang="ts">
import ConsoleSidebarLink from '@orangezh1/qisvc-console-ui/components/ConsoleSidebarLink'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ConsoleMenuItem } from '../../utils/console-navigation'

const props = defineProps<{ groupKey: string; label: string; icon: string; items: readonly ConsoleMenuItem[]; openGroups: string[]; collapsed?: boolean }>()
const emit = defineEmits<{ toggle: [key: string] }>()
const open = computed(() => props.openGroups.includes(props.groupKey))
const submenuId = computed(() => `zjz-sidebar-${props.groupKey}`)
function dropdown(items: readonly ConsoleMenuItem[]): DropdownMenuItem[] {
  return items.map(item => 'children' in item
    ? { label: item.label, icon: item.icon, children: dropdown(item.children) }
    : { label: item.label, icon: item.icon, to: item.to, active: item.active, prefetchOn: { visibility: false, interaction: true } })
}
const dropdownItems = computed(() => dropdown(props.items))
</script>

<template>
  <div v-if="collapsed" class="qisvc-console-sidebar-group-collapsed">
    <UDropdownMenu :items="dropdownItems" :content="{ side: 'right', align: 'start', sideOffset: 8 }">
      <UButton color="neutral" variant="ghost" square :icon="icon" :aria-label="label" :title="label"
        :ui="{ leadingIcon: 'qisvc-console-sidebar-group-icon' }"
        class="qisvc-console-sidebar-group-trigger qisvc-console-sidebar-control size-10" />
    </UDropdownMenu>
  </div>
  <div v-else class="qisvc-console-sidebar-group">
    <button type="button" class="qisvc-console-sidebar-group-trigger group flex min-h-10 w-full items-center rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      :data-open="open || undefined" :aria-expanded="open" :aria-controls="submenuId" @click="emit('toggle', groupKey)">
      <UIcon :name="icon" class="qisvc-console-sidebar-group-icon shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <UIcon name="i-lucide-chevron-right" class="qisvc-console-sidebar-group-chevron size-4 shrink-0 transition duration-200" :class="open ? 'rotate-90' : ''" />
    </button>
    <div :id="submenuId" class="qisvc-console-sidebar-submenu-grid" :data-open="open || undefined" :aria-hidden="!open" :inert="!open">
      <div class="qisvc-console-sidebar-submenu-viewport">
        <nav class="qisvc-console-sidebar-submenu" :aria-label="label">
          <template v-for="item in items" :key="'children' in item ? item.key : item.to">
            <AreaSidebarGroup v-if="'children' in item" :group-key="item.key" :label="item.label" :icon="item.icon"
              :items="item.children" :open-groups="openGroups" @toggle="emit('toggle', $event)" />
            <ConsoleSidebarLink v-else :label="item.label" :icon="item.icon" :to="item.to" :active="item.active" subitem />
          </template>
        </nav>
      </div>
    </div>
  </div>
</template>
