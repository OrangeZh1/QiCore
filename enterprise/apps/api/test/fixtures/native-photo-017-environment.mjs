// Lifecycle/process handling is adapted from the accepted native-bootstrap-transition.check.mjs.
// Kept separate so importing this helper does not register or execute that file's tests.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,appendFile,cp,chmod,chown,readdir,rm,lstat,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {fixture,hash} from './native-release.mjs';
import {transitionReceipt} from './native-transition-receipt.mjs';
import {testMysqlClient,testDatabaseAccount} from './mysql-tools.mjs';
import {PHOTO_KEY,FRAMEWORK_KEY as key,readPhoto017Releases} from './photo-017-inputs.mjs';
import {NativeHost} from '../../dist/lifecycle/native-host.js';
import {installNative} from '../../dist/lifecycle/native-installation.js';
import {StateStore} from '../../dist/license/store.js';
import {LicenseClient} from '../../dist/license/client.js';
import {verifyNativeLocalRelease} from '../../dist/license/native-updates.js';
import {fileHash} from '../../dist/lifecycle/native-files.js';
import {verifyBootstrapInventory} from '../../../../scripts/bootstrap-inventory.mjs';
const json=async file=>JSON.parse(await readFile(file,'utf8')),delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const port=()=>new Promise(ok=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const value=s.address().port;s.close(()=>ok(value))})});
const preload=fileURLToPath(new URL('./native-photo-017-network.mjs',import.meta.url));
const official=await json(new URL('../../../../config/license-product.json',import.meta.url));

