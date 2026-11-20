import {readFile,lstat,realpath} from 'node:fs/promises'
import {isAbsolute,resolve,relative,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {componentDescriptorSchema,applicationWebSchema} from '../../../api/src/applications/native-descriptor'
import {canonicalConsoleRoutes} from '../../../api/src/applications/console-pages.mjs'
import {standaloneWebComponents} from '../../../api/src/applications/standalone-web-inventory.mjs'
import {developmentWorkspace,assertDevelopmentApplicationIdentity} from '../../../api/src/applications/development-workspace.mjs'

type WebApp={key:string;applicationKey?:string;version:string;root:string;web:ReturnType<typeof applicationWebSchema.parse>;adminOrigin?:string;h5Origin?:string}
function canonicalInventory(apps:WebApp[]) {
  const paths = new Set<string>()
  return apps.map(app => {
    if (!app.web.admin) return app
    const routes = canonicalConsoleRoutes(app.web.admin.routes)
    for (const route of routes) {
      if (paths.has(route.path)) throw Error('APPLICATION_WEB_ROUTE_CONFLICT')
      paths.add(route.path)
    }
    return {...app,web:{...app.web,admin:{...app.web.admin,routes}}}
  })
}
let inventory:Promise<WebApp[]>|undefined
export async function installedWebApplications(){
  const development=developmentWorkspace();
  if(development)return canonicalInventory(await Promise.all(development.applications.map(async(app:any)=>{const descriptor=componentDescriptorSchema.parse(JSON.parse(await readFile(await applicationWebFile(app.path,'application.json'),'utf8')));assertDevelopmentApplicationIdentity(app,descriptor);return{key:app.key,...descriptor.format==='qicore-plugin-v1'?{applicationKey:descriptor.applicationKey}:{},version:app.version,root:app.path,web:descriptor.web||{},adminOrigin:app.adminOrigin,h5Origin:app.h5Origin}})));
 return inventory??=(async()=>{
  const raw=standaloneWebComponents(),apps:WebApp[]=[],identities=new Set<string>()
  for(const [packageKey,component] of Object.entries(raw) as [string,any][]){
   if(component.type==='framework')continue
   if(!['app','plugin'].includes(component.type)||!isAbsolute(component.path)||!/^\d+\.\d+\.\d+$/.test(component.version))throw Error('APPLICATION_WEB_INVENTORY_INVALID')
   if((await lstat(component.path)).isSymbolicLink())throw Error('APPLICATION_WEB_LINK_FORBIDDEN')
   const root=await realpath(component.path),descriptor=componentDescriptorSchema.parse(JSON.parse((await readFile(await applicationWebFile(root,'application.json'))).toString()))
   if(descriptor.packageKey!==packageKey||descriptor.version!==component.version)throw Error('APPLICATION_WEB_IDENTITY_MISMATCH')
   if(identities.has(descriptor.key))throw Error('APPLICATION_WEB_IDENTITY_CONFLICT');identities.add(descriptor.key)
   if(!descriptor.web)continue
   apps.push({key:descriptor.key,...descriptor.format==='qicore-plugin-v1'?{applicationKey:descriptor.applicationKey}:{},version:descriptor.version,root,web:descriptor.web})
  }
  return canonicalInventory(apps)
 })()
}
export async function applicationWebFile(root:string,path:string){
 if(!path||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..')||!/^[-\w@+./]+$/.test(path))throw Error('APPLICATION_WEB_PATH_INVALID')
 const file=resolve(root,path),rel=relative(root,file);if(rel.startsWith('..')||isAbsolute(rel))throw Error('APPLICATION_WEB_PATH_INVALID')
 let current=root
 for(const part of rel.split(sep)){current=resolve(current,part);if((await lstat(current)).isSymbolicLink())throw Error('APPLICATION_WEB_LINK_FORBIDDEN')}
 if(!(await lstat(file)).isFile())throw Error('APPLICATION_WEB_FILE_INVALID')
 return file
}
const renderers=new Map<string,Promise<any>>()
export async function applicationRenderer(app:WebApp){
 if(!app.web.admin)throw Error('APPLICATION_WEB_RENDERER_MISSING')
 let renderer=renderers.get(app.key)
 if(!renderer){renderer=applicationWebFile(app.root,app.web.admin.entrypoint).then(file=>import(/* @vite-ignore */ pathToFileURL(file).href)).then(module=>{if(typeof module.handler!=='function')throw Error('APPLICATION_WEB_RENDERER_INVALID');return module.handler});renderers.set(app.key,renderer)}
 return renderer
}
