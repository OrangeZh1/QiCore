import type { DefineComponent } from 'vue'
import type { ButtonProps } from '@nuxt/ui'

// Visual sizing is fixed; standard DOM/button attributes and disabled are forwarded.
declare const component: DefineComponent<Pick<ButtonProps, 'disabled' | 'class'>>
export default component
