import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,appendFile,cp,chmod,chown,readdir,rm,access,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {fixture,hash} from './fixtures/native-release.mjs';
import {transitionReceipt} from './fixtures/native-transition-receipt.mjs';
import {seedTerminalTransitionHistory} from './fixtures/terminal-transition-history.mjs';
import {testMysqlClient,testDatabaseAccount} from './fixtures/mysql-tools.mjs';
import {NativeHost} from '../dist/lifecycle/native-host.js';
import {installNative} from '../dist/lifecycle/native-installation.js';
import {StateStore} from '../dist/license/store.js';
import {LicenseClient} from '../dist/license/client.js';
import {updaterRequest} from '../dist/lifecycle/updater-client.js';

assert.equal(process.platform,'linux');assert.equal(process.getuid(),0,'Run through sudo with an explicit non-root runtime identity');
for(const key of ['NATIVE_BASELINE_PACKAGE_DIR','NATIVE_PACKAGE_DIR','NATIVE_UPDATE_PACKAGE_DIR','TEST_DATABASE_URL','TEST_RESTORE_ROOT_CONFIG','REDIS_URL','QICORE_TEST_RUNTIME_UID','QICORE_TEST_RUNTIME_GID'])assert.ok(process.env[key],key+' required');
const uid=Number(process.env.QICORE_TEST_RUNTIME_UID),gid=Number(process.env.QICORE_TEST_RUNTIME_GID);assert.ok(uid>0&&gid>0);
const baseline=resolve(process.env.NATIVE_BASELINE_PACKAGE_DIR),candidate=resolve(process.env.NATIVE_PACKAGE_DIR),update=resolve(process.env.NATIVE_UPDATE_PACKAGE_DIR);
const key='frm_cdm43f43e7yhk5jd',json=async file=>JSON.parse(await readFile(file,'utf8')),delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const port=()=>new Promise(ok=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const value=s.address().port;s.close(()=>ok(value))})});
const preload=fileURLToPath(new URL('./fixtures/native-transition-network.mjs',import.meta.url));
const initialCandidate=await json(join(candidate,'integrity-candidate.json')),updateCandidate=await json(join(update,'integrity-candidate.json'));
assert.equal(initialCandidate.initialRelease.format,'qicore-initial-release-v2');assert.equal(updateCandidate.localRelease.format,'qicore-local-release-v2');
assert.equal(updateCandidate.localRelease.artifact.fromVersion,'0.1.6');assert.equal(updateCandidate.localRelease.version,'0.1.7');
const official=await json(new URL('../../../config/license-product.json',import.meta.url));
const publishedFixture=()=>{const {format,...r}=updateCandidate.localRelease;return {...r,publishedAt:new Date().toISOString(),artifact:{...r.artifact,releaseId:'isolated_framework_017',downloadUrl:'/api/v1/updates/artifacts/isolated_framework_017'}}};

