import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {fileHash,noLinks,extractNativeArchive} from '../apps/api/dist/lifecycle/native-files.js';
import {verifyNativeInitialRelease} from '../apps/api/dist/license/native-updates.js';
import {preparePhotoIntegrityQa} from './prepare-photo-integrity-qa.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const pins={initial:'30cbd077578725c1368caac286e81f59c9a462bfd398baaa2a77d1204dc33f49',update:'a15957682bc8a07c1b54639123ba08a5c7c985ca38cf46c36a2bc74b1c50106b',bootstrap:'cebd282ce7bcb00f84bf7f25c6e5af4dedcbb39cc943bae79a1f7477a2eb44bc',customer:'7ec878742585de140aed5b172a0487aa3f5204bc37834104f7717e86fc3ed832'};
const inside=(root,path)=>{const p=relative(root,path);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)};
const json=async p=>JSON.parse(await readFile(p,'utf8'));
function run(command,args,env){const result=spawnSync(command,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout}

export async function prepareBootstrapTerminalQa(env=process.env){
 const paths={};
 for(const key of ['QICORE_017_ARTIFACT_DIR','QICORE_017_EVIDENCE_DIR','QICORE_017_CUSTOMER_ARTIFACT_DIR','QICORE_016_ARTIFACT_DIR','NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','QICORE_PHOTO_INPUT_DIR','QICORE_CUSTOMER_OUTPUT_DIR','QICORE_DELIVERY_REPORT_DIR']){
  assert.ok(env[key]&&isAbsolute(env[key])&&!/[\x00-\x1f\x7f]/.test(env[key]),key+' required');paths[key]=resolve(env[key]);noLinks(paths[key]);
 }
 const inputs=['QICORE_017_ARTIFACT_DIR','QICORE_017_EVIDENCE_DIR','QICORE_017_CUSTOMER_ARTIFACT_DIR','QICORE_016_ARTIFACT_DIR','QICORE_PHOTO_INPUT_DIR'].map(k=>paths[k]);
 const outputs=['NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','QICORE_CUSTOMER_OUTPUT_DIR','QICORE_DELIVERY_REPORT_DIR'].map(k=>paths[k]);
 for(const out of outputs){assert.ok(!inside(repo,out)&&!inputs.some(p=>inside(p,out)||inside(out,p)));assert.ok(!outputs.some(p=>p!==out&&(inside(p,out)||inside(out,p))));assert.equal(await lstat(out).catch(e=>{if(e.code==='ENOENT')return null;throw e}),null,'OUTPUT_ALREADY_EXISTS')}
 const original={initial:join(paths.QICORE_017_ARTIFACT_DIR,'qicore-017-initial/qicore-0.1.7-linux-x64.zip'),update:join(paths.QICORE_017_ARTIFACT_DIR,'qicore-017-update/qicore-0.1.7-linux-x64.zip'),bootstrap:join(paths.QICORE_017_ARTIFACT_DIR,'qicore-017-initial/qicore-bootstrap-0.1.7-linux-x64.zip'),customer:join(paths.QICORE_017_CUSTOMER_ARTIFACT_DIR,'qicore-0.1.7-linux-x64-install.zip')};
 for(const [kind,path]of Object.entries(original)){noLinks(path);assert.equal(await fileHash(path),pins[kind],kind+' immutable input changed')}
 for(const [kind,key,folder]of [['initial','NATIVE_PACKAGE_DIR','qicore-017-initial'],['update','NATIVE_UPDATE_PACKAGE_DIR','qicore-017-update']]){
  const output=paths[key];await mkdir(output);await cp(original[kind],join(output,'qicore-0.1.7-linux-x64.zip'));
  await cp(join(paths.QICORE_017_ARTIFACT_DIR,folder,'release-manifest.json'),join(output,'release-manifest.json'));
  await cp(join(paths.QICORE_017_EVIDENCE_DIR,folder,'package-report.json'),join(output,'package-report.json'));
  const report=await json(join(output,'package-report.json'));
  assert.equal(report.sha256,pins[kind]);assert.equal(report.archive,'qicore-0.1.7-linux-x64.zip');
  assert.equal(report.archiveBytes,kind==='initial'?53096675:53098184);
  assert.equal(await fileHash(join(output,'release-manifest.json')),kind==='initial'?'0656ed490808942f02f9b1e18f3b2f764a273adbbf5a27f7cd0252a3427a9765':'fb7a99d741ed5df0bfd363ae37dbbba6683d2ed6218c8ea56b394a06139e7b5c');
 }
 const product=await json(join(repo,'config/license-product.json')),prior=await json(join(paths.QICORE_017_ARTIFACT_DIR,'qicore-017-initial/integrity-candidate.json'));
 const initial=verifyNativeInitialRelease({...product,version:'0.1.7'},prior.initialRelease);assert.equal(initial.artifact.sha256,pins.initial);
 await extractNativeArchive(original.initial,join(paths.NATIVE_PACKAGE_DIR,'runtime'),initial);
 const compiled=join(paths.NATIVE_PACKAGE_DIR,'transition-check.candidate.mjs');
 const result=await build({entryPoints:[join(repo,'apps/api/dist/lifecycle/bootstrap-transition-check.js')],outfile:compiled,bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:false,external:['@prisma/client'],banner:{js:"import {createRequire as bootstrapRequire} from 'node:module';const require=bootstrapRequire(import.meta.url);"},metafile:true});
 await writeFile(join(paths.NATIVE_PACKAGE_DIR,'transition-check-metafile.json'),JSON.stringify(result.metafile,null,2)+'\n',{flag:'wx'});
 const python=process.platform==='win32'?'python':'python3',helper=join(repo,'scripts/bootstrap-terminal-archive.py');
 run(python,[helper,'derive',original.bootstrap,compiled,paths.NATIVE_PACKAGE_DIR],env);
 run(process.execPath,[join(repo,'scripts/prepare-native-integrity-qa.mjs')],{...env,...paths});
 const photo=await preparePhotoIntegrityQa({...env,...paths});
 run(python,[helper,'compare-customer',original.customer,photo.outputs.QICORE_CUSTOMER_INSTALL_ZIP,join(paths.QICORE_DELIVERY_REPORT_DIR,'customer-derivation-report.json')],env);
 for(const [kind,path]of Object.entries(original))assert.equal(await fileHash(path),pins[kind]);
 for(const [kind,key]of [['initial','NATIVE_PACKAGE_DIR'],['update','NATIVE_UPDATE_PACKAGE_DIR']])assert.equal(await fileHash(join(paths[key],'qicore-0.1.7-linux-x64.zip')),pins[kind]);
 const provenance={status:'prepared-awaiting-new-linux-acceptance',runtimeSourceCommit:'e606ce602cc5a6508a59dc0d5e03bde470ca1202',checkSourceCommit:env.GITHUB_SHA??null,checkSourceSha256:await fileHash(join(repo,'apps/api/src/lifecycle/bootstrap-transition-check.ts')),checkBundleSha256:await fileHash(compiled),originals:pins,runtimeArchivesRebuilt:false,applicationArchiveRebuilt:false,installerUiRebuilt:false,newBootstrap:await json(join(paths.NATIVE_PACKAGE_DIR,'bootstrap-report.json')),customer:photo.customer};
 await writeFile(join(paths.QICORE_DELIVERY_REPORT_DIR,'terminal-fix-provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
 return provenance;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await prepareBootstrapTerminalQa()));
