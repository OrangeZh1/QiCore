import {readFile,writeFile,lstat,mkdir,cp,rename,rm,open,readdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {get as httpGet} from 'node:http';
import {verifyBootstrapInventory} from './bootstrap-inventory.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const exists=async path=>{try{await lstat(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}};
const contains=(root,path)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)};
async function noLinks(path){for(let p=resolve(path);;p=dirname(p)){if(await exists(p)&&(await lstat(p)).isSymbolicLink())throw Error('TRANSITION_LINK_REJECTED');if(p===dirname(p))break}}
async function sync(path,directory=false){if(directory&&process.platform==='win32')return;const f=await open(path,directory?'r':'r+');try{await f.sync()}finally{await f.close()}}
async function durable(file,value){const tmp=file+'.'+randomUUID()+'.tmp';const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync()}finally{await f.close()}await rename(tmp,file);await sync(dirname(file),true)}
async function retainJournal(c,j){
 const file=join(c.control,'bootstrap-transition-'+j.taskId+'.json'),bytes=await readFile(c.journal);
 await noLinks(file);
 if(!await exists(file)){
  const temporary=file+'.'+randomUUID()+'.tmp',f=await open(temporary,'wx',0o600);
  try{
   try{await f.writeFile(bytes);await f.sync()}finally{await f.close()}
   // Publish complete evidence without ever replacing a prior historical receipt.
   try{await link(temporary,file)}catch(error){if(error.code!=='EEXIST')throw error}
  }finally{await unlink(temporary)}
 }
 const info=await lstat(file);
 if(!info.isFile()||info.nlink!==1||!(await readFile(file)).equals(bytes))throw Error('TRANSITION_HISTORY_CONFLICT');
 await sync(c.control,true);
}
async function move(from,to){await rename(from,to);await sync(dirname(from),true);if(dirname(from)!==dirname(to))await sync(dirname(to),true)}
async function syncTree(root){for(const name of await readdir(root)){const file=join(root,name);if((await lstat(file)).isDirectory())await syncTree(file);else await sync(file)}await sync(root,true)}
const protocols=['qicore-initial-release-v1','qicore-initial-release-v2','qicore-local-release-v1','qicore-local-release-v2','qilicense-release-v2'];

export async function verifyTransitionCandidate(root,manifestSha256,version){
 await noLinks(join(root,'bootstrap-manifest.json'));
 const bytes=await readFile(join(root,'bootstrap-manifest.json')),m=JSON.parse(bytes);
 if(!/^[a-f0-9]{64}$/.test(manifestSha256)||digest(bytes)!==manifestSha256)throw Error('BOOTSTRAP_MANIFEST_DIGEST_MISMATCH');
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)||m.version!==version||m.format!=='qicore-bootstrap-v1'||m.product!=='qicore'||m.packageKey!=='frm_cdm43f43e7yhk5jd')throw Error('BOOTSTRAP_PRODUCT_VERSION_MISMATCH');
 if(m.updatePlanCapability!=='native-full-v3'||m.applicationLifecycleCapability!=='native-lifecycle-v2'||m.initialReleaseFormat!=='qicore-initial-release-v2'||!protocols.every(p=>m.supportedReleaseFormats?.includes(p)))throw Error('BOOTSTRAP_PROTOCOL_UNSUPPORTED');
 const files=await verifyBootstrapInventory(root);
 for(const name of ['start.mjs','controller.mjs','transition-check.mjs','package.json'])if(!files.has(name))throw Error('BOOTSTRAP_ENTRY_REQUIRED');
 const pkg=await json(join(root,'package.json'));if(pkg.name!=='qicore-bootstrap'||pkg.version!==version)throw Error('BOOTSTRAP_PRODUCT_VERSION_MISMATCH');
 return m;
}

