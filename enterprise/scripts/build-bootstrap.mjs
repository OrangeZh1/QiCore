import {build} from 'esbuild';
import {cp,mkdir,readFile,readdir,lstat,writeFile,stat,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildBootstrapUi(output,buildDir){
 const admin=join(repo,'apps/admin'),adminRequire=createRequire(join(admin,'package.json'));
 const {loadNuxt,build}=await import(pathToFileURL(join(dirname(adminRequire.resolve('nuxt/package.json')),'dist/index.mjs')).href);
 const publicDir=join(buildDir,'public');await mkdir(join(publicDir,'brand'),{recursive:true});
 await cp(join(admin,'public/brand/qicore.png'),join(publicDir,'brand/qicore.png'));
 const nuxt=await loadNuxt({cwd:admin,dev:false,overrides:{buildDir:join(buildDir,'nuxt'),dir:{public:publicDir},nitro:{output:{dir:output}},hooks:{
  'pages:extend':pages=>{const install=pages.find(page=>page.path==='/install');if(!install)throw Error('BOOTSTRAP_INSTALL_PAGE_MISSING');pages.splice(0,pages.length,install)},
  'app:resolve':app=>{app.layouts={}},
  'nitro:config':config=>{config.serverAssets=(config.serverAssets||[]).filter(asset=>!['framework-h5','h5'].includes(asset.baseName))},
 }}});
 try{await build(nuxt)}finally{await nuxt.close()}
}
export async function buildBootstrap(output,runtime,copyRuntime){
 const root=join(output,'bootstrap');await mkdir(root);
 await build({entryPoints:[join(repo,'apps/api/dist/lifecycle/native-controller.js')],outfile:join(root,'controller.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:false,legalComments:'inline',external:['@prisma/client'],banner:{js:"import {createRequire as bootstrapRequire} from 'node:module';const require=bootstrapRequire(import.meta.url);"}});
 await build({entryPoints:[join(repo,'apps/api/dist/lifecycle/bootstrap-gateway-worker.js')],outfile:join(root,'bootstrap-gateway-worker.js'),bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:false,legalComments:'inline'});
 for(const [entry,name] of [['apps/api/dist/lifecycle/bootstrap-transition-check.js','transition-check.mjs'],['scripts/transition-bootstrap.mjs','transition.mjs']])await build({entryPoints:[join(repo,entry)],outfile:join(root,name),bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:false,external:['@prisma/client'],banner:{js:"import {createRequire as bootstrapRequire} from 'node:module';const require=bootstrapRequire(import.meta.url);"}});
 await cp(join(repo,'apps/api/dist/lifecycle/native-worker.js'),join(root,'native-worker.js'));await cp(join(repo,'scripts/native-start.mjs'),join(root,'start.mjs'));await cp(join(repo,'scripts/bootstrap-inventory.mjs'),join(root,'bootstrap-inventory.mjs'));
 for(const module of ['@prisma/client','.prisma/client'])await cp(join(runtime,'node_modules',module),join(root,'node_modules',module),{recursive:true});
 const uiBuild=join(output,'bootstrap-build');
 try{const ui=join(uiBuild,'output');await buildBootstrapUi(ui,join(uiBuild,'work'));await copyRuntime(ui,join(root,'ui'),'ui')}finally{if(dirname(resolve(uiBuild))!==resolve(output))throw Error('BOOTSTRAP_BUILD_PATH_INVALID');await rm(uiBuild,{recursive:true,force:true})}
 const product=JSON.parse(await readFile(join(repo,'config/license-product.json'),'utf8')),version=JSON.parse(await readFile(join(repo,'package.json'),'utf8')).version;
 await writeFile(join(root,'package.json'),JSON.stringify({name:'qicore-bootstrap',private:true,type:'module',version})+'\n');
 const example={native:{maintenancePort:3502,root:'/opt/qicore/code',stateRoot:'/var/lib/qicore/components',dataRoot:'/var/lib/qicore/data',socket:'/run/qicore/updater.sock',installationSocket:'/run/qicore/install.sock',frameworkKey:product.appKey,healthUrl:'http://127.0.0.1:3501/health',loginUrl:'http://127.0.0.1:3500/admin/login',runtimeUid:1001,runtimeGid:1001,environmentFile:'/www/server/nodejs-env/qicore/runtime.env',licenseStateRoot:'/var/lib/qicore/license',product:{...product,version},backupRoot:'/var/backups/qicore',backupKeyRoot:'/var/lib/qicore/backup-keys',mysqldump:'/usr/bin/mysqldump'},controlRoot:'/var/lib/qicore/installer',nativeConfigFile:'/www/server/nodejs-env/qicore/native.json',archive:'/var/lib/qicore/incoming/qicore-'+version+'-linux-x64.zip',releaseFile:'/var/lib/qicore/incoming/release.json',adminOrigin:'https://example.com',redisUrl:'redis://127.0.0.1:6379/0'};
 await writeFile(join(root,'bootstrap.example.json'),JSON.stringify(example,null,2)+'\n');
 const check=spawnSync(process.execPath,['--input-type=module','-e',"await import('./controller.mjs')"],{cwd:root,stdio:'inherit'});if(check.status!==0)throw Error('BOOTSTRAP_IMPORT_FAILED');
 const files=[];async function inventory(dir,prefix=''){for(const name of (await readdir(dir)).sort()){const path=join(dir,name),key=prefix+name,s=await lstat(path);if(s.isSymbolicLink())throw Error('BOOTSTRAP_LINK_REJECTED');if(s.isDirectory())await inventory(path,key+'/');else files.push({path:key,size:s.size,sha256:hash(await readFile(path))})}}await inventory(root);
 await writeFile(join(root,'bootstrap-manifest.json'),JSON.stringify({format:'qicore-bootstrap-v1',version,product:'qicore',packageKey:product.appKey,updatePlanCapability:'native-full-v3',applicationLifecycleCapability:'native-lifecycle-v2',initialReleaseFormat:'qicore-initial-release-v2',supportedReleaseFormats:['qicore-initial-release-v1','qicore-initial-release-v2','qicore-local-release-v1','qicore-local-release-v2','qilicense-release-v2'],files},null,2)+'\n');
 const archive=join(output,'qicore-bootstrap-'+version+'-linux-x64.zip'),zip=spawnSync('zip',['-q','-X','-9',archive,'-@'],{cwd:root,input:[...files.map(f=>f.path),'bootstrap-manifest.json'].join('\n')+'\n',stdio:['pipe','inherit','inherit']});if(zip.status!==0)throw Error('BOOTSTRAP_ARCHIVE_FAILED');
 const report={version,product:'qicore',packageKey:product.appKey,updatePlanCapability:'native-full-v3',applicationLifecycleCapability:'native-lifecycle-v2',initialReleaseFormat:'qicore-initial-release-v2',supportedReleaseFormats:['qicore-initial-release-v1','qicore-initial-release-v2','qicore-local-release-v1','qicore-local-release-v2','qilicense-release-v2'],files:files.length,expandedBytes:files.reduce((n,f)=>n+f.size,0),archive:archive.split('/').at(-1),archiveBytes:(await stat(archive)).size,sha256:hash(await readFile(archive)),manifestSha256:hash(await readFile(join(root,'bootstrap-manifest.json'))),signed:false,controllerOutsideVersions:true,installerUiOnly:true};await writeFile(join(output,'bootstrap-report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
