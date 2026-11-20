import type {InjectionKey} from 'vue'
export type ConsolePageContext={owner:symbol|null;refresh:(()=>void)|null;refreshing:boolean}
export const consolePageKey:InjectionKey<ConsolePageContext>=Symbol('console-page')