export async function photo017Environment(t,{baseline,candidate,update,inputs}){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
 const uid=Number(process.env.QICORE_TEST_RUNTIME_UID),gid=Number(process.env.QICORE_TEST_RUNTIME_GID);assert.ok(uid>0&&gid>0);
 const release=await json(join(baseline,'initial-release.json')),archive=join(baseline,'qicore-0.1.6-linux-x64.zip'),bootstrap=join(baseline,'bootstrap'),label='photo-017-upgrade';
 assert.equal(release.format,'qicore-initial-release-v1');assert.equal(release.version,'0.1.6');
 assert.equal(await fileHash(archive),'21a1b0b24109b513286793d547154055a9c9a432db2a54efec1ea1f98ccf3e84');
 assert.equal(hash(await readFile(join(bootstrap,'bootstrap-manifest.json'))),'1c2f6fe1e7b9f421aef02a9084b877c99a89b9bf42d7653d6a2cf4a074a7e59a');
 const bootstrapBytes=await readFile(join(candidate,'bootstrap/bootstrap-manifest.json')),bootstrapManifest=JSON.parse(bootstrapBytes),bootstrapReport=await json(join(candidate,'bootstrap-report.json'));
 assert.equal(bootstrapManifest.version,'0.1.7');assert.equal(bootstrapManifest.updatePlanCapability,'native-full-v3');assert.equal(bootstrapManifest.applicationLifecycleCapability,'native-lifecycle-v2');
 assert.equal(bootstrapReport.updatePlanCapability,'native-full-v3');assert.equal(bootstrapReport.applicationLifecycleCapability,'native-lifecycle-v2');assert.equal(bootstrapReport.manifestSha256,hash(bootstrapBytes));
 await verifyBootstrapInventory(bootstrap);await verifyBootstrapInventory(join(candidate,'bootstrap'));
 const updateCandidate=await json(join(update,'integrity-candidate.json')),archive017=join(update,'qicore-0.1.7-linux-x64.zip');
 assert.equal(updateCandidate.localRelease.format,'qicore-local-release-v2');assert.equal(updateCandidate.localRelease.version,'0.1.7');assert.equal(updateCandidate.localRelease.artifact.fromVersion,'0.1.6');
 const updateHash=await fileHash(archive017),updateReport=await json(join(update,'package-report.json'));
 assert.equal(updateReport.version,'0.1.7');assert.equal(updateReport.fromVersion,'0.1.6');assert.equal(updateReport.sha256,updateHash);assert.equal(updateCandidate.sha256,updateHash);assert.equal(updateCandidate.localRelease.artifact.sha256,updateHash);
 verifyNativeLocalRelease(official,updateCandidate.localRelease);
 const {format,...plain}=updateCandidate.localRelease;
 const target={...plain,publishedAt:new Date().toISOString(),artifact:{...plain.artifact,releaseId:'isolated_framework_017',downloadUrl:'/api/v1/updates/artifacts/isolated_framework_017'}};
 const root=await mkdtemp(join(tmpdir(),'qicore-photo-017-linux-'));await chmod(root,0o755);
 const f=fixture(root,{frameworkKey:key,version:release.version,initial:true,applicationPackageKey:PHOTO_KEY,applicationTenantLimit:2});Object.assign(f.product.archiveReleaseKeys,official.archiveReleaseKeys);
 const receipt=transitionReceipt(f);
 const c=f.state.config,url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');
 const database='qicore_photo_017_'+randomUUID().replaceAll('-','').slice(0,16);url.pathname='/'+database;
 const sql=statement=>{const result=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:statement,encoding:'utf8'});assert.equal(result.status,0,'Isolated MySQL operation failed')};
 sql('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+database+'`.* TO '+testDatabaseAccount()+';');
 const db=new PrismaClient({datasources:{db:{url:url.href}}}),processes=new Map(),processGroups=new Set(),exits=[];let passed=false;
 const apiPort=await port(),uiPort=await port(),origin='http://127.0.0.1:'+uiPort;
 Object.assign(c,{healthUrl:'http://127.0.0.1:'+apiPort+'/health',loginUrl:origin+'/admin/login',migrationUrl:url.href,runtimeUid:uid,runtimeGid:gid,installationSocket:join(root,'installation.sock')});
 await chmod(c.root,0o755);await chown(c.licenseStateRoot,uid,gid);for(const name of await readdir(c.licenseStateRoot))await chown(join(c.licenseStateRoot,name),uid,gid);
 const networkFile=join(root,'network.json'),networkEventsFile=join(root,'network-events.jsonl');
 await writeFile(networkEventsFile,'',{mode:0o600});await chown(networkEventsFile,uid,gid);
 const networkEvents=async()=>{const text=await readFile(networkEventsFile,'utf8');return text.trim()?text.trim().split('\n').map(line=>JSON.parse(line)):[]};
 const {original,compatible}=await readPhoto017Releases(inputs,official);
 // Original 0.1.6 signature is preserved; 0.1.7 has explicit photo integrity, never a fixture release signature.
 const releases=[{release:original,archive:inputs.original.path},{release:compatible,archive:inputs.compatible.path},{release:target,archive:archive017}];
 let network={instanceId:f.client.identity().instanceId,publicKey:f.client.identity().publicKey,receipt,applicationKey:PHOTO_KEY,releases};
 async function setNetwork(values){network={...network,...values};await writeFile(networkFile+'.tmp',JSON.stringify(network),{mode:0o644});await rename(networkFile+'.tmp',networkFile)}
 async function preparePlan(next,install=false){
  const installed=f.state.installed(),plans={},lifecyclePlans={},now=Date.now();
  for(const capability of ['native-full-v1','native-full-v2','native-full-v3']){
   if(next.artifact.integrity&&(capability==='native-full-v1'||next.artifact.integrity.format==='id-photo-release-integrity-v1'&&capability!=='native-full-v3'))continue;
   const plan=f.plan(next,installed,next.manifest.packageKey,capability);plan.generatedAt=new Date(now).toISOString();plan.validUntil=new Date(now+1800000).toISOString();plans[capability]=f.envelope(plan);
  }
  const operation=install?'install':'repair';
  if(next.manifest.type==='app')for(const capability of ['native-lifecycle-v1','native-lifecycle-v2']){
   if(capability==='native-lifecycle-v1'&&next.artifact.integrity)continue;
   lifecyclePlans[capability]=f.envelope({protocol:'license-api-v2',capability,operation,key_id:'receipt',planId:'plan_'+randomUUID(),licenseId:'license-test',licenseRevision:1,instanceId:f.client.identity().instanceId,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+1800000).toISOString(),productId:key,domain:'127.0.0.1',packageKey:PHOTO_KEY,installed,release:next});
  }
  await setNetwork({installed,targetPackageKey:next.manifest.packageKey,targetIntegrityFormat:next.artifact.integrity?.format??null,plans,lifecycleOperation:operation,lifecyclePlans});
 }
 await preparePlan(target);
 const env={...process.env,NODE_OPTIONS:'--import='+pathToFileURL(preload).href,QICORE_PHOTO_017_NETWORK_FILE:networkFile,QICORE_PHOTO_017_NETWORK_EVENTS:networkEventsFile,PAYMENT_EXECUTION_ENABLED:'false',WECHAT_SUBSCRIPTION_SEND_ENABLED:'false'};
 function run(command,args,options={}){
  const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe'],detached:true,...options});let stdout='',stderr='';
  if(child.pid)processGroups.add(child.pid);
  child.stdout.on('data',data=>stdout=(stdout+data).slice(-32768));child.stderr.on('data',data=>stderr=(stderr+data).slice(-32768));
  const done=new Promise((ok,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>ok({code,signal,stdout,stderr}))}).then(result=>{exits.push({entry:basename(args[0]||command),pid:child.pid,code:result.code,signal:result.signal,errorCodes:[...new Set((result.stderr.match(/\b[A-Z][A-Z_]{5,}\b/g)||[]))].slice(0,20)});return result},error=>{exits.push({entry:basename(args[0]||command),pid:child.pid,errorCode:error.code||'CHILD_START_FAILED'});throw error}).finally(()=>{
   processes.delete(child);
   if(child.pid)try{process.kill(-child.pid,0)}catch(error){if(error.code==='ESRCH')processGroups.delete(child.pid);else throw error}
  });processes.set(child,done);done.catch(()=>{});
  return {child,done,output:()=>stdout+'\n'+stderr};
 }
 async function stop(p){
  if(!p)return;const exited=p.child.exitCode!==null||p.child.signalCode!==null;
  const result=spawnSync('ps',['-eo','pid=,ppid=,pgid='],{encoding:'utf8'});assert.equal(result.status,0);
  const rows=result.stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),owned=new Set([p.child.pid,...rows.filter(([, ,group])=>group===p.child.pid).map(([pid])=>pid)]);
  for(let n=-1;n!==owned.size;){n=owned.size;for(const [pid,parent] of rows)if(owned.has(parent))owned.add(pid)}
  if(!exited&&p.legacyControllerStop){
   // The immutable 0.1.6 launcher group-signals its flock waiter. Stop its verified controller instead,
   // allowing that waiter and launcher to report the controller's actual orderly exit code.
   const controllers=[];
   for(const pid of owned){try{const argv=(await readFile('/proc/'+pid+'/cmdline','utf8')).split('\0');if(argv[0]===process.execPath&&argv[1]===join(live,'controller.mjs')&&argv[2]===configFile)controllers.push(pid)}catch(error){if(error.code!=='ENOENT')throw error}}
   assert.equal(controllers.length,1,'one actual controller in this launcher descendant tree is required');process.kill(controllers[0],'SIGTERM');
  }else if(!exited)p.child.kill('SIGTERM');
  let timer;try{await Promise.race([p.done,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('PROCESS_STOP_TIMEOUT')),80000)})])}finally{clearTimeout(timer)}
  assert.equal(p.child.exitCode,0,p.output());
  const exists=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
  for(let i=0;i<50&&[...owned].some(exists);i++)await delay(50);
  assert.deepEqual([...owned].filter(exists),[],'all launcher/controller/runtime descendants must stop');
  const lock=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73',join(controlRoot,'controller.lock'),'true'],{encoding:'utf8'});assert.equal(lock.status,0,lock.stderr);
  for(const url of [c.healthUrl,c.loginUrl])await assert.rejects(fetch(url,{signal:AbortSignal.timeout(2000)}),'API and SSR listeners must be closed');
 }

 class IsolatedHost extends NativeHost{async start(initial){const text=await readFile(c.environmentFile,'utf8');if(!text.includes('NODE_OPTIONS='))await appendFile(c.environmentFile,`NODE_OPTIONS="--import=${pathToFileURL(preload).href}"\nQICORE_PHOTO_017_NETWORK_FILE="${networkFile}"\nQICORE_PHOTO_017_NETWORK_EVENTS="${networkEventsFile}"\nPAYMENT_EXECUTION_ENABLED=false\nWECHAT_SUBSCRIPTION_SEND_ENABLED=false\n`);return super.start(initial)}}
 const host=new IsolatedHost(f.state),installClient=new LicenseClient(f.client.store,f.product,f.client.domain,async()=>{throw Error('TEST_EXTERNAL_NETWORK_BLOCKED')},true);
 async function bounded(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error(code)),ms)})])}finally{clearTimeout(timer)}}
 function ownedGroups(){
  const result=spawnSync('ps',['-eo','pid=,ppid=,pgid='],{encoding:'utf8'});assert.equal(result.status,0,'Cannot inventory task processes before cleanup');
  const rows=result.stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),owned=new Set([...processes.keys()].map(child=>child.pid).filter(pid=>Number.isInteger(pid)&&pid>0));
  // A launcher may have exited while a reparented descendant still occupies its detached process group.
  for(const [pid,,group] of rows)if(processGroups.has(group))owned.add(pid);
  // NativeHost's fixture child is not a CLI, but belongs to this test too.
  if(host.child?.pid)owned.add(host.child.pid);
  for(let count=-1;count!==owned.size;){count=owned.size;for(const [pid,parent] of rows)if(owned.has(parent))owned.add(pid)}
  return {pids:owned,groups:new Set(rows.filter(([pid,,group])=>owned.has(pid)&&processGroups.has(group)).map(row=>row[2]))};
 }
 t.after(async()=>{
  const owned=ownedGroups();let forced=false;
  for(const child of processes.keys()){try{child.kill('SIGTERM')}catch{}}
  try{await bounded(Promise.all([Promise.allSettled([...processes.values()]),host.stop()]),80000,'TEST_PROCESS_STOP_TIMEOUT')}
  catch{
   forced=true;for(const group of owned.groups){try{process.kill(-group,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}
   for(const pid of owned.pids){try{process.kill(pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}
   try{await bounded(Promise.allSettled([...processes.values()]),10000,'TEST_PROCESS_CLEANUP_FAILED')}
   catch(error){await writeFile(join(update,label+'-failure.json'),JSON.stringify({status:'cleanup-blocked',errorCode:error.message,processes:exits,ownedPids:[...owned.pids],productionAccess:false},null,2)+'\n');throw error}
  }
  // Never delete a database or tree while a task-owned child is alive.
  const alive=[...new Set([...owned.pids,...ownedGroups().pids])].filter(pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}});
  if(alive.length){await writeFile(join(update,label+'-failure.json'),JSON.stringify({status:'cleanup-blocked',alive,processes:exits,productionAccess:false},null,2)+'\n');throw Error('TEST_CHILDREN_STILL_ALIVE')}
  // This report contains only the fixture's explicit request/response allowlist, never network.json.
  await writeFile(join(update,label+'-network-report.json'),JSON.stringify({events:await networkEvents(),credentialsIncluded:false},null,2)+'\n',{mode:0o644});
  await db.$disconnect();
  if(!passed||forced)await writeFile(join(update,label+'-failure.json'),JSON.stringify({status:'failed',forcedProcessStop:forced,processes:exits,tasks:f.state.tasks(),active:f.state.active(key),productionAccess:false},null,2)+'\n');
  sql('DROP DATABASE `'+database+'`; REVOKE ALL PRIVILEGES ON `'+database+'`.* FROM '+testDatabaseAccount()+';');
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true});
  assert.equal(forced,false,'Task process stop exceeded the bounded graceful shutdown deadline');
 });
 const licenseOwnership=await Promise.all((await readdir(c.licenseStateRoot)).map(async name=>{const info=await lstat(join(c.licenseStateRoot,name));return{name,uid:info.uid,gid:info.gid,mode:info.mode&0o777}}));
 const result=await installNative(f.state,installClient,host,{requestId:randomUUID(),archive,release,administrator:{username:'transitionAdmin',password:'123456'},redisUrl:process.env.REDIS_URL,adminOrigin:origin,acceptTerms:true});
 assert.equal(result.status,'succeeded',JSON.stringify(result));await host.stop();
 for(const before of licenseOwnership){const info=await lstat(join(c.licenseStateRoot,before.name));assert.deepEqual({uid:info.uid,gid:info.gid,mode:info.mode&0o777},{uid:before.uid,gid:before.gid,mode:before.mode},'root installer must not rewrite runtime-owned authorization files')}
 const live=join(root,'bundle/bootstrap');await cp(bootstrap,live,{recursive:true});
 const store=new StateStore(join(root,'configuration')),configFile=store.path('bootstrap.json'),nativeFile=store.path('native.json'),controlRoot=join(root,'installer');await mkdir(controlRoot,{mode:0o700});
 function configure(){store.write('native.json',c);const {migrationUrl,...native}=c;store.write('bootstrap.json',{native,controlRoot,nativeConfigFile:nativeFile,archive,releaseFile:join(root,'release.json'),adminOrigin:origin,redisUrl:process.env.REDIS_URL})}
 await writeFile(join(root,'release.json'),JSON.stringify(release),{mode:0o600});configure();
 async function health(version=release.version){
  for(let i=0;i<150;i++){
   try{const r=await fetch(c.healthUrl,{signal:AbortSignal.timeout(2000)}),body=await r.json(),html=await(await fetch(c.loginUrl,{signal:AbortSignal.timeout(2000)})).text();if(r.ok&&body.ready===true&&body.mock!==true&&body.version===version&&body.components[key].manifestSha256===f.state.release(key,f.state.active(key).current).artifact.manifestSha256&&html.includes('<html'))return body}catch{}
   await delay(200);
  }throw Error('REAL_RUNTIME_HEALTH_TIMEOUT');
 }
 const launch=async(version=release.version)=>{const p=run(process.execPath,[join(live,'start.mjs'),configFile]);p.legacyControllerStop=(await json(join(live,'bootstrap-manifest.json'))).version==='0.1.6';await health(version);assert.equal(p.child.exitCode,null,p.output());return p};
 async function waitTask(id){for(let i=0;i<1800;i++){const task=f.state.tasks().find(v=>v.id===id);if(task&&task.status!=='running')return task;await delay(100)}throw Error('UPDATE_TASK_TIMEOUT')}
 const identityHash=hash(await readFile(join(c.licenseStateRoot,'identity.json')));
 return {root,f,c,db,live,configFile,nativeFile,controlRoot,networkFile,networkEvents,configure,run,stop,health,launch,waitTask,identityHash,original,compatible,target,preparePlan,setNetwork,archive017,pass:()=>{passed=true}};
}
