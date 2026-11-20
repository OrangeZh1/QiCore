import type { DefineComponent, VNode } from 'vue'
import type { AvatarProps } from '@nuxt/ui'

export type ConsoleAvatarProps = Omit<AvatarProps, 'src'> & { src?: string | null; fallbackSrc?: string }
declare const component: DefineComponent<ConsoleAvatarProps> & { new(): {
  $slots: { default?: () => VNode[] }
} }
export default component
