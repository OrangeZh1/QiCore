import {defineAsyncComponent,h,type AsyncComponentLoader,type Component} from 'vue'
import ConsoleAsyncState from '../console-ui/ConsoleAsyncState.vue'

/** Loading failures leave the owner and its save action intact. */
export function defineConsoleAsyncComponent<T extends Component>(loader:AsyncComponentLoader<T>,label:string):T{
 return defineAsyncComponent({loader,suspensible:false,delay:150,timeout:30000,
  loadingComponent:()=>h(ConsoleAsyncState,{label}),
  errorComponent:()=>h(ConsoleAsyncState,{label,failed:true})
 })
}
