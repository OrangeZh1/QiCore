import type {DefineComponent,VNode} from 'vue'
export type AuthorizationState='unlicensed'|'expired'|'suspended'|'active'|'unavailable'
declare const component: DefineComponent<{state:AuthorizationState;message?:string;expiresAt?:string|null;checkedAt?:string|null;loading?:boolean;feedback?:string;onRecheck?:()=>void}> & {new():{$slots:{actions?:()=>VNode[]}}}
export default component
