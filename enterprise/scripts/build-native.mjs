import {cp,mkdir,mkdtemp,readFile,readdir,lstat,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {resolve,join,relative,dirname,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../apps/api/dist/license/contracts.js';
import {nativeArchiveManifestSchema,nativePathSchema} from '../apps/api/dist/license/native-release.js';
import {buildBootstrap} from './build-bootstrap.mjs';
import {assertNativePrismaLayout,nativeDependencyOmission} from './native-runtime-policy.mjs';
import {nativeBuildOptions,assertNativeBuildTarget,materializeNativeBuildMigrations} from './native-build-target.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,args,cwd,env=process.env,input){const result=spawnSync(command,args,{cwd,env,input,encoding:'utf8',stdio:input?['pipe','inherit','inherit']:'inherit'});if(result.status!==0)throw Error('PACKAGE_COMMAND_FAILED: '+command)}

// Only runtime dependencies are installed into staging; the customer's host never installs or compiles.
export async function buildNative(output,options={}){
 if(process.platform!=='linux'||process.arch!=='x64'||process.versions.node.split('.')[0]!=='24')throw Error('BUILD_REQUIRES_LINUX_X64_NODE24');
 output=resolve(output);const outputRelative=relative(repo,output);if(outputRelative!=='..'&&!outputRelative.startsWith('..'+sep)&&!isAbsolute(outputRelative))throw Error('OUTPUT_MUST_BE_OUTSIDE_SOURCE');
 await mkdir(output);const scratch=await mkdtemp(join(tmpdir(),'qicore-package-')),tree=join(output,'runtime');
 try{
  const source=join(scratch,'source'),deployed=join(scratch,'api');
  for(const file of ['package.json','pnpm-workspace.yaml','pnpm-lock.yaml','apps/api/package.json','apps/api/prisma/schema.prisma']){
   await mkdir(dirname(join(source,file)),{recursive:true});await cp(join(repo,file),join(source,file));
  }
  // pnpm validates workspace patch hashes even when deployment prunes a dependency.
  await cp(join(repo,'patches'),join(source,'patches'),{recursive:true});
  // Modern pnpm deploy prunes the workspace lock to this service. Enable its required layout only in staging.
  await writeFile(join(source,'pnpm-workspace.yaml'),(await readFile(join(source,'pnpm-workspace.yaml'),'utf8'))+'\ninjectWorkspacePackages: true\n');
  await writeFile(join(source,'pnpm-lock.yaml'),(await readFile(join(source,'pnpm-lock.yaml'),'utf8')).replace('settings:\n','settings:\n  injectWorkspacePackages: true\n'));
  run('pnpm',['--filter','@qicore/api','--config.node-linker=hoisted','deploy','--prod','--ignore-scripts',deployed],source);
  run(process.execPath,[join(deployed,'node_modules/prisma/build/index.js'),'generate','--schema',join(deployed,'prisma/schema.prisma')],deployed,{...process.env,DATABASE_URL:'mysql://unused:unused@127.0.0.1/qicore'});
  await assertNativePrismaLayout(deployed);
  const omitted=[],dependencyOmissions=[];
  // Protocol-reserved persistent directory names must not collide with compiled module namespaces.
  const namespaces={storage:'file-service',backups:'data-safety'};
  async function copyRuntime(source,destination,prefix='',boundary=source,ancestors=new Set()){
   let info=await lstat(source);
   if(info.isSymbolicLink()){
    const target=await realpath(source),path=relative(resolve(boundary),target);
    if(path.startsWith('..')||path.startsWith('/'))throw Error('PACKAGE_EXTERNAL_SYMLINK: '+prefix);
    source=target;info=await lstat(source);
   }
   if(info.isDirectory()){
    const path=await realpath(source);if(ancestors.has(path))throw Error('PACKAGE_LINK_CYCLE: '+prefix);
    const next=new Set([...ancestors,path]);
    for(const name of await readdir(source)){
     const outputName=prefix==='apps/api/dist'?(namespaces[name]||name):name==='storage'&&['node_modules/qiniu/qiniu','node_modules/multer'].includes(prefix)?'storage-code':name;
     const path=prefix?prefix+'/'+outputName:outputName;
     if(name==='.bin'||name==='.pnpm'||name==='.modules.yaml'||name==='pnpm-lock.yaml'||name==='docs'||name==='examples'||name==='benchmarks'||name==='@types'||name==='typescript'||name==='tsconfig.json'||name.startsWith('.git')||/\.(?:ts|map)$/.test(name)||!nativePathSchema.safeParse(path).success){omitted.push(path);continue}
     await copyRuntime(join(source,name),join(destination,outputName),path,boundary,next);
    }
   }else if(info.isFile()){
    const reason=nativeDependencyOmission(prefix);
    if(reason){dependencyOmissions.push({path:prefix,reason,bytes:info.size});omitted.push(prefix);return}
    await mkdir(dirname(destination),{recursive:true});
    if(prefix.startsWith('apps/api/dist/')&&/\.(mjs|js)$/.test(prefix)){
     const code=(await readFile(source,'utf8')).replace(/(['"])((?:\.\.?\/)+)(storage|backups)\//g,(_all,quote,parent,name)=>quote+parent+namespaces[name]+'/');
     await writeFile(destination,code);
    }else if(/^node_modules\/(qiniu|multer)\//.test(prefix)&&/\.(mjs|cjs|js)$/.test(prefix)){
     const code=(await readFile(source,'utf8')).replace(/(['"])(\.\.?\/[^'"\r\n]+)\1/g,(_all,quote,specifier)=>quote+specifier.split('/').map(part=>part==='storage'?'storage-code':part).join('/')+quote);
     await writeFile(destination,code);
    }else await cp(source,destination);
   }else throw Error('PACKAGE_SPECIAL_FILE: '+prefix);
  }
  await copyRuntime(join(deployed,'node_modules'),join(tree,'node_modules'),'node_modules');
  for(const dir of ['apps/api/dist','apps/api/prisma','apps/admin/.output'])await copyRuntime(join(repo,dir),join(tree,dir),dir);
  await mkdir(join(tree,'config'),{recursive:true});await cp(join(repo,'config/license-product.json'),join(tree,'config/license-product.json'));
  const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8')),product=JSON.parse(await readFile(join(repo,'config/license-product.json'),'utf8'));
  await writeFile(join(tree,'package.json'),JSON.stringify({name:'qicore-runtime',version:pkg.version,type:'module',private:true})+'\n');
  run(process.execPath,['--input-type=module','-e',"globalThis.fetch=async()=>{throw Error('PACKAGE_NETWORK_BLOCKED')};await import('reflect-metadata');await import('./apps/api/dist/core/platform-resources.mjs');await import('@nestjs/platform-express');await import('./apps/api/dist/lifecycle/native-installation.js')"],tree,{...process.env,CHECKPOINT_DISABLE:'1',JITI_FS_CACHE:'0'});
  const fromVersion=options.fromVersion||'0.0.0',baseline=options.baselineManifest?JSON.parse(await readFile(resolve(options.baselineManifest),'utf8')):undefined,databasePlan=options.databasePlan?JSON.parse(await readFile(resolve(options.databasePlan),'utf8')):undefined;
  const migrations=await materializeNativeBuildMigrations(tree,{fromVersion,baseline,databasePlan});
  const files=[];
  async function inventory(dir,prefix=''){for(const name of (await readdir(dir)).sort()){const path=prefix+name,file=join(dir,name),stat=await lstat(file);if(stat.isDirectory())await inventory(file,path+'/');else files.push({path,size:stat.size,sha256:hash(await readFile(file))})}}
  await inventory(tree);
  assertNativeBuildTarget({packageKey:product.appKey,targetVersion:pkg.version,fromVersion,files,baseline,databasePlan,migrations});
  const manifest=nativeArchiveManifestSchema.parse({format:'qilicense-full-release-v1',package_type:'framework_update',package_key:product.appKey,from_version:fromVersion,version:pkg.version,files,runtime:{name:'node',major:24,platform:'linux',arch:'x64'},framework:null,entrypoint:'apps/api/dist/lifecycle/production.js',dependencies:[],migrations,databaseCompatibility:'backward-compatible'});
  const raw=canonicalJson(manifest)+'\n';await writeFile(join(tree,'release-manifest.json'),raw);
  const archive=join(output,'qicore-'+pkg.version+'-linux-x64.zip');
  run('zip',['-q','-X','-9',archive,'-@'],tree,process.env,[...files.map(f=>f.path),'release-manifest.json'].join('\n')+'\n');
  const summary={version:pkg.version,fromVersion,baselineRecordSha256:baseline?hash(canonicalJson(baseline)+'\n'):null,baselineReleaseManifestSha256:baseline?.releaseManifestSha256??(baseline?hash(canonicalJson(baseline)+'\n'):null),packageKey:product.appKey,platform:'linux-x64',files:files.length,expandedBytes:files.reduce((n,f)=>n+f.size,0),archive:archive.split('/').at(-1),archiveBytes:(await stat(archive)).size,sha256:hash(await readFile(archive)),manifestSha256:hash(raw),signed:false,dependencyOmissions,omittedPaths:omitted};
  await writeFile(join(output,'release-manifest.json'),raw);await writeFile(join(output,'package-report.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({...summary,omittedPaths:omitted.length}));console.log(JSON.stringify(await buildBootstrap(output,tree,copyRuntime)));return {archive,manifest,tree};
 }finally{
  if(!resolve(scratch).startsWith(resolve(tmpdir())+'/qicore-package-'))throw Error('PACKAGE_CLEANUP_PATH_INVALID');
  await rm(scratch,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {output,options}=nativeBuildOptions(process.argv.slice(2));await buildNative(output,options)}
