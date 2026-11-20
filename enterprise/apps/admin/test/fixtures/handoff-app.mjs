import {mkdir,writeFile,readFile,readdir,cp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
export async function buildHandoffApplication(state){
 const source=join(state,'source'),buildRoot=join(state,'build'),output=join(state,'application');
 await mkdir(join(source,'app/pages/tenant'),{recursive:true});
 const routes=[{path:'/tenant/handoff-summary',label:'应用概览',permission:'overview.read',group:'workbench',icon:'i-lucide-layout-dashboard'},{path:'/tenant/handoff-records',label:'应用记录',permission:'records.read',group:'production',icon:'i-lucide-history'}];
 const descriptor={format:'qicore-application-v1',key:'handoff-app',packageKey:'app_handoff',version:'1.0.0',name:'独立控制台验收应用',pendingTasks:[],web:{admin:{entrypoint:'web/admin/server/index.mjs',publicDir:'web/admin/public',routes}}};
 const icons=[...new Set([...(await readFile(join(root,'apps/admin/nuxt.config.ts'),'utf8')).matchAll(/'lucide:([a-z0-9-]+)'/g)].map(match=>'lucide:'+match[1]))];
 await writeFile(join(source,'package.json'),JSON.stringify({name:'qicore-handoff-fixture',type:'module',private:true}));
 const base='/application-assets/handoff-app/1.0.0/admin/';
 await writeFile(join(source,'nuxt.config.ts'),`export default defineNuxtConfig({workspaceDir:${JSON.stringify(join(root,'apps/admin'))},extends:[${JSON.stringify(join(root,'packages/application-sdk/dist/console'))}],modules:['@nuxt/ui'],modulesDir:[${JSON.stringify(join(root,'apps/admin/node_modules'))}],ssr:true,compatibilityDate:'2026-10-07',devtools:{enabled:false},css:[${JSON.stringify(join(root,'apps/admin/app/assets/main.css'))}],fonts:{provider:'local',families:[]},icon:{provider:'none',fallbackToApi:false,clientBundle:{scan:true,icons:${JSON.stringify(icons)}}},runtimeConfig:{apiInternalBase:'http://127.0.0.1:3501/api/v1',public:{apiBase:'/api/v1',nativeApplication:{key:'handoff-app',routes:${JSON.stringify(routes.map(r=>r.path))}}}},app:{buildAssetsDir:${JSON.stringify(base+'_nuxt/')}},buildDir:${JSON.stringify(join(state,'nuxt'))},nitro:{preset:'node',serveStatic:false,output:{dir:${JSON.stringify(buildRoot)}},rollupConfig:{plugins:[{name:'preserve-host-fetch',transform(code,id){if(id.replaceAll('\\\\','/').endsWith('/runtime/internal/app.mjs')&&code.includes('globalThis.$fetch = $fetch;'))return code.replace('globalThis.$fetch = $fetch;','globalThis.$fetch ??= $fetch;')}}]}}})`);
 await writeFile(join(source,'app/app.vue'),`<script setup lang="ts">
const route=useRoute(),branding=useSiteBranding(),context=useTenantContext()
const tenantPageKey=(target)=>[context.tenantId.value,target.path].join(':')
if(!branding.site.value)await branding.load()
const labels=${JSON.stringify(Object.fromEntries(routes.map(r=>[r.path,r.label])))}
useHead(()=>({title:(labels[route.path]||'应用')+' · 租户后台 · '+branding.resolvedSite.value!.tenant.name,link:[{rel:'icon',href:branding.resolvedSite.value!.tenant.favicon||'/brand/qicore.png'}]}))
</script><template><UApp><NuxtLayout><NuxtPage :page-key="tenantPageKey"/></NuxtLayout></UApp></template>`);
 for(const route of routes)await writeFile(join(source,'app/pages/tenant',route.path.split('/').at(-1)+'.vue'),`<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
definePageMeta({layout:'tenant'})
const auth=useApi('tenant'),id=useTenantContext().tenantId.value
const {data,error}=await useAsyncData(${JSON.stringify(route.path)}+':'+id,()=>auth.api<{message:string}>('/admin/tenants/'+id+'/handoff-data'))
</script><template><AdminConsole><ConsolePageHeading title="${route.label}"/><p v-if="error" role="alert">{{error.message}}</p><p v-else data-testid="application-data">{{data?.message}}</p></AdminConsole></template>`);
 const require=createRequire(join(root,'apps/admin/package.json'));
 const {loadNuxt,build}=await import(pathToFileURL(join(dirname(require.resolve('nuxt/package.json')),'dist/index.mjs')));
 const nuxt=await loadNuxt({cwd:source,dev:false});try{await build(nuxt)}finally{await nuxt.close()}
 await mkdir(join(output,'web/admin'),{recursive:true});await cp(join(buildRoot,'server'),join(output,'web/admin/server'),{recursive:true,dereference:true});
 await cp(join(buildRoot,'public',base),join(output,'web/admin/public'),{recursive:true});
 // The fixture follows the standalone renderer adapter: its import.meta shim
 // must never replace the host renderer's process-global entry URL.
 async function isolate(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await isolate(path);else if(/\.[cm]?js$/.test(entry.name)){const text=await readFile(path,'utf8');if(text.includes('globalThis._importMeta_'))await writeFile(path,text.replaceAll('globalThis._importMeta_','globalThis[Symbol.for("qicore.application-meta:handoff-fixture")]'))}}}
 await isolate(join(output,'web/admin/server'));await writeFile(join(output,'application.json'),JSON.stringify(descriptor,null,2));
 return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(await buildHandoffApplication(resolve(process.argv[2])));
