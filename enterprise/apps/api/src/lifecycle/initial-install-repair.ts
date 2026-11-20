import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,chmodSync,chownSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve,relative,sep} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {StateStore} from '../license/store.js';
import {noLinks,syncDirectory} from './native-files.js';
import {bootstrapConfigSchema,type BootstrapConfig} from './bootstrap-config.js';
import {nativeConfigSchema,type NativeConfig} from './native-state.js';

const journalName='initial-source-repair.json';
const overlaps=(a:string,b:string)=>{const p=relative(resolve(a),resolve(b));return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)};
const privateText=(path:string)=>{
 noLinks(path);if(!existsSync(path))return null;
 const s=lstatSync(path);if(!s.isFile()||s.nlink!==1||(s.mode&0o077)!==0||s.size>256*1024)throw Error('PRIVATE_INSTALL_CONFIG_REQUIRED');
 if(process.getuid&&s.uid!==process.getuid())throw Error('PRIVATE_INSTALL_CONFIG_OWNER');
 return readFileSync(path,'utf8');
};
type Change={path:string;before:string;after:string};
type Journal={schema:'qicore-initial-source-repair-v1';status:'pending'|'complete';codeRoot:string;createCode:boolean;changes:Change[]};
const compareVersions=(a:string,b:string)=>{
 if(![a,b].every(value=>/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)))throw Error('INSTALL_SOURCE_VERSION_INVALID');
 const left=a.split('.').map(BigInt),right=b.split('.').map(BigInt),index=left.findIndex((value,i)=>value!==right[i]);return index<0?0:left[index]! > right[index]! ?1:-1;
};

