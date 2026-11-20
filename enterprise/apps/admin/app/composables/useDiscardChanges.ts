import {computed,ref} from 'vue'

export function createDiscardChanges(isBlocked:()=>boolean=()=>false){
 const open=ref(false),blocked=computed(isBlocked)
 let pending:(()=>void)|null=null
 let decision:((accepted:boolean)=>void)|null=null
 function request(action:()=>void){if(blocked.value||open.value)return;pending=action;open.value=true}
 function decide(action:()=>void){if(blocked.value||open.value)return Promise.resolve(false);return new Promise<boolean>(resolve=>{decision=resolve;request(action)})}
 function settle(value:boolean){const resolve=decision;decision=null;resolve?.(value)}
 function keep(){if(blocked.value)return;open.value=false;pending=null;settle(false)}
 function confirm(){if(blocked.value)return;const action=pending;pending=null;open.value=false;settle(true);action?.()}
 function dispose(){open.value=false;pending=null;settle(false)}
 return{open,blocked,request,decide,keep,confirm,dispose}
}
export function useDiscardChanges(isBlocked:()=>boolean=()=>false){
 const dialog=createDiscardChanges(isBlocked)
 onBeforeUnmount(dialog.dispose)
 return dialog
}
