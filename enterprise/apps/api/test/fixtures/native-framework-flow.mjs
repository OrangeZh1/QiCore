import assert from 'node:assert/strict';
import {cp,readFile,writeFile,readdir,rm,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../dist/license/contracts.js';
import {nativeUpdateCapability} from '../../dist/license/native-updates.js';

export function frameworkFlowAuthority(f,release,key){
 return async(path,body)=>{
  if(path.endsWith('/access'))return {accessToken:'fixture_update.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.equal(path,'updates/plan');assert.equal(body.protocol,'license-api-v2');assert.equal(body.capability,nativeUpdateCapability(f.client.product));assert.deepEqual(body.targetPackageKeys,[key]);
  const now=Date.now(),plan={...f.plan(release,body.installed,key,body.capability),licenseRevision:f.client.status().receipt.revision,generatedAt:new Date(now).toISOString(),validUntil:new Date(now+600000).toISOString()};
  return {signedPlan:f.envelope(plan)};
 };
}

// Exercise the packaged updater and its dependencies against a real database and runtime.
export async function verifyFrameworkUpdate({f,host,db,pkg,root,manifest,origin,apiBase}){
 const started=performance.now(),phase=label=>console.log('[native-framework +'+((performance.now()-started)/1000).toFixed(1)+'s] '+label);
 const {state}=f,key=state.config.frameworkKey,before=structuredClone(state.active(key)),appBefore=structuredClone(state.active('app_fixture'));
 phase('COPY_RUNTIME start');
 const current=state.path(key,before.current),source=join(root,'framework-update-source');await cp(join(pkg,'runtime'),source,{recursive:true});
 phase('COPY_RUNTIME done');phase('LOAD_PACKAGED_UPDATER start');
 const {NativeEffects}=await import(pathToFileURL(join(current,'apps/api/dist/lifecycle/native-effects.js')).href);
 const {UpdateEngine}=await import(pathToFileURL(join(current,'apps/api/dist/lifecycle/update-engine.js')).href);
 const sharp=createRequire(join(current,'package.json'))('sharp');
 const png=await sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer();assert.equal((await sharp(png).metadata()).width,2);
 phase('LOAD_PACKAGED_UPDATER done');phase('DERIVE_TEST_MANIFEST start');
 const versions=manifest.version.split('.').map(Number),nextVersion=[versions[0],versions[1],versions[2]+1].join('.');
 const packageFile=join(source,'package.json'),runtimePackage=JSON.parse(await readFile(packageFile,'utf8'));runtimePackage.version=nextVersion;const packageBytes=JSON.stringify(runtimePackage)+'\n';await writeFile(packageFile,packageBytes);
 const nextManifest={...manifest,version:nextVersion,from_version:manifest.version,files:manifest.files.map(file=>file.path==='package.json'?{...file,size:Buffer.byteLength(packageBytes),sha256:createHash('sha256').update(packageBytes).digest('hex')}:file)};
 await writeFile(join(source,'release-manifest.json'),canonicalJson(nextManifest)+'\n');
 phase('DERIVE_TEST_MANIFEST done');phase('ZIP_DERIVED_CANDIDATE start');
 const archive=join(root,'framework-update.zip'),packed=spawnSync('zip',['-q','-X','-9',archive,'-@'],{cwd:source,input:[...manifest.files.map(file=>file.path),'release-manifest.json'].join('\n')+'\n',encoding:'utf8'});
 assert.equal(packed.status,0,packed.stderr);
 phase('ZIP_DERIVED_CANDIDATE done');phase('SIGN_TEST_AUTHORITY start');
 const bytes=await readFile(archive),release=f.signArchive(nextManifest,bytes);
 phase('SIGN_TEST_AUTHORITY done');
 f.client.machine=frameworkFlowAuthority(f,release,key);
 f.client.transport=async url=>{assert.ok(String(url).endsWith('/'+release.artifact.releaseId));return new Response(bytes,{headers:{'content-length':String(bytes.length)}})};
 const id=randomUUID(),request={packageKey:key,targetVersion:nextVersion,manifestSha256:release.artifact.manifestSha256};
 const engine=new UpdateEngine(state.component(key),new NativeEffects(state,host,f.client,key,id,request));
 phase('EXECUTE_UPDATE start');
 const task=await engine.execute(id,request);assert.equal(task.status,'succeeded',JSON.stringify(task));assert.ok(task.backup?.sha256);
 phase('EXECUTE_UPDATE done');phase('VERIFY_HEALTH_AND_DATA start');
 assert.equal(state.active(key).current.version,nextVersion);assert.equal(state.active(key).previous,null);await assert.rejects(access(current));assert.deepEqual(state.active('app_fixture'),appBefore);
 assert.equal((await engine.execute(id,request)).status,'succeeded');await state.verifyCurrent(key);
 assert.equal((await db.$queryRawUnsafe('SELECT value FROM AppLifecycleFixture WHERE id=1'))[0].value,'retained customer data');
 const login=await fetch(apiBase+'/api/v1/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'installAdmin',password:'123456',portal:'admin'})});assert.equal(login.status,200);
 assert.equal((await(await fetch(state.config.loginUrl)).text()).match(/<title>(.*?)<\/title>/)?.[1],'总后台登录 · QiCore');
 phase('VERIFY_HEALTH_AND_DATA done');phase('RESTART start');
 await host.stop();await host.start();await host.health(key,nextVersion,release.artifact.manifestSha256);
 phase('RESTART done');
 assert.equal((await readdir(join(state.directory(key),'releases'))).length,1);assert.deepEqual((await readdir(state.directory(key))).sort(),['current.json','releases']);
 phase('CLEANUP_DERIVED_CANDIDATE start');assert.ok(resolve(source).startsWith(resolve(root)+'/'));await rm(source,{recursive:true});await rm(archive);phase('CLEANUP_DERIVED_CANDIDATE done');
 await writeFile(join(pkg,'framework-update-report.json'),JSON.stringify({status:'passed',fromVersion:manifest.version,toVersion:nextVersion,packagedDependencies:true,backup:'verified',signedDownload:'passed',healthReceipt:'passed',previousVersion:'removed',currentOnly:true,restart:'passed',login:'passed',ssr:'passed',sharp:'passed',applicationData:'preserved',idempotency:'passed',productionRelease:false},null,2)+'\n');
 phase('COMPLETE');
}