// The caller holds controller.lock and supplies a verified delivery and a read-only empty-database check.
// No installed/recovery state, database contents, identity, receipt or failed request is replaced.
export async function reconcileInitialInstall(configPath:string,candidate:BootstrapConfig,checkDatabase:(url:string)=>Promise<void>,apply=true):Promise<{changed:boolean;applied:boolean;version:string;archive:string;createdCodeDirectory:boolean;backupJournal:string|null}>{
 configPath=resolve(configPath);
 const originalText=privateText(configPath);if(originalText===null)throw Error('INSTALL_CONFIG_MISSING');
 const config=bootstrapConfigSchema.parse(JSON.parse(originalText));
 const store=new StateStore(dirname(configPath));
 const journalText=privateText(join(dirname(configPath),journalName));
 const pending=journalText?JSON.parse(journalText) as Journal:null;
 const deploymentText=privateText(join(dirname(configPath),'deployment-sync.json'));
 if(deploymentText&&JSON.parse(deploymentText).status==='pending')throw Error('INSTALL_REPAIR_DEPLOYMENT_PENDING');
 const finish=(journal:Journal)=>{
  if(journal.schema!=='qicore-initial-source-repair-v1'||!['pending','complete'].includes(journal.status)||journal.codeRoot!==config.native.root||typeof journal.createCode!=='boolean'||!Array.isArray(journal.changes)||journal.changes.length>2)throw Error('INSTALL_REPAIR_JOURNAL_INVALID');
  const allowed=[configPath,resolve(config.nativeConfigFile)],seen=new Set<string>();
  let proposed=config,proposedNative=saved;
  for(const change of journal.changes){
   if(!allowed.includes(change.path)||seen.has(change.path)||typeof change.before!=='string'||typeof change.after!=='string')throw Error('INSTALL_REPAIR_JOURNAL_INVALID');seen.add(change.path);
   const current=privateText(change.path);if(current!==change.before&&current!==change.after)throw Error('INSTALL_REPAIR_CONFLICT');
   try{
    if(change.path===configPath){
     const before=bootstrapConfigSchema.parse(JSON.parse(change.before)),after=bootstrapConfigSchema.parse(JSON.parse(change.after));
     if(!isDeepStrictEqual(after,{...before,archive:after.archive,releaseFile:after.releaseFile,native:{...before.native,product:{...before.native.product,version:after.native.product.version}}}))throw Error('INSTALL_REPAIR_JOURNAL_INVALID');
     proposed=after;
    }else{
     const before=nativeConfigSchema.parse(JSON.parse(change.before)),after=nativeConfigSchema.parse(JSON.parse(change.after));
     if(!isDeepStrictEqual(after,{...before,product:{...before.product,version:after.product.version}}))throw Error('INSTALL_REPAIR_JOURNAL_INVALID');
     proposedNative=after;
    }
   }catch{throw Error('INSTALL_REPAIR_JOURNAL_INVALID')}
  }
  if(compareVersions(proposed.native.product.version,candidate.native.product.version)>0)throw Error('INSTALL_REPAIR_JOURNAL_INVALID');
  if(dirname(resolve(proposed.archive))!==dirname(resolve(candidate.archive))||basename(proposed.archive)!==`qicore-${proposed.native.product.version}-linux-${process.arch}.zip`||resolve(proposed.releaseFile)!==resolve(candidate.releaseFile))throw Error('INSTALL_REPAIR_JOURNAL_INVALID');
  if(proposedNative){const {migrationUrl,...native}=proposedNative;if(!isDeepStrictEqual(native,proposed.native))throw Error('INSTALL_REPAIR_JOURNAL_INVALID');}
  for(const change of journal.changes){
   const current=privateText(change.path);if(current!==change.before&&current!==change.after)throw Error('INSTALL_REPAIR_CONFLICT');
   if(current!==change.after)new StateStore(dirname(change.path)).write(basename(change.path),JSON.parse(change.after));
  }
  if(journal.createCode&&!existsSync(config.native.root)){mkdirSync(config.native.root,{mode:0o755});chmodSync(config.native.root,0o755);if(process.getuid?.()===0)chownSync(config.native.root,0,config.native.runtimeGid);syncDirectory(dirname(config.native.root));}
  store.write(journalName,{...journal,status:'complete'});
 };
 if(pending&&(pending.schema!=='qicore-initial-source-repair-v1'||!['pending','complete'].includes(pending.status)))throw Error('INSTALL_REPAIR_JOURNAL_INVALID');
 if(resolve(config.native.root)!==resolve(candidate.native.root))throw Error('INSTALL_SOURCE_LAYOUT_CHANGED');
 const paths=[config.native.root,config.native.stateRoot,config.native.dataRoot,config.native.licenseStateRoot,config.native.backupRoot,config.native.backupKeyRoot];
 if(new Set([configPath,config.nativeConfigFile,config.native.environmentFile,join(dirname(configPath),journalName)].map(path=>resolve(path))).size!==4)throw Error('BOOTSTRAP_LAYOUT_INVALID');
 for(const path of [...paths,config.controlRoot,config.nativeConfigFile,config.native.environmentFile]){if(!isAbsolute(path))throw Error('BOOTSTRAP_LAYOUT_INVALID');noLinks(path)}
 if(paths.some((path,i)=>paths.some((other,j)=>i!==j&&overlaps(path,other)))||[config.controlRoot,dirname(configPath),dirname(candidate.archive),dirname(candidate.releaseFile)].some(path=>overlaps(config.native.root,path)||overlaps(path,config.native.root)))throw Error('BOOTSTRAP_LAYOUT_INVALID');
 const empty=(path:string)=>!existsSync(path)||lstatSync(path).isDirectory()&&readdirSync(path).length===0;
 if(existsSync(config.native.environmentFile)||[config.native.root,config.native.dataRoot,config.native.backupRoot,config.native.backupKeyRoot].some(path=>!empty(path)))throw Error('INSTALL_REPAIR_RECOVERY_REQUIRED');
 if(existsSync(config.native.stateRoot))for(const name of readdirSync(config.native.stateRoot)){
  const path=join(config.native.stateRoot,name);noLinks(path);
  if(name!==config.native.frameworkKey||!empty(path))throw Error('INSTALL_REPAIR_RECOVERY_REQUIRED');
 }
 noLinks(config.controlRoot);
 if(existsSync(config.controlRoot)&&readdirSync(config.controlRoot).some(name=>!['controller.lock','bootstrap-init.json','access.json','launch.json','request.json'].includes(name)))throw Error('INSTALL_REPAIR_RECOVERY_REQUIRED');
 const requestText=privateText(join(config.controlRoot,'request.json')),request=requestText?JSON.parse(requestText):null;
 if(request&&request.status!=='failed')throw Error('INSTALL_REPAIR_RECOVERY_REQUIRED');
 const savedText=privateText(config.nativeConfigFile),saved=savedText?nativeConfigSchema.parse(JSON.parse(savedText)):null;
 if(saved){
  const {migrationUrl,...native}=saved,normalized={...native,product:{...native.product,version:config.native.product.version}};
  if(!request||pending?.status!=='pending'&&!isDeepStrictEqual(normalized,config.native))throw Error('INSTALL_CONFIG_CHANGED');
  await checkDatabase(migrationUrl);
 }
 const product={...config.native.product,version:candidate.native.product.version};
 if(!isDeepStrictEqual(product,candidate.native.product))throw Error('INSTALL_SOURCE_IDENTITY_CHANGED');
 for(const version of [config.native.product.version,...(saved?[saved.product.version]:[])])if(compareVersions(product.version,version)<0)throw Error('INSTALL_SOURCE_DOWNGRADE_REJECTED');
 // Validate the newly supplied source before resuming any writes from an interrupted repair.
 if(pending?.status==='pending'){
  if(!apply)throw Error('INSTALL_REPAIR_PENDING');
  finish(pending);const result=await reconcileInitialInstall(configPath,candidate,checkDatabase,apply);return {...result,changed:true,backupJournal:join(dirname(configPath),journalName)};
 }
 const next=bootstrapConfigSchema.parse({...config,archive:candidate.archive,releaseFile:candidate.releaseFile,native:{...config.native,product}});
 const changes:Change[]=[];
 if(!isDeepStrictEqual(config,next))changes.push({path:configPath,before:privateText(configPath)!,after:JSON.stringify(next)});
 if(saved){const updated:NativeConfig={...saved,product};if(!isDeepStrictEqual(saved,updated))changes.push({path:resolve(config.nativeConfigFile),before:savedText!,after:JSON.stringify(updated)});}
 const createCode=!existsSync(config.native.root);
 if(apply){
  if(changes.length||createCode){const journal:Journal={schema:'qicore-initial-source-repair-v1',status:'pending',codeRoot:config.native.root,createCode,changes};store.write(journalName,journal);finish(journal);}
 }
 return {changed:changes.length>0||createCode,applied:apply,version:product.version,archive:next.archive,createdCodeDirectory:createCode,backupJournal:changes.length||createCode?join(dirname(configPath),journalName):null};
}