async function context(input){
 const live=resolve(input.bootstrapRoot),candidate=resolve(input.candidateRoot),configPath=resolve(input.config),config=await (noLinks(configPath).then(()=>json(configPath)));
 const control=resolve(config.controlRoot),previous=join(dirname(live),'.qicore-bootstrap-previous'),staged=join(dirname(live),'.qicore-bootstrap-candidate');
 for(const path of [live,candidate,configPath,control,previous,staged])await noLinks(path);
 const persistent=[configPath,control,config.nativeConfigFile,...['root','stateRoot','dataRoot','licenseStateRoot','environmentFile','backupRoot','backupKeyRoot'].map(k=>config.native?.[k])];
 if(persistent.some(p=>typeof p!=='string'||!isAbsolute(p)||[live,candidate,previous,staged].some(root=>contains(root,resolve(p))||contains(resolve(p),root))))throw Error('TRANSITION_LAYOUT_INVALID');
 if([previous,staged].includes(live)||[live,previous,staged].some(root=>contains(root,candidate)||contains(candidate,root)))throw Error('TRANSITION_LAYOUT_INVALID');
 if(config.native?.frameworkKey!=='frm_cdm43f43e7yhk5jd'||config.native?.product?.product!=='qicore')throw Error('BOOTSTRAP_PRODUCT_INVALID');
 for(const name of ['bootstrap-transition.json','bootstrap-transition.lock','controller.lock','bootstrap-ready.json'])await noLinks(join(control,name));
 return {live,candidate,configPath,config,control,previous,staged,persistent,journal:join(control,'bootstrap-transition.json')};
}
async function checkInstalled(root,configPath){
 const check=await import(pathToFileURL(join(root,'transition-check.mjs')).href);
 return check.verifyTransitionInstallation(configPath);
}
async function assertManifest(root,expected){if(digest(await readFile(join(root,'bootstrap-manifest.json')))!==expected)throw Error('TRANSITION_TREE_CHANGED');await verifyBootstrapInventory(root)}
function stagedPath(c,taskId){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(taskId))throw Error('TRANSITION_JOURNAL_MISMATCH');
 const path=join(dirname(c.live),'.qicore-bootstrap-candidate-'+taskId);
 if(c.persistent.some(p=>contains(path,resolve(p))||contains(resolve(p),path)))throw Error('TRANSITION_LAYOUT_INVALID');
 return path;
}
async function plannedCandidate(c,source){
 const manifest=structuredClone(source),delivery=await exists(join(c.live,'delivery.json'))?await readFile(join(c.live,'delivery.json')):null;
 if(delivery){manifest.files=manifest.files.filter(file=>file.path!=='delivery.json');manifest.files.push({path:'delivery.json',size:delivery.length,sha256:digest(delivery)})}
 return {manifest,delivery,bytes:delivery?Buffer.from(JSON.stringify(manifest,null,2)+'\n'):await readFile(join(c.candidate,'bootstrap-manifest.json'))};
}
async function discardPartial(c,j){
 await assertManifest(c.live,j.oldManifestSha256);
 const source=await verifyTransitionCandidate(c.candidate,j.sourceManifestSha256,j.version),planned=await plannedCandidate(c,source);
 if(digest(planned.bytes)!==j.manifestSha256)throw Error('TRANSITION_TREE_CHANGED');
 if(!await exists(c.staged))return;
 const allowed=new Map(source.files.map(file=>[file.path,[join(c.candidate,file.path)]]));
 allowed.set('bootstrap-manifest.json',[join(c.candidate,'bootstrap-manifest.json'),planned.bytes]);
 if(planned.delivery)allowed.set('delivery.json',[...(allowed.get('delivery.json')??[]),planned.delivery]);
 if(await exists(join(c.candidate,'.htaccess')))allowed.set('.htaccess',[join(c.candidate,'.htaccess')]);
 async function walk(dir,prefix=''){
  for(const name of await readdir(dir)){
   const file=join(dir,name),key=prefix+name,info=await lstat(file);
   if(info.isSymbolicLink())throw Error('TRANSITION_PARTIAL_TREE_CHANGED');
   if(info.isDirectory()){if(![...allowed.keys()].some(path=>path.startsWith(key+'/')))throw Error('TRANSITION_PARTIAL_TREE_CHANGED');await walk(file,key+'/');continue}
   if(!info.isFile()||info.nlink!==1||!allowed.has(key))throw Error('TRANSITION_PARTIAL_TREE_CHANGED');
   const bytes=await readFile(file);let matches=false;
   for(const value of allowed.get(key)){const original=Buffer.isBuffer(value)?value:await readFile(value);if(bytes.length<=original.length&&bytes.equals(original.subarray(0,bytes.length))){matches=true;break}}
   if(!matches)throw Error('TRANSITION_PARTIAL_TREE_CHANGED');
  }
 }
 await walk(c.staged);await rm(c.staged,{recursive:true});await sync(dirname(c.staged),true);
}
async function restore(c,j){
 if(await exists(c.previous)){
  await assertManifest(c.previous,j.oldManifestSha256);
  if(await exists(c.live)){await assertManifest(c.live,j.manifestSha256);if(await exists(c.staged))throw Error('TRANSITION_RECOVERY_CONFLICT');await move(c.live,c.staged)}
  await move(c.previous,c.live);
 }else await assertManifest(c.live,j.oldManifestSha256);
 // Staging is task-owned and validated before removal. Persistent paths are disjoint.
 if(await exists(c.staged)){await assertManifest(c.staged,j.manifestSha256);await rm(c.staged,{recursive:true});await sync(dirname(c.staged),true)}
 j.status='rolled_back';j.rolledBackAt=new Date().toISOString();await durable(c.journal,j);return j;
}

