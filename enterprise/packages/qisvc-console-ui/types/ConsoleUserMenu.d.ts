import type { DefineComponent, VNode } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'

export type ConsoleUserMenuProps = {
  name?: string
  avatarUrl?: string | null
  avatarFallbackSrc?: string
  items: DropdownMenuItem[] | DropdownMenuItem[][]
  disabled?: boolean
}
declare const component: DefineComponent<ConsoleUserMenuProps> & { new(): {
  $slots: { avatar?: (props: { name: string; avatarUrl?: string | null }) => VNode[] }
} }
export default component
