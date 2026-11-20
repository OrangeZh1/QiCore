import {runtimeConfig} from './runtime-config'
import {h5PagePath} from '@qicore/application-sdk/browser/h5-routes.mjs'

export function setupH5(){
 if(import.meta.env.UNI_PLATFORM!=='h5')return
 const runtime=runtimeConfig() as any,host=window as any,config=host.__uniConfig
 if(!config?.router)throw Error('H5 路由尚未初始化')
 config.router.routerBase=runtime.basePath
 for(const route of host.__uniRoutes||[]){const path=h5PagePath(route.path);if(!route.meta.isEntry)route.alias=path;const title=runtime.titles?.[path];if(title){route.meta.navigationBar ||= {};route.meta.navigationBar.titleText=title}}
 uni.addInterceptor('setNavigationBarTitle',{invoke(value:any){const title=value.title;value.title=title.endsWith(' · '+runtime.siteName)?title:title+' · '+runtime.siteName}})
 for(const method of ['navigateTo','redirectTo','reLaunch'])uni.addInterceptor(method,{invoke(value:any){if(value.url?.startsWith('/pages/')){const url=new URL(value.url,location.origin);url.searchParams.delete('application');value.url=h5PagePath(url.pathname)+url.search}}})
}