async function environment(t,release,archive,bootstrap,label){
 const root=await mkdtemp(join(tmpdir(),'qicore-transition-linux-'));await chmod(root,0o755);
 const f=fixture(root,{frameworkKey:key,version:release.version,initial:true});Object.assign(f.product.archiveReleaseKeys,official.archiveReleaseKeys);
 const receipt=transitionReceipt(f);
 const c=f.state.config,url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');
 const database='qicore_transition_'+randomUUID().replaceAll('-','').slice(0,16);url.pathname='/'+database;
 const sql=statement=>{const result=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:statement,encoding:'utf8'});assert.equal(result.status,0,'Isolated MySQL operation failed')};
 sql('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+database+'`.* TO '+testDatabaseAccount()+';');
 const db=new PrismaClient({datasources:{db:{url:url.href}}}),processes=new Map(),exits=[];let passed=false;
 const apiPort=await port(),uiPort=await port(),origin='http://127.0.0.1:'+uiPort;
 Object.assign(c,{healthUrl:'http://127.0.0.1:'+apiPort+'/health',loginUrl:origin+'/admin/login',migrationUrl:url.href,runtimeUid:uid,runtimeGid:gid,installationSocket:join(root,'installation.sock')});
 await chmod(c.root,0o755);await chown(c.licenseStateRoot,uid,gid);for(const name of await readdir(c.licenseStateRoot))await chown(join(c.licenseStateRoot,name),uid,gid);
 const networkFile=join(root,'network.json'),target=publishedFixture(),plan=f.plan(target,[{packageKey:key,version:'0.1.6'}]);plan.validUntil=new Date(Date.now()+3600000).toISOString();
 const plans=Object.fromEntries(['native-full-v2','native-full-v3'].map(capability=>[capability,f.envelope({...plan,nativeContext:{...plan.nativeContext,capability}})]));
 await writeFile(networkFile,JSON.stringify({instanceId:f.client.identity().instanceId,publicKey:f.client.identity().publicKey,receipt,release:target,archive:updateCandidate.archive,installed:plan.nativeContext.installed,plans}),{mode:0o644});
 const env={...process.env,NODE_OPTIONS:'--import='+pathToFileURL(preload).href,QICORE_TRANSITION_NETWORK_FILE:networkFile};
 function run(command,args,options={}){
  const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe'],detached:true,...options});let stdout='',stderr='';
  child.stdout.on('data',data=>stdout=(stdout+data).slice(-32768));child.stderr.on('data',data=>stderr=(stderr+data).slice(-32768));
  const done=new Promise((ok,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>ok({code,signal,stdout,stderr}))}).then(result=>{exits.push({entry:basename(args[0]||command),pid:child.pid,code:result.code,signal:result.signal,errorCodes:[...new Set((result.stderr.match(/\b[A-Z][A-Z_]{5,}\b/g)||[]))].slice(0,20)});return result},error=>{exits.push({entry:basename(args[0]||command),pid:child.pid,errorCode:error.code||'CHILD_START_FAILED'});throw error}).finally(()=>processes.delete(child));processes.set(child,done);done.catch(()=>{});
  return {child,done,output:()=>stdout+'\n'+stderr};
 }
 async function stop(p){
  if(!p)return;if(p.child.exitCode!==null||p.child.signalCode!==null){assert.equal((await p.done).code,0,p.output());return;}
  const result=spawnSync('ps',['-eo','pid=,ppid='],{encoding:'utf8'});assert.equal(result.status,0);
  const rows=result.stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),owned=new Set([p.child.pid]);
  for(let n=-1;n!==owned.size;){n=owned.size;for(const [pid,parent] of rows)if(owned.has(parent))owned.add(pid)}
  if(p.legacyControllerStop){
   // The immutable 0.1.6 launcher group-signals its flock waiter. Stop its verified controller instead,
   // allowing that waiter and launcher to report the controller's actual orderly exit code.
   const controllers=[];
   for(const pid of owned){try{const argv=(await readFile('/proc/'+pid+'/cmdline','utf8')).split('\0');if(argv[0]===process.execPath&&argv[1]===join(live,'controller.mjs')&&argv[2]===configFile)controllers.push(pid)}catch(error){if(error.code!=='ENOENT')throw error}}
   assert.equal(controllers.length,1,'one actual controller in this launcher descendant tree is required');process.kill(controllers[0],'SIGTERM');
  }else p.child.kill('SIGTERM');
  let timer;try{await Promise.race([p.done,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('PROCESS_STOP_TIMEOUT')),80000)})])}finally{clearTimeout(timer)}
  assert.equal(p.child.exitCode,0,p.output());
  const exists=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
  for(let i=0;i<50&&[...owned].some(exists);i++)await delay(50);
  assert.deepEqual([...owned].filter(exists),[],'all launcher/controller/runtime descendants must stop');
  const lock=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73',join(controlRoot,'controller.lock'),'true'],{encoding:'utf8'});assert.equal(lock.status,0,lock.stderr);
  for(const url of [c.healthUrl,c.loginUrl])await assert.rejects(fetch(url,{signal:AbortSignal.timeout(2000)}),'API and SSR listeners must be closed');
 }

 class IsolatedHost extends NativeHost{async start(initial){const text=await readFile(c.environmentFile,'utf8');if(!text.includes('NODE_OPTIONS='))await appendFile(c.environmentFile,`NODE_OPTIONS="--import=${pathToFileURL(preload).href}"\nQICORE_TRANSITION_NETWORK_FILE="${networkFile}"\n`);return super.start(initial)}}
 const host=new IsolatedHost(f.state),installClient=new LicenseClient(f.client.store,f.product,f.client.domain,async()=>{throw Error('TEST_EXTERNAL_NETWORK_BLOCKED')},true);
 async function bounded(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error(code)),ms)})])}finally{clearTimeout(timer)}}
 function ownedGroups(){
  const result=spawnSync('ps',['-eo','pid=,ppid=,pgid='],{encoding:'utf8'});assert.equal(result.status,0,'Cannot inventory task processes before cleanup');
  const rows=result.stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),owned=new Set([...processes.keys()].map(child=>child.pid).filter(pid=>Number.isInteger(pid)&&pid>0));
  // NativeHost's fixture child is not a CLI, but belongs to this test too.
  if(host.child?.pid)owned.add(host.child.pid);
  for(let count=-1;count!==owned.size;){count=owned.size;for(const [pid,parent] of rows)if(owned.has(parent))owned.add(pid)}
  return {pids:owned,groups:new Set(rows.filter(([pid,,group])=>owned.has(pid)&&owned.has(group)).map(row=>row[2]))};
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
  const alive=[...owned.pids].filter(pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}});
  if(alive.length){await writeFile(join(update,label+'-failure.json'),JSON.stringify({status:'cleanup-blocked',alive,processes:exits,productionAccess:false},null,2)+'\n');throw Error('TEST_CHILDREN_STILL_ALIVE')}
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
 async function waitTask(id){for(let i=0;i<1200;i++){const task=f.state.tasks().find(v=>v.id===id);if(task&&task.status!=='running')return task;await delay(100)}throw Error('UPDATE_TASK_TIMEOUT')}
 const identityHash=hash(await readFile(join(c.licenseStateRoot,'identity.json')));
 return {root,f,c,db,live,configFile,nativeFile,controlRoot,networkFile,configure,run,stop,health,launch,waitTask,identityHash,pass:()=>{passed=true}};
}

test('ordinary initial v2 installs real Linux code and restarts through the root launcher with non-root runtime',{timeout:240000},async t=>{
 const e=await environment(t,initialCandidate.initialRelease,initialCandidate.archive,join(candidate,'bootstrap'),'plain-initial');
 assert.equal(e.f.state.installed().length,1);assert.equal(await e.db.adminAccount.count(),1);
 const p=await e.launch('0.1.7');const duplicate=await e.run(process.execPath,[join(e.live,'start.mjs'),e.configFile]).done;assert.equal(duplicate.code,73,duplicate.stderr);
 const login=await fetch(e.c.healthUrl.replace('/health','/api/v1/admin/auth/login'),{method:'POST',headers:{origin:new URL(e.c.loginUrl).origin,'content-type':'application/json'},body:JSON.stringify({username:'transitionAdmin',password:'123456',portal:'admin'})});assert.equal(login.status,200);
 await e.stop(p);const restarted=await e.launch('0.1.7');await e.stop(restarted);
 await writeFile(join(update,'plain-initial-report.json'),JSON.stringify({status:'passed',format:'qicore-initial-release-v2',version:'0.1.7',linuxRuntime:true,login:true,stableRestart:true,flockConflictExitCode:73,rootController:true,runtimeUid:uid,productionAccess:false},null,2)+'\n');e.pass();
});

for(const mode of ['online','local'])test('exact signed 0.1.6 bootstrap transitions and upgrades through ordinary '+mode+' material',{timeout:600000},async t=>{
 const old=await json(join(baseline,'initial-release.json'));assert.equal(old.format,'qicore-initial-release-v1');assert.equal(old.version,'0.1.6');
 const e=await environment(t,old,join(baseline,'qicore-0.1.6-linux-x64.zip'),join(baseline,'bootstrap'),'transition-'+mode);
 const {root,f,c,db,live,configFile,nativeFile,controlRoot}=e;
 const terminalHistory=seedTerminalTransitionHistory(f.state,[key]);
 await db.tenant.create({data:{id:'transition-tenant',name:'过渡保留数据'}});
 const history=await db.$queryRawUnsafe('SELECT id,migration_name,checksum,finished_at FROM _prisma_migrations ORDER BY migration_name,id');
 const protectedPaths=[configFile,nativeFile,join(c.licenseStateRoot,'identity.json'),join(c.stateRoot,key,'release-'+old.artifact.manifestSha256+'.json')];
 const protectedBytes=await Promise.all(protectedPaths.map(path=>readFile(path)));
 const transitionTool=join(root,'transition.mjs');await cp(join(candidate,'bootstrap/transition.mjs'),transitionTool);
 const inputFile=join(root,'transition-input.json'),input={bootstrapRoot:live,candidateRoot:join(candidate,'bootstrap'),config:configFile,version:'0.1.7',manifestSha256:hash(await readFile(join(candidate,'bootstrap/bootstrap-manifest.json')))};
 await writeFile(inputFile,JSON.stringify(input));
 const transition=op=>e.run(process.execPath,[transitionTool,op,inputFile]);
 const oldEntry=await e.launch();assert.equal((await transition('apply').done).code,73,'real controller flock blocks replacement');await e.stop(oldEntry);
 // Test-only hook driver runs under the actual OS lock. The production CLI has no fault switches.
 if(mode==='online')for(const phase of ['staging','renamed']){
  const child=e.run('flock',['--exclusive','--nonblock','--conflict-exit-code','73',join(controlRoot,'controller.lock'),process.execPath,fileURLToPath(new URL('./fixtures/native-transition-crash.mjs',import.meta.url)),transitionTool,inputFile,phase],{detached:true});
  for(let i=0;i<200&&!child.output().includes('TRANSITION_CRASH_CHECKPOINT');i++){assert.equal(child.child.exitCode,null,child.output());await delay(50)}
  assert.match(child.output(),/TRANSITION_CRASH_CHECKPOINT/);process.kill(-child.child.pid,'SIGKILL');await child.done;
  const recovered=await transition('recover').done;assert.equal(recovered.code,0,recovered.stderr);assert.equal((await json(join(controlRoot,'bootstrap-transition.json'))).status,'rolled_back');
  const restarted=await e.launch();await e.stop(restarted);
 }
 const applied=await transition('apply').done;assert.equal(applied.code,0,applied.stderr);
 assert.notEqual((await transition('complete').done).code,0,'no new-controller receipt means no cleanup');await access(join(root,'bundle/.qicore-bootstrap-previous'));
 let entry=await e.launch();
 for(let i=0;i<150;i++){try{const ready=await json(join(controlRoot,'bootstrap-ready.json'));if(ready.manifestSha256===(await json(join(controlRoot,'bootstrap-transition.json'))).manifestSha256)break}catch{}await delay(100);if(i===149)throw Error('BOOTSTRAP_READY_RECEIPT_TIMEOUT')}
 assert.deepEqual(await Promise.all(protectedPaths.map(path=>readFile(path))),protectedBytes,'transition preserves configuration, identity and signed history');
 const complete=await transition('complete').done;assert.equal(complete.code,0,complete.stderr);assert.equal((await json(join(controlRoot,'bootstrap-transition.json'))).status,'complete');
 terminalHistory.assertFilesUnchanged();
 await assert.rejects(access(join(root,'bundle/.qicore-bootstrap-previous')),/ENOENT/);
 const ps=spawnSync('ps',['-eo','uid=,gid=,args='],{encoding:'utf8'});assert.equal(ps.status,0);assert.ok(ps.stdout.split('\n').some(line=>new RegExp('^\\s*'+uid+'\\s+'+gid+'\\s').test(line)&&line.includes('native-worker.js')),'actual runtime worker must use the non-root identity');
 const localFile=join(root,'local-release.json');await writeFile(localFile,JSON.stringify(updateCandidate.localRelease));
 const localEntry=join(candidate,'runtime/apps/api/dist/lifecycle/native-local-update.js');
 const execute=async()=>{
  const id=randomUUID();
  if(mode==='local'){const result=await e.run(process.execPath,[localEntry,configFile,localFile,updateCandidate.archive,id]).done;return {result,task:await e.waitTask(id)}}
  await updaterRequest('/execute',{requestId:id,packageKey:key,targetVersion:'0.1.7',manifestSha256:updateCandidate.localRelease.artifact.manifestSha256},c.socket);return {task:await e.waitTask(id)};
 };
 // A real mysqldump failure must recover the old runtime without advancing the receipt.
 await e.stop(entry);const normalDump=c.mysqldump,failure=join(root,'dump-failure.sh');await writeFile(failure,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "mysqldump fixture"; exit 0; fi\nexit 17\n',{mode:0o755});c.mysqldump=failure;e.configure();
 if(mode==='online')entry=await e.launch();const failed=await execute();assert.equal(failed.task.status,'rolled_back',JSON.stringify(failed.task));if(mode==='local')assert.equal(failed.result.code,1,failed.result.stderr);
 if(mode==='online'){await e.health();await e.stop(entry)}else{entry=await e.launch();await e.stop(entry)}
 assert.equal(f.state.active(key).current.version,'0.1.6');assert.equal((await db.tenant.findUnique({where:{id:'transition-tenant'}})).name,'过渡保留数据');
 c.mysqldump=normalDump;e.configure();
 const transportFixture=await json(e.networkFile);await writeFile(e.networkFile,JSON.stringify({...transportFixture,failRuntimeVersion:'0.1.7'}));
 if(mode==='online')entry=await e.launch();const unhealthy=await execute();assert.equal(unhealthy.task.status,'rolled_back',JSON.stringify(unhealthy.task));if(mode==='local')assert.equal(unhealthy.result.code,1,unhealthy.result.stderr);
 if(mode==='online'){await e.health();await e.stop(entry)}else{entry=await e.launch();await e.stop(entry)}
 assert.equal(f.state.active(key).current.version,'0.1.6');
 const retainedNativeHistory=await db.$queryRawUnsafe('SELECT package_key,migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',key);
 assert.deepEqual(retainedNativeHistory.map(row=>({id:row.migration_id,sha256:row.sha256,finished:!!row.finished})),updateCandidate.localRelease.migrations.map(m=>({id:m.id,sha256:m.sha256,finished:true})));
 await writeFile(e.networkFile,JSON.stringify(transportFixture));
 if(mode==='online')entry=await e.launch();
 const good=await execute();assert.equal(good.task.status,'succeeded',JSON.stringify(good.task));if(mode==='local')assert.equal(good.result.code,0,good.result.stderr);
 if(mode==='online'){await e.health('0.1.7');await e.stop(entry)}
 entry=await e.launch('0.1.7');await e.stop(entry);
 assert.deepEqual(await db.$queryRawUnsafe('SELECT package_key,migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=? ORDER BY migration_id',key),retainedNativeHistory,'retry must preserve every completed native alias without replacing or rerunning it');
 assert.equal(f.state.active(key).previous,null);assert.equal((await readdir(join(f.state.directory(key),'releases'))).length,1);
 assert.deepEqual(await db.$queryRawUnsafe('SELECT id,migration_name,checksum,finished_at FROM _prisma_migrations ORDER BY migration_name,id'),history);
 assert.equal(hash(await readFile(join(c.licenseStateRoot,'identity.json'))),e.identityHash);assert.equal(await db.tenant.count({where:{id:'transition-tenant'}}),1);
 assert.notEqual((await transition('recover').done).code,0,'completed transition never reactivates the old controller after a plain runtime update');
 terminalHistory.assertPreserved();
 await writeFile(join(update,'bootstrap-transition-'+mode+'-report.json'),JSON.stringify({status:'passed',terminalHistory:{...terminalHistory.report,transitionFileBytesPreserved:true},oldRuntime:'0.1.6',newRuntime:'0.1.7',oldReleaseFormat:old.format,oldRuntimeSha256:old.artifact.sha256,transition:'real CLI and flock',legacyStop:'verified controller SIGTERM; original launcher exit 0; all descendants/listeners stopped and lock released',crashRecovery:mode==='online'?['SIGKILL staging','SIGKILL between directory renames']:[],bootstrapReceipt:'complete after real controller readiness and health',newReleaseFormat:mode==='local'?'qicore-local-release-v2':'native-full-v3 plan + integrity',backupFailure:'rolled back; old runtime restarted',candidateHealthFailure:'rolled back; old runtime restarted',configurationAndIdentityPreserved:true,prismaHistoryPreserved:true,nativeHistoryAfterRollbackPreserved:true,currentOnly:true,actualApplication:'not tested by this fixture-only gate',productionAccess:false},null,2)+'\n');e.pass();
});