// CLI holds the existing controller flock for apply/recover. Hooks are local failure-test injection only.
export async function transitionBootstrap(operation,input,hooks={}){
 const c=await context(input);let j=await exists(c.journal)?await json(c.journal):null;
 if(j&&(j.format!=='qicore-bootstrap-transition-v1'||j.bootstrapRoot!==c.live||j.config!==c.configPath))throw Error('TRANSITION_JOURNAL_MISMATCH');
 if(j){c.staged=stagedPath(c,j.taskId);await noLinks(c.staged)}
 if(operation==='recover'){
  if(!j||!['staging','prepared','switched'].includes(j.status))throw Error('TRANSITION_RECOVERY_NOT_REQUIRED');
  await verifyTransitionCandidate(c.candidate,j.sourceManifestSha256,j.version);
  if(JSON.stringify(await checkInstalled(c.candidate,c.configPath))!==JSON.stringify(j.installed))throw Error('TRANSITION_ACTIVE_VERSION_CHANGED');
  if(j.status==='staging'){await discardPartial(c,j);j.status='rolled_back';j.rolledBackAt=new Date().toISOString();await durable(c.journal,j);return j}
  return restore(c,j);
 }
 if(operation==='complete'){
  if(!j||!['switched','verified'].includes(j.status))throw Error('TRANSITION_NOT_SWITCHED');
  await assertManifest(c.live,j.manifestSha256);
  const installed=await checkInstalled(c.live,c.configPath),ready=await json(join(c.control,'bootstrap-ready.json'));
  if(ready.format!=='qicore-bootstrap-ready-v1'||ready.manifestSha256!==j.manifestSha256||!Number.isFinite(Date.parse(ready.readyAt))||!Number.isFinite(Date.parse(j.switchedAt))||Date.parse(ready.readyAt)<Date.parse(j.switchedAt)||!Number.isInteger(ready.pid)||ready.pid<=0||JSON.stringify(ready.installed)!==JSON.stringify(installed))throw Error('NEW_CONTROLLER_READINESS_REQUIRED');
  process.kill(ready.pid,0);
  for(const url of [c.config.native.healthUrl,c.config.native.loginUrl]){
   const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1')throw Error('LOCAL_HEALTH_URL_REQUIRED');
   if(url===c.config.native.healthUrl){
    const response=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw Error('BOOTSTRAP_HEALTH_FAILED');
    const body=await response.json(),framework=installed.find(row=>row.packageKey==='frm_cdm43f43e7yhk5jd'),component=body.components?.[framework.packageKey];
    if(body.ready!==true||body.mock===true||body.version!==framework.version||component?.version!==framework.version||component?.manifestSha256!==framework.image.split('sha256:')[1])throw Error('BOOTSTRAP_HEALTH_FAILED');
   }else{
    // Node fetch does not reliably preserve Host; SSR must receive the configured public authority.
    const healthy=await new Promise((ok,fail)=>{
     const request=httpGet(url,{headers:{host:new URL(c.config.adminOrigin).host},signal:AbortSignal.timeout(5000)},response=>{
      let html='';response.setEncoding('utf8');response.on('data',chunk=>{html+=chunk;if(html.length>2*1024*1024)request.destroy(Error('BOOTSTRAP_HEALTH_FAILED'))});
      response.once('error',fail);response.once('end',()=>ok(response.statusCode===200&&response.headers['content-type']?.startsWith('text/html')&&html.includes('<html')));
     });request.once('error',fail);
    });
    if(!healthy)throw Error('BOOTSTRAP_HEALTH_FAILED');
   }
  }
  j.status='verified';j.verifiedAt=new Date().toISOString();j.readiness=ready;await durable(c.journal,j);
  if(await exists(c.previous)){await assertManifest(c.previous,j.oldManifestSha256);await rm(c.previous,{recursive:true});await sync(dirname(c.previous),true)}
  j.status='complete';j.completedAt=new Date().toISOString();await durable(c.journal,j);return j;
 }
 if(operation!=='apply')throw Error('TRANSITION_OPERATION_INVALID');
 if(j&&!['rolled_back','complete'].includes(j.status))throw Error('TRANSITION_RECOVERY_REQUIRED');
 if(await exists(c.previous)||await exists(c.staged))throw Error('TRANSITION_UNEXPLAINED_TREE');
 const manifest=await verifyTransitionCandidate(c.candidate,input.manifestSha256,input.version);
 await verifyBootstrapInventory(c.live);
 const oldBytes=await readFile(join(c.live,'bootstrap-manifest.json')),oldManifest=JSON.parse(oldBytes);
 const compare=(a,b)=>{const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt),i=x.findIndex((n,i)=>n!==y[i]);return i<0?0:x[i]>y[i]?1:-1};
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(oldManifest.version)||compare(manifest.version,oldManifest.version)<0)throw Error('BOOTSTRAP_DOWNGRADE_REJECTED');
 const installed=await checkInstalled(c.candidate,c.configPath);
 if(installed.some(row=>row.packageKey==='frm_cdm43f43e7yhk5jd'&&compare(manifest.version,row.version)<0))throw Error('BOOTSTRAP_DOWNGRADE_REJECTED');
 const planned=await plannedCandidate(c,manifest),manifestSha256=digest(planned.bytes),taskId=randomUUID();c.staged=stagedPath(c,taskId);
 await noLinks(c.staged);if(await exists(c.staged))throw Error('TRANSITION_UNEXPLAINED_TREE');
 if(j)await retainJournal(c,j);
 j={format:'qicore-bootstrap-transition-v1',taskId,bootstrapRoot:c.live,config:c.configPath,version:manifest.version,sourceManifestSha256:input.manifestSha256,manifestSha256,oldManifestSha256:digest(oldBytes),installed,status:'staging',preparedAt:new Date().toISOString()};
 await durable(c.journal,j);
 // A durable owner exists before copying starts. Interrupted copies have a constrained recover path.
 await hooks.beforeCopy?.(c.staged);await cp(c.candidate,c.staged,{recursive:true,errorOnExist:true,force:false});await hooks.afterCopy?.();
 await verifyTransitionCandidate(c.staged,input.manifestSha256,input.version);
 if(planned.delivery){await writeFile(join(c.staged,'delivery.json'),planned.delivery);await writeFile(join(c.staged,'bootstrap-manifest.json'),planned.bytes)}
 await verifyBootstrapInventory(c.staged);await syncTree(c.staged);
 j.status='prepared';await durable(c.journal,j);
 try{
  await move(c.live,c.previous);await hooks.afterOldMoved?.();await move(c.staged,c.live);await hooks.afterSwitched?.();
  await assertManifest(c.live,manifestSha256);await checkInstalled(c.live,c.configPath);
  j.status='switched';j.switchedAt=new Date().toISOString();await durable(c.journal,j);return j;
 }catch(error){await restore(c,j);throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [operation,file,locked]=process.argv.slice(2);
 if(process.platform!=='linux'||process.versions.node.split('.')[0]!=='24')throw Error('LINUX_NODE24_REQUIRED');
 if(!['apply','recover','complete'].includes(operation)||!file)throw Error('Use: node transition.mjs apply|recover|complete INPUT.json');
 const input=await json(resolve(file)),c=await context(input);
 // The tool must remain available if the live directory is temporarily absent.
 if(contains(c.live,resolve(process.argv[1])))throw Error('TRANSITION_TOOL_OUTSIDE_LIVE_REQUIRED');
 if(locked!=='--locked'){
  const locks=[join(c.control,'bootstrap-transition.lock'),...(operation==='complete'?[]:[join(c.control,'controller.lock')])];
  const args=locks.flatMap(lock=>['flock','--exclusive','--nonblock','--conflict-exit-code','73',lock]);
  const result=spawnSync(args.shift(),[...args,process.execPath,resolve(process.argv[1]),operation,resolve(file),'--locked'],{stdio:'inherit'});process.exitCode=result.status??1;
 }else console.log(JSON.stringify(await transitionBootstrap(operation,input)));
}
