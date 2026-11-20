import {fileURLToPath} from 'node:url'
import {globSync,readFileSync} from 'node:fs'
import {join} from 'node:path'

// Extension hosts can have a different Nuxt root. Bundle icons from this layer's own files as well.
const layerRoot=fileURLToPath(new URL('./',import.meta.url))
const frameworkIcons=new Set(['lucide:file', 'lucide:check','lucide:chevron-down','lucide:chevron-right','lucide:x','lucide:loader-circle'])
for(const file of globSync('app/**/*.{vue,ts}',{cwd:layerRoot})){
  for(const match of readFileSync(join(layerRoot,file),'utf8').matchAll(/(?:i-lucide-|lucide:)([a-z0-9]+(?:-[a-z0-9]+)*)/g)){
    frameworkIcons.add('lucide:'+match[1])
  }
}
export default defineNuxtConfig({
  extends:process.env.QICORE_APP_LAYER?[process.env.QICORE_APP_LAYER]:[],
  compatibilityDate:'2026-10-19', modules:['@nuxt/ui'], devtools:{enabled:false},
  css:[fileURLToPath(new URL('./app/assets/base.css',import.meta.url))], ui:{fonts:false}, colorMode:{preference:'light'},
  icon:{provider:'none',fallbackToApi:false,clientBundle:{scan:true,icons:[...frameworkIcons]}},
  runtimeConfig:{apiOrigin:'http://127.0.0.1:3401'},
  app:{head:{htmlAttrs:{lang:'zh-CN'}}},
  sourcemap:{server:false,client:false}
})
