export type ConsoleNavigationTarget={path:string;fullPath:string;portal:'admin'|'tenant';document:boolean;error:string}

export function useConsoleNavigation(){
 const target=useState<ConsoleNavigationTarget|null>('console-navigation',()=>null),route=useRoute()
 return{target,path:computed(()=>target.value?.path||route.path)}
}
