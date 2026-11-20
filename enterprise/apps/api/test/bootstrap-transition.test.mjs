import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {fixture,hash} from './fixtures/native-release.mjs';
import {transitionBootstrap,verifyTransitionCandidate} from '../../../scripts/transition-bootstrap.mjs';
import {verifyTransitionInstallation} from '../dist/lifecycle/bootstrap-transition-check.js';

async function tree(root,version,extra={}){
 await mkdir(root,{recursive:true});
 const files={'start.mjs':'// start','controller.mjs':'// controller','transition-check.mjs':`export {verifyTransitionInstallation} from ${JSON.stringify(new URL('../dist/lifecycle/bootstrap-transition-check.js',import.meta.url).href)};`,'package.json':JSON.stringify({name:'qicore-bootstrap',version}),...extra};
 for(const [path,bytes] of Object.entries(files))await writeFile(join(root,path),bytes);
 const manifest={format:'qicore-bootstrap-v1',product:'qicore',packageKey:'frm_cdm43f43e7yhk5jd',version,updatePlanCapability:'native-full-v3',applicationLifecycleCapability:'native-lifecycle-v2',initialReleaseFormat:'qicore-initial-release-v2',supportedReleaseFormats:['qicore-initial-release-v1','qicore-initial-release-v2','qicore-local-release-v1','qicore-local-release-v2','qilicense-release-v2'],files:Object.entries(files).map(([path,bytes])=>({path,size:Buffer.byteLength(bytes),sha256:hash(bytes)}))};
 const bytes=JSON.stringify(manifest);await writeFile(join(root,'bootstrap-manifest.json'),bytes);return hash(bytes);
}
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'qicore-transition-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root,{frameworkKey:'frm_cdm43f43e7yhk5jd'}),release=f.release(f.product.appKey,'1.0.0','0.0.0');await f.install(release);f.state.component(f.product.appKey).write('installation.json',{status:'succeeded'});
 const privateRoot=join(root,'private'),controlRoot=join(root,'control');await mkdir(privateRoot);await mkdir(controlRoot);
 const native={...f.state.config,installationSocket:join(root,'install.sock')},nativeConfigFile=join(privateRoot,'native.json');await writeFile(nativeConfigFile,JSON.stringify(native));
 const {migrationUrl,...base}=native,config={native:base,nativeConfigFile,controlRoot,archive:join(root,'incoming.zip'),releaseFile:join(root,'release.json'),adminOrigin:'https://fixture.example',redisUrl:'redis://127.0.0.1:6379/0'};
 const input={bootstrapRoot:join(root,'bootstrap'),candidateRoot:join(root,'candidate'),config:join(privateRoot,'bootstrap.json'),version:'2.0.0'};await writeFile(input.config,JSON.stringify(config));
 await tree(input.bootstrapRoot,'1.0.0',{'delivery.json':'{"customer":"preserved"}'});input.manifestSha256=await tree(input.candidateRoot,input.version);
 const protectedFiles=[input.config,nativeConfigFile,join(f.state.config.stateRoot,f.product.appKey,'active.json'),join(f.state.config.stateRoot,f.product.appKey,`release-${release.release.artifact.manifestSha256}.json`)];
 const before=await Promise.all(protectedFiles.map(p=>readFile(p)));
 return{root,f,input,config,release,unchanged:async()=>assert.deepEqual(await Promise.all(protectedFiles.map(p=>readFile(p))),before)};
}

test('bootstrap transition validates pinned bytes, identity and protocol before switching',async t=>{
 const {input}=await setup(t);
 await verifyTransitionCandidate(input.candidateRoot,input.manifestSha256,input.version);
 await assert.rejects(verifyTransitionCandidate(input.candidateRoot,'0'.repeat(64),input.version),/DIGEST_MISMATCH/);
 await assert.rejects(verifyTransitionCandidate(input.candidateRoot,input.manifestSha256,'3.0.0'),/PRODUCT_VERSION/);
 const path=join(input.candidateRoot,'bootstrap-manifest.json'),original=await readFile(path,'utf8');
 for(const change of [{product:'other'},{packageKey:'frm_other'},{supportedReleaseFormats:[]},{updatePlanCapability:'native-full-v1'},{updatePlanCapability:'native-full-v2'},{applicationLifecycleCapability:'native-lifecycle-v1'}]){
  const bytes=JSON.stringify({...JSON.parse(original),...change});await writeFile(path,bytes);
  await assert.rejects(verifyTransitionCandidate(input.candidateRoot,hash(bytes),input.version),/PRODUCT_VERSION|PROTOCOL/);
 }
 await writeFile(path,original);
 await writeFile(join(input.candidateRoot,'controller.mjs'),'tampered');await assert.rejects(transitionBootstrap('apply',input),/INVENTORY_MISMATCH|FILE_CHANGED/);
 assert.equal(await readFile(join(input.bootstrapRoot,'controller.mjs'),'utf8'),'// controller');
});

