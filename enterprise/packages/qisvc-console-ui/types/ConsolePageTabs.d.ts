import type {DefineComponent} from 'vue'
declare const component: DefineComponent<{items:{key:string;label:string;to:string;pinned?:boolean}[];active:string;onClose?:(key:string)=>void}>
export default component
