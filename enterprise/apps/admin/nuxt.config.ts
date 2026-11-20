import {existsSync,globSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const frameworkClient=process.env.QICORE_FRAMEWORK_CLIENT_DIR||fileURLToPath(new URL('../client/dist/h5',import.meta.url))
// Dynamic menus and conditional buttons use the same offline icon bundle as literal template icons.
const sourceIcons=new Set<string>()
for(const dir of ['./app','../../packages/qisvc-console-ui/components']){
 const cwd=fileURLToPath(new URL(dir+'/',import.meta.url))
 for(const file of globSync('**/*.{vue,ts}',{cwd})){
  const text=readFileSync(join(cwd,file),'utf8')
  for(const match of text.matchAll(/(?:i-lucide-|lucide:)([a-z0-9]+(?:-[a-z0-9]+)*)/g)) sourceIcons.add('lucide:'+match[1])
 }
}
export default defineNuxtConfig({
 ...(process.env.QICORE_DEV_WORKSPACE?{vite:{server:{hmr:{clientPort:Number(process.env.QICORE_DEV_PUBLIC_PORT),path:'/__qicore_dev/core-hmr'}}}}:{}),
  modules:['@nuxt/ui'],ssr:true,compatibilityDate:'2026-10-07',devtools:{enabled:false},
  // Login responses must contain their final title before client hydration.
  routeRules:{'/admin/**':{ssr:true,headers:{'cache-control':'no-store, private'}},'/install':{ssr:true,headers:{'cache-control':'no-store, private','referrer-policy':'no-referrer'}},'/install/':{ssr:true,headers:{'cache-control':'no-store, private','referrer-policy':'no-referrer'}},'/decoration-preview/**':{ssr:true,headers:{'cache-control':'no-store, private','referrer-policy':'no-referrer'}},'/admin/materials':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/system-cache':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/scheduled-tasks':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/scheduled-tasks/**':{ssr:true,headers:{'cache-control':'no-store, private'}},'/**':{ssr:false},'/admin':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/authorization-preview':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/updates':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/administrators':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/data-security':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/environment':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/system-logs':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/roles':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/site':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/storage':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/tenants':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/saas-users':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/profile':{ssr:true,headers:{'cache-control':'no-store, private'}},'/admin/login':{ssr:true,headers:{'cache-control':'no-store, private'}},'/tenant/**':{ssr:true,headers:{'cache-control':'no-store, private'}},'/tenant/login':{ssr:true,headers:{'cache-control':'no-store, private'}},'/tenant':{ssr:true,headers:{'cache-control':'no-store, private'}}},
  css:['~/assets/main.css'],sourcemap:false,
  hooks:{'pages:extend':pages=>{
    function mountEnterprise(routes:typeof pages){
      for(let index=routes.length-1;index>=0;index--){
        const route=routes[index]!
        const file=route.file?.replaceAll('\\','/')||''
        if(/\/pages\/(?:admin|\[portal\])\//.test(file)||/^\/admin(?:\/|$)/.test(route.path)){
          routes.splice(index,1); continue
        }
        if(/^\/tenant(?:\/|$)/.test(route.path)){
          route.path=route.path.replace(/^\/tenant/,'/admin')
          if(typeof route.name==='string')route.name=route.name.replace(/^tenant(?=-|$)/,'admin')
        }
        if(route.children)mountEnterprise(route.children)
      }
    }
    mountEnterprise(pages)
  },'build:manifest':manifest=>{
    // Keep interaction-only chunks out of SSR resource hints. Vite still loads
    // their scripts and CSS when the corresponding async component is rendered.
    const deferred=new Set(['DecorationBlockContentPanel','DecorationBlockStylePanel','DecorationThemePanel','DecorationNavigationPanel','DecorationRichTextPreview','ConsoleRichTextEditor','MaterialBrowser'])
    for(const entry of Object.values(manifest))if(entry.name&&deferred.has(entry.name)){entry.preload=false;entry.prefetch=false}
  }},
  icon:{provider:'none',fallbackToApi:false,clientBundle:{scan:true,icons:[...sourceIcons,'lucide:headphones','lucide:panels-left-bottom','lucide:circle-help','lucide:globe','lucide:tags','lucide:circle','lucide:zoom-out','lucide:zoom-in','lucide:maximize','lucide:rotate-ccw','lucide:rotate-cw','lucide:images','lucide:folder','lucide:folder-open','lucide:upload','lucide:list','lucide:layout-grid','lucide:video','lucide:file-text','lucide:ellipsis','lucide:plus','lucide:trash-2','lucide:user-plus','lucide:search','lucide:chevron-left','lucide:chevron-right','lucide:check','lucide:triangle-alert','lucide:info','lucide:history','lucide:package','lucide:shield-question','lucide:calendar-clock','lucide:shield-ban','lucide:wifi-off','lucide:badge-check','lucide:award','lucide:contact','lucide:package-check','lucide:log-in','lucide:chart-no-axes-combined','lucide:activity','lucide:clock-3','lucide:x','lucide:layout-dashboard','lucide:building-2','lucide:monitor','lucide:refresh-cw','lucide:database','lucide:layers','lucide:server','lucide:credit-card','lucide:play','lucide:menu','lucide:panel-left-close','lucide:panel-left-open','lucide:loader-circle','lucide:circle-alert','lucide:inbox','lucide:settings','lucide:users','lucide:log-out','lucide:user-round','lucide:eye','lucide:eye-off','lucide:chevron-down','lucide:moon','lucide:sun','lucide:lock','lucide:lock-keyhole','lucide:shield-check','lucide:circle-check','lucide:flask-conical','lucide:external-link','lucide:chevron-up','lucide:list-ordered','lucide:arrow-right-left','lucide:receipt-text','lucide:wallet','lucide:banknote','lucide:message-circle','lucide:smartphone','lucide:waypoints','lucide:qr-code','lucide:layout-template','lucide:cloud-check','lucide:paintbrush','lucide:link','lucide:bookmark','lucide:palette','lucide:panel-bottom','lucide:undo-2','lucide:redo-2','lucide:arrow-left','lucide:mouse-pointer-2','lucide:panels-top-left','lucide:arrow-up-right','lucide:megaphone','lucide:image','lucide:image-plus','lucide:square-mouse-pointer','lucide:download','lucide:gallery-horizontal','lucide:move-vertical','lucide:minus','lucide:phone','lucide:grip-vertical','lucide:copy','lucide:house','lucide:signal','lucide:wifi','lucide:battery-full','lucide:pencil','lucide:scan','lucide:text-cursor-input','lucide:circle-dot','lucide:map-pin']}},
  fonts:{provider:'local',families:[]},
  nitro:{compressPublicAssets:true,externals:{inline:[/[/\\]apps[/\\]api[/\\]src[/\\]/]},serverAssets:[...(existsSync(frameworkClient)?[{baseName:'framework-h5',dir:frameworkClient}]:[]),...(process.env.QICORE_H5_ASSET_DIR?[{baseName:'h5',dir:process.env.QICORE_H5_ASSET_DIR}]:[])]},
  runtimeConfig:{apiInternalBase:'http://127.0.0.1:3501/api/v1',installSocket:'',public:{apiBase:'/api/v1',installationMode:false}},
  app:{pageTransition:{name:'page',mode:'out-in'},layoutTransition:{name:'page',mode:'out-in'},head:{title:'管理后台',htmlAttrs:{lang:'zh-CN'},meta:[{name:'robots',content:'noindex,nofollow'},{name:'theme-color',content:'#1d4ed8'}]}}
})
