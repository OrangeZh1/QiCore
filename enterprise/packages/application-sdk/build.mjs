import {mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root=dirname(fileURLToPath(import.meta.url)),repo=resolve(root,'../..'),output=join(root,'dist');
// Only this package's generated output is replaced. Canonical sources stay in QiCore.
if(output!==join(repo,'packages/application-sdk/dist'))throw Error('SDK_OUTPUT_INVALID');
if(!process.argv.includes('--incremental'))await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
async function writeChanged(file,value){const bytes=Buffer.from(value);if(await readFile(file).then(previous=>previous.equals(bytes),()=>false))return;await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes)}
async function bundle(options){const result=await build({...options,write:false});for(const file of result.outputFiles)await writeChanged(file.path,file.contents)}
await bundle({stdin:{contents:"export * from './apps/api/src/license/native-release.ts';export * from './apps/api/src/applications/native-descriptor.ts';",resolveDir:repo},outfile:join(output,'contracts.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
const browser=['maintenance-client','customer-service','h5-routes','decoration-contract','decoration-links','decoration-framework','decoration-options','decoration-components','decoration-assets','decoration-reference','decoration-rich-text','consumer-auth-appearance','consumer-theme','member-level-progress'];
for(const name of browser)await bundle({entryPoints:[join(repo,'apps/api/src/core',name+'.mjs')],outfile:join(output,'browser',name+'.mjs'),bundle:true,platform:'browser',format:'esm',target:'es2022'});
await cp(join(repo,'apps/api/src/core/decoration-types.ts'),join(output,'browser/decoration-types.ts'));
const apiRequire=createRequire(join(repo,'apps/api/package.json'));
await rm(join(output,'development.mjs'),{force:true});
await writeChanged(join(output,'install.mjs'),await readFile(join(root,'install.mjs')));
await writeChanged(join(output,'package-tools.mjs'),await readFile(join(root,'package-tools.mjs')));
const declarations=spawnSync(process.execPath,[apiRequire.resolve('typescript/bin/tsc'),'--allowJs','--declaration','--emitDeclarationOnly','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--outDir',join(output,'browser'),...browser.map(name=>join(repo,'apps/api/src/core',name+'.mjs'))],{encoding:'utf8',windowsHide:true});
if(declarations.status!==0)throw Error(declarations.stdout||declarations.stderr||'SDK_DECLARATIONS_FAILED');
const serverSources=['applications/service.mjs','applications/registry.mjs','applications/consumer-profiles.mjs','core/errors.mjs','core/financial-records.mjs','core/decoration-contract.mjs','core/wallet.mjs','core/account-image.mjs','core/member-purchase-growth.mjs','core/consumer-lifecycle.mjs','core/member-management.mjs','core/member-benefits.mjs','core/transaction-errors.mjs','storage/providers.mjs'];
const serverDeclarations=spawnSync(process.execPath,[apiRequire.resolve('typescript/bin/tsc'),'--allowJs','--declaration','--emitDeclarationOnly','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--outDir',join(output,'server-types'),...[...serverSources,'core/standalone-benefit-catalog.mjs','core/standalone-benefit-records.mjs','core/tenant-decoration.mjs','core/decoration-state.mjs'].map(name=>join(repo,'apps/api/src',name))],{encoding:'utf8',windowsHide:true});
if(serverDeclarations.status!==0)throw Error(serverDeclarations.stdout||serverDeclarations.stderr||'SDK_SERVER_DECLARATIONS_FAILED');
await writeChanged(join(output,'server.d.mts'),serverSources.map(name=>"export * from './server-types/"+name+"';").join('\n')+"\nexport {validateDecoration} from './server-types/core/tenant-decoration.mjs';\nexport {currentDecorationState} from './server-types/core/decoration-state.mjs';\n");
// Implementations are supplied by createApplication(serverSdk), preserving the
// host's authorization state and shared transaction client. Never bundle a copy.
await writeChanged(join(output,'server.mjs'),"throw Error('QICORE_SERVER_HOST_REQUIRED: bundle this import as external and resolve it from serverSdk.api in createApplication');\n");
async function copySource(from,to){
 await mkdir(to,{recursive:true});
 const entries=await readdir(from,{withFileTypes:true});
 for(const name of await readdir(to))if(!entries.some(item=>item.name===name))await rm(join(to,name),{recursive:true,force:true});
 for(const item of entries){
  const source=join(from,item.name),target=join(to,item.name);
  if(item.isDirectory())await copySource(source,target);
  else if(item.isFile()){
   if(/\.(?:ts|mjs|vue|css|scss)$/.test(item.name)){
    let text=await readFile(source,'utf8');
    text=text.replace(/(['"])(?:\.\.\/)+api\/src\/core\/([^'"]+)\1/g,(_all,quote,name)=>quote+'@qicore/application-sdk/browser/'+name+quote);
    await writeChanged(target,text);
   }else await writeChanged(target,await readFile(source));
  }else throw Error('SDK_SOURCE_LINK_FORBIDDEN: '+relative(repo,source));
 }
}
for(const dir of ['components','composables','utils','assets','config'])await copySource(join(repo,'apps/admin/app',dir),join(output,'console/app',dir));
await writeChanged(join(output,'console/app/plugins/console-navigation.client.ts'),await readFile(join(repo,'apps/admin/app/plugins/console-navigation.client.ts')));
await writeChanged(join(output,'console/app/plugins/site-branding.server.ts'),await readFile(join(repo,'apps/admin/app/plugins/site-branding.server.ts')));
await writeChanged(join(output,'console/app/app.config.ts'),await readFile(join(repo,'apps/admin/app/app.config.ts')));
await mkdir(join(output,'console/app/layouts'),{recursive:true});
await writeChanged(join(output,'console/app/layouts/tenant.vue'),await readFile(join(repo,'apps/admin/app/layouts/tenant.vue')));
await mkdir(join(output,'console/app/middleware'),{recursive:true});
const middleware=await readFile(join(repo,'apps/admin/app/middleware/tenant-context.global.ts'),'utf8');
await writeChanged(join(output,'console/app/middleware/tenant-context.global.ts'),middleware);
await writeChanged(join(output,'console/app/middleware/00-console-navigation.global.ts'),await readFile(join(repo,'apps/admin/app/middleware/00-console-navigation.global.ts')));
await writeChanged(join(output,'console/application-pages.mjs'),await readFile(join(repo,'apps/api/src/applications/console-pages.mjs')));
await writeChanged(join(output,'console/console-routes.mjs'),(await readFile(join(root,'console-routes.mjs'),'utf8')).replace('../../apps/api/src/applications/console-pages.mjs','./application-pages.mjs'));
await writeChanged(join(output,'console/nuxt.config.ts'),"import {setupEnterpriseConsole} from './console-routes.mjs'\nexport default defineNuxtConfig({modules:[setupEnterpriseConsole],nitro:{compressPublicAssets:true},app:{pageTransition:{name:'page',mode:'out-in'},layoutTransition:{name:'page',mode:'out-in'}},components:[{path:'./app/components',pathPrefix:false}],imports:{dirs:['./app/composables'],transform:{include:[/application-sdk|qisvc-console-ui/]}}})\n");
await writeChanged(join(output,'console/development.css'),'@source "./app";\n@source "../../../qisvc-console-ui/components";\n');
await copySource(join(root,'client'),join(output,'client'));
await copySource(join(root,'templates'),join(output,'templates'));
console.log('Built public application contracts, console layer and client sources.');
