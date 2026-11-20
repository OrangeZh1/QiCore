/** Browser refresh/close must preserve the same draft guard as router navigation. */
export function useUnsavedBeforeUnload(hasUnsavedWork:()=>boolean){
 const guard=(event:BeforeUnloadEvent)=>{if(hasUnsavedWork()){event.preventDefault();event.returnValue=''}}
 onMounted(()=>window.addEventListener('beforeunload',guard))
 onBeforeUnmount(()=>window.removeEventListener('beforeunload',guard))
}