test('standalone transition bundle has no imported launcher side effects or runtime dependencies',async()=>{
 for(const name of ['../../../scripts/transition-bootstrap.mjs','../dist/lifecycle/bootstrap-transition-check.js']){
  const result=await build({entryPoints:[fileURLToPath(new URL(name,import.meta.url))],bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node24'});
  const inputs=Object.keys(result.metafile.inputs);assert.ok(inputs.every(path=>!path.endsWith('native-start.mjs')));
  assert.equal(spawnSync(process.execPath,['--check','--input-type=module'],{input:result.outputFiles[0].text,encoding:'utf8',windowsHide:true}).status,0);
 }
});

test('old signed active files remain unchanged and rollback restores bootstrap after either rename failure',async t=>{
 const {input,unchanged}=await setup(t);
 for(const hook of ['afterOldMoved','afterSwitched']){
  await assert.rejects(transitionBootstrap('apply',input,{[hook]:()=>{throw Error('INJECTED_FAILURE')}}),/INJECTED_FAILURE/);
  assert.equal(JSON.parse(await readFile(join(input.bootstrapRoot,'package.json'),'utf8')).version,'1.0.0');await unchanged();
 }
 const result=await transitionBootstrap('apply',input);assert.equal(result.status,'switched');
 assert.equal(await readFile(join(input.bootstrapRoot,'delivery.json'),'utf8'),'{"customer":"preserved"}');
 assert.equal((await transitionBootstrap('recover',input)).status,'rolled_back');await unchanged();
});

test('a crash between directory renames is recoverable using the durable prepared record',async t=>{
 const {root,input,unchanged}=await setup(t),j=await transitionBootstrap('apply',input);
 // Emulate power loss after the old directory rename but before installing the staged tree.
 await rename(input.bootstrapRoot,join(root,'.qicore-bootstrap-candidate-'+j.taskId));j.status='prepared';delete j.switchedAt;
 await writeFile(join(root,'control/bootstrap-transition.json'),JSON.stringify(j));
 assert.equal((await transitionBootstrap('recover',input)).status,'rolled_back');await unchanged();
});

test('interrupted staging has a journal-bound cleanup path and refuses foreign files',async t=>{
 const {input,unchanged}=await setup(t);let staged;
 await assert.rejects(transitionBootstrap('apply',input,{beforeCopy:async path=>{
  staged=path;await mkdir(path);await writeFile(join(path,'controller.mjs'),'// cont');throw Error('COPY_INTERRUPTED');
 }}),/COPY_INTERRUPTED/);
 await writeFile(join(staged,'unrelated.txt'),'preserve');
 await assert.rejects(transitionBootstrap('recover',input),/PARTIAL_TREE_CHANGED/);
 assert.equal(await readFile(join(staged,'unrelated.txt'),'utf8'),'preserve');await unchanged();
 await rm(join(staged,'unrelated.txt'));assert.equal((await transitionBootstrap('recover',input)).status,'rolled_back');await assert.rejects(access(staged),/ENOENT/);
 await assert.rejects(transitionBootstrap('apply',input,{afterCopy:()=>{throw Error('SYNC_INTERRUPTED')}}),/SYNC_INTERRUPTED/);
 assert.equal((await transitionBootstrap('recover',input)).status,'rolled_back');await unchanged();
});

test('consecutive attempts retain prior receipts and never overwrite conflicting history',async t=>{
 const {input,config,unchanged}=await setup(t);
 await transitionBootstrap('apply',input);const first=await transitionBootstrap('recover',input);
 const journal=join(config.controlRoot,'bootstrap-transition.json'),before=await readFile(journal),history=join(config.controlRoot,'bootstrap-transition-'+first.taskId+'.json');
 await writeFile(history,'conflicting evidence');
 await assert.rejects(transitionBootstrap('apply',input),/HISTORY_CONFLICT/);
 assert.equal(await readFile(history,'utf8'),'conflicting evidence');assert.deepEqual(await readFile(journal),before);
 await rm(history);await transitionBootstrap('apply',input);assert.deepEqual(await readFile(history),before);
 await transitionBootstrap('recover',input);await transitionBootstrap('apply',input);
 assert.deepEqual(await readFile(history),before);await transitionBootstrap('recover',input);await unchanged();
});

test('historical blocked preparation tasks allow transition without rewriting protected state or task history',async t=>{
 const {input,f,unchanged}=await setup(t),store=f.state.component(f.product.appKey),path=join(store.root,'tasks.json');
 store.write('tasks.json',[
  {id:'historical-maintenance',createdAt:'2026-10-24T19:59:26.486Z',status:'blocked',step:'MAINTENANCE',code:'BACKUP_KEY_MISSING'},
  {id:'historical-compatibility',createdAt:'2026-10-27T15:21:38.738Z',status:'blocked',step:'COMPATIBILITY',code:'MIGRATION_HISTORY_CHANGED'},
 ]);
 const before=await readFile(path);
 assert.equal((await transitionBootstrap('apply',input)).status,'switched');await unchanged();assert.deepEqual(await readFile(path),before);
 assert.equal((await transitionBootstrap('recover',input)).status,'rolled_back');await unchanged();assert.deepEqual(await readFile(path),before);
});

test('transition rejects broken historical signatures despite terminal blocked tasks and rejects nonterminal or unknown states',async t=>{
 const {input,f,release}=await setup(t),store=f.state.component(f.product.appKey),name=`release-${release.release.artifact.manifestSha256}.json`;
 const blocked={id:'historical-blocked',createdAt:'2026-10-24T19:59:26.486Z',status:'blocked',step:'COMPATIBILITY'};store.write('tasks.json',[blocked]);
 const bad=structuredClone(release.release);bad.artifact.signatureEnvelope.signature='a'.repeat(86);store.write(name,bad);
 await assert.rejects(transitionBootstrap('apply',input),/SIGNATURE_INVALID|base64/);store.write(name,release.release);
 for(const status of ['running','recovery_required','unknown']){
  store.write('tasks.json',[blocked,{id:'pending',createdAt:new Date().toISOString(),status}]);
  const before=await readFile(join(store.root,'tasks.json'));
  await assert.rejects(transitionBootstrap('apply',input),/RECOVERY_REQUIRED/);
  assert.deepEqual(await readFile(join(store.root,'tasks.json')),before);
  await assert.rejects(access(join(input.bootstrapRoot,'..','control','bootstrap-transition.json')),/ENOENT/);
 }
});

test('cleanup requires matching readiness and strict public Host login health without accepting redirects or invalid HTML',async t=>{
 const {root,input,config,release}=await setup(t);let loginMode='valid';const hosts=[];
 const server=createServer((req,res)=>{
  if(req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ready:true,version:'1.0.0',components:{frm_cdm43f43e7yhk5jd:{version:'1.0.0',manifestSha256:release.release.artifact.manifestSha256}}}));return}
  hosts.push(req.headers.host);
  if(req.headers.host!=='fixture.example'||loginMode==='wrong-host'){res.statusCode=404;res.end('unknown host');return}
  if(loginMode==='redirect'){res.statusCode=302;res.setHeader('location','/unaccepted-redirect');res.end();return}
  res.setHeader('content-type',loginMode==='wrong-type'?'text/plain':'text/html');res.end(loginMode==='invalid-html'?'not a login page':'<html>login</html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 // The native verifier requires both private configurations to agree.
 const url=`http://127.0.0.1:${server.address().port}`;config.native.healthUrl=url+'/health';config.native.loginUrl=url+'/login';
 const native=JSON.parse(await readFile(config.nativeConfigFile,'utf8'));Object.assign(native,config.native);await writeFile(config.nativeConfigFile,JSON.stringify(native));await writeFile(input.config,JSON.stringify(config));
 const beforeConfig=await readFile(input.config,'utf8'),j=await transitionBootstrap('apply',input);
 await assert.rejects(transitionBootstrap('complete',input),/ENOENT/);await access(join(root,'.qicore-bootstrap-previous'));
 const receipt={format:'qicore-bootstrap-ready-v1',manifestSha256:j.manifestSha256,pid:process.pid,readyAt:new Date().toISOString(),installed:await verifyTransitionInstallation(input.config)};
 await writeFile(join(config.controlRoot,'bootstrap-ready.json'),JSON.stringify({...receipt,manifestSha256:'0'.repeat(64)}));
 await assert.rejects(transitionBootstrap('complete',input),/READINESS_REQUIRED/);
 await writeFile(join(config.controlRoot,'bootstrap-ready.json'),JSON.stringify(receipt));
 const switchedBytes=await readFile(join(config.controlRoot,'bootstrap-transition.json'));
 for(const mode of ['wrong-host','redirect','wrong-type','invalid-html']){
  loginMode=mode;const beforeRequests=hosts.length;
  await assert.rejects(transitionBootstrap('complete',input),/BOOTSTRAP_HEALTH_FAILED/);
  assert.equal(hosts.length,beforeRequests+1,'redirects must not be followed');assert.equal(hosts.at(-1),'fixture.example');
  assert.deepEqual(await readFile(join(config.controlRoot,'bootstrap-transition.json')),switchedBytes);await access(join(root,'.qicore-bootstrap-previous'));
 }
 loginMode='valid';const completed=await transitionBootstrap('complete',input);assert.equal(completed.status,'complete');assert.equal(hosts.at(-1),'fixture.example');
 await assert.rejects(access(join(root,'.qicore-bootstrap-previous')),/ENOENT/);assert.equal(await readFile(input.config,'utf8'),beforeConfig);
 await access(config.native.licenseStateRoot);await access(config.native.stateRoot);
 const completedBytes=await readFile(join(config.controlRoot,'bootstrap-transition.json'));await transitionBootstrap('apply',input);
 assert.deepEqual(await readFile(join(config.controlRoot,'bootstrap-transition-'+completed.taskId+'.json')),completedBytes);
 await transitionBootstrap('recover',input);
});
