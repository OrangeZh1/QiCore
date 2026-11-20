import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {historicalBytes,source016} from './fixtures/historical-source.mjs';
import {randomUUID} from 'node:crypto';
import {fixture,initialRelease} from './fixtures/native-release.mjs';
import {QICORE_FRAMEWORK_KEY as FRAMEWORK,ID_PHOTO_PACKAGE_KEY as PHOTO,nativeReleaseIntegritySchema,nativePhotoReleaseIntegritySchema,nativeArtifactIntegritySchema,nativeArchiveFromCatalog} from '../dist/license/native-release.js';
import {verifyNativeRelease,verifyNativeLocalRelease,verifyNativeStoredRelease,verifyNativeInitialRelease,checkNativePlan,checkNativeOperation,assertNativeCompatibility,nativeUpdateCapability,nativeLifecycleCapability} from '../dist/license/native-updates.js';
import {UpdateService} from '../dist/lifecycle/update-service.js';
import {loadNativeApplications} from '../dist/applications/native-catalog.js';
import {NativeLocalEffects} from '../dist/lifecycle/native-local-update.js';
import {UpdateEngine} from '../dist/lifecycle/update-engine.js';

async function setup(t){const root=await mkdtemp(join(tmpdir(),'qicore-photo-integrity-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,...fixture(root,{frameworkKey:FRAMEWORK,applicationPackageKey:PHOTO,version:'0.1.6'})}}
function ordinary(release){const r=structuredClone(release),a=r.artifact;delete a.signatureEnvelope;a.integrity={format:'id-photo-release-integrity-v1',package_key:a.packageKey,package_type:a.packageType,framework_package_key:r.manifest.framework.packageKey,from_version:a.fromVersion,version:a.version,archive_sha256:a.sha256,archive_size:a.size,release_manifest_sha256:a.manifestSha256};return r}
const photo=(f,version='0.1.7',from='0.1.6')=>f.release(PHOTO,version,from,{'server/main.mjs':'export const fixture=true'},{frameworkRange:'>=0.1.3 <=0.1.7',framework:{packageKey:FRAMEWORK,range:'>=0.1.3 <=0.1.7'}}).release;

test('the new format is limited to the exact photo package and host while the framework format remains unchanged',async t=>{
 const f=await setup(t),r=ordinary(photo(f)),product={...f.product,archiveReleaseKeys:{}};
 assert.deepEqual(verifyNativeRelease(product,r),r);assert.deepEqual(nativeArtifactIntegritySchema.parse(r.artifact.integrity),r.artifact.integrity);
 assert.deepEqual(nativePhotoReleaseIntegritySchema.parse(r.artifact.integrity),r.artifact.integrity);assert.throws(()=>nativeReleaseIntegritySchema.parse(r.artifact.integrity));
 const frame=f.release(FRAMEWORK,'0.1.7','0.1.6').release.artifact,integrity={format:'qicore-release-integrity-v1',package_key:FRAMEWORK,package_type:'framework_update',from_version:frame.fromVersion,version:frame.version,archive_sha256:frame.sha256,archive_size:frame.size,release_manifest_sha256:frame.manifestSha256};
 assert.deepEqual(nativeReleaseIntegritySchema.parse(integrity),integrity);assert.deepEqual(nativeArtifactIntegritySchema.parse(integrity),integrity);
 assert.throws(()=>verifyNativeRelease({...product,appKey:'frm_other'},r),/RELEASE_IDENTITY_MISMATCH/);
 for(const mutate of [x=>x.manifest.framework.packageKey='frm_other',x=>x.manifest.parentApp=PHOTO,x=>x.manifest.type='framework',x=>x.manifest.packageKey='app_other',x=>x.artifact.packageKey='app_other',x=>x.artifact.packageType='plugin_update',x=>x.artifact.integrity.package_key='app_other',x=>x.artifact.integrity.package_type='framework_update',x=>x.artifact.integrity.framework_package_key='frm_other',x=>x.artifact.integrity.format='qicore-release-integrity-v1',x=>x.artifact.integrity.archive_sha256='0'.repeat(64),x=>x.artifact.integrity.archive_size='1',x=>x.artifact.integrity.release_manifest_sha256='0'.repeat(64),x=>x.artifact.integrity.version='0.1.8',x=>x.artifact.integrity.from_version='0.1.5',x=>x.artifact.integrity.key_id='none',x=>x.artifact.signatureEnvelope=photo(f).artifact.signatureEnvelope]){
  const changed=structuredClone(r);mutate(changed);assert.throws(()=>verifyNativeRelease(product,changed),mutate.toString());
 }
});

test('photo local v2 is explicit and historical application signatures never downgrade',async t=>{
 const f=await setup(t),signed=photo(f),local={...initialRelease(ordinary(signed)),format:'qicore-local-release-v2'};
 assert.deepEqual(verifyNativeLocalRelease(f.product,local),local);assert.deepEqual(verifyNativeStoredRelease(f.product,local),local);
 assert.throws(()=>verifyNativeStoredRelease(f.product,{...local,format:'qicore-local-release-v1'}));
 assert.throws(()=>verifyNativeInitialRelease(f.product,{...local,format:'qicore-initial-release-v2'}),/INITIAL_RELEASE_REQUIRED/);
 const old={...initialRelease(signed),format:'qicore-local-release-v1'};assert.deepEqual(verifyNativeStoredRelease(f.product,old),old);
 for(const r of [signed,old]){const bad=structuredClone(r);bad.artifact.signatureEnvelope.signature=Buffer.alloc(64).toString('base64url');assert.throws(()=>verifyNativeStoredRelease(f.product,bad),/RELEASE_SIGNATURE_INVALID/);bad.artifact.integrity=ordinary(signed).artifact.integrity;assert.throws(()=>verifyNativeStoredRelease(f.product,bad));delete bad.artifact.signatureEnvelope;if(bad.format)assert.throws(()=>verifyNativeStoredRelease(f.product,bad))}
 const other=f.release('app_other','0.1.7','0.1.6').release;assert.ok(verifyNativeRelease(f.product,other).artifact.signatureEnvelope);assert.throws(()=>verifyNativeRelease(f.product,ordinary(other)));
});

test('capability selection leaves other hosts unchanged and rejects signed-plan downgrade or scope changes',async t=>{
 const f=await setup(t),installed=[{packageKey:FRAMEWORK,version:'0.1.6'},{packageKey:PHOTO,version:'0.1.6'}],release=ordinary(photo(f));
 assert.equal(nativeUpdateCapability(f.product),'native-full-v3');assert.equal(nativeLifecycleCapability(f.product),'native-lifecycle-v2');
 assert.equal(nativeUpdateCapability({...f.product,appKey:'frm_other'}),'native-full-v2');assert.equal(nativeLifecycleCapability({...f.product,appKey:'frm_other'}),'native-lifecycle-v1');
 let plan=f.plan(release,installed,PHOTO),brokenEnvelope=false;
 f.client.machine=async(path,body)=>{assert.equal(path,'updates/plan');assert.equal(body.capability,'native-full-v3');const signedPlan=f.envelope(plan);return {signedPlan:brokenEnvelope?{...signedPlan,signature:Buffer.alloc(64).toString('base64url')}:signedPlan}};
 assert.deepEqual((await checkNativePlan(f.client,installed,PHOTO)).release,release);
 brokenEnvelope=true;await assert.rejects(checkNativePlan(f.client,installed,PHOTO));brokenEnvelope=false;
 for(const mutate of [p=>p.nativeContext.capability='native-full-v2',p=>p.nativeContext.productId='frm_other',p=>p.nativeContext.targetPackageKeys=[FRAMEWORK],p=>p.nativeContext.installed=[],p=>p.licenseRevision=2,p=>p.instanceId='wrong',p=>p.validUntil=new Date(0).toISOString()]){plan=f.plan(release,installed,PHOTO);mutate(plan);await assert.rejects(checkNativePlan(f.client,installed,PHOTO))}
});

test('photo installation and repair use lifecycle v2 and still verify the signed authorized plan',async t=>{
 const f=await setup(t),release=ordinary(photo(f)),framework=[{packageKey:FRAMEWORK,version:'0.1.6'}];let capability='native-lifecycle-v2';
 f.client.machine=async(path,body)=>{assert.equal(path,'updates/lifecycle/plan');assert.equal(body.capability,'native-lifecycle-v2');const {protocol,key_id,planId,licenseId,licenseRevision,instanceId,generatedAt,validUntil}=f.plan(null);return {signedPlan:f.envelope({protocol,key_id,planId,licenseId,licenseRevision,instanceId,generatedAt,validUntil,capability,operation:body.operation,productId:FRAMEWORK,domain:f.client.domain,packageKey:PHOTO,installed:body.installed,release})}};
 assert.deepEqual((await checkNativeOperation(f.client,framework,PHOTO,'install')).release,release);
 assert.deepEqual((await checkNativeOperation(f.client,[...framework,{packageKey:PHOTO,version:'0.1.7'}],PHOTO,'repair')).release,release);
 capability='native-lifecycle-v1';await assert.rejects(checkNativeOperation(f.client,framework,PHOTO,'install'),/APPLICATION_PLAN_MISMATCH/);
});

test('compatibility still requires photo first: the old photo version cannot run on framework 0.1.7',async t=>{
 const f=await setup(t),framework016=nativeArchiveFromCatalog(f.release(FRAMEWORK,'0.1.6','0.1.5').release.manifest),framework017=nativeArchiveFromCatalog(f.release(FRAMEWORK,'0.1.7','0.1.6').release.manifest);
 const old=photo(f,'0.1.6','0.1.5');old.manifest.framework.range='>=0.1.3 <=0.1.6';old.manifest.frameworkRange=old.manifest.framework.range;const app016=nativeArchiveFromCatalog(old.manifest),app017=nativeArchiveFromCatalog(photo(f).manifest);
 assert.throws(()=>assertNativeCompatibility([framework016,app016],framework017,'linux','x64','24.0.0'),/COMPONENT_DEPENDENCY_CONFLICT/);
 assert.doesNotThrow(()=>assertNativeCompatibility([framework016,app016],app017,'linux','x64','24.0.0'));
 assert.doesNotThrow(()=>assertNativeCompatibility([framework016,app017],framework017,'linux','x64','24.0.0'));
});

test('plain photo updates persist verified slots and recover to signed photo history without changing the framework',async t=>{
 const f=await setup(t);await f.install(f.release(FRAMEWORK,'0.1.6','0.1.5'));
 const app=(version,from)=>f.release(PHOTO,version,from,{'server/main.mjs':'export const fixture=true','application.json':JSON.stringify({format:'qicore-application-v1',key:'id-photo',packageKey:PHOTO,version,name:'Photo',pendingTasks:[]})},{frameworkRange:'>=0.1.3 <=0.1.7',framework:{packageKey:FRAMEWORK,range:'>=0.1.3 <=0.1.7'}});
 await f.install(app('0.1.6','0.1.5'));const old=structuredClone(f.state.active(PHOTO).current),framework=structuredClone(f.state.active(FRAMEWORK));
 const candidate=app('0.1.7','0.1.6'),release={...initialRelease(ordinary(candidate.release)),format:'qicore-local-release-v2'},archive=join(f.root,'photo.zip');await writeFile(archive,candidate.archive);
 let failHealth=true;
 const host={assertOpen(){},async stop(){},async start(){},async health(packageKey,_version,digest){if(failHealth&&packageKey===PHOTO&&digest===release.artifact.manifestSha256)throw Error('PHOTO_NOT_READY')}};
 class Effects extends NativeLocalEffects{runtime(){return{platform:'linux',arch:'x64',node:'24.0.0'}}database(){return{async $queryRawUnsafe(){return []},async $disconnect(){}}}async maintenance(){}async backup(){return{id:'backup-'+this.taskId,sha256:'a'.repeat(64),verified:true}}}
 const execute=async()=>{const id=randomUUID(),effects=new Effects(f.state,host,f.client,PHOTO,id,release,archive);return new UpdateEngine(f.state.component(PHOTO),effects).execute(id,{packageKey:PHOTO,targetVersion:release.version,manifestSha256:release.artifact.manifestSha256})};
 const failed=await execute();assert.equal(failed.status,'rolled_back',JSON.stringify(failed));assert.deepEqual(f.state.active(PHOTO).current,old);assert.ok(f.state.release(PHOTO,old).artifact.signatureEnvelope);await f.state.verifyCurrent(PHOTO);
 failHealth=false;const succeeded=await execute();assert.equal(succeeded.status,'succeeded',JSON.stringify(succeeded));await f.state.verifyCurrent(PHOTO);assert.deepEqual(f.state.release(PHOTO,f.state.active(PHOTO).current),release);
 assert.equal(f.state.active(PHOTO).previous,null);assert.deepEqual(f.state.active(FRAMEWORK).current,framework.current);assert.equal(f.state.active(FRAMEWORK).current.version,'0.1.6');
});

test('the pinned 0.1.6 and current APIs forward native updates and accept only host verified inventory fields',async t=>{
 const f=await setup(t),repo=new URL('../../../',import.meta.url);
 const {default:ts}=await import('typescript'),historical=join(f.root,'historical-api');await mkdir(historical);
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(historical,'node_modules'),process.platform==='win32'?'junction':'dir');
 const historyFiles=['apps/api/src/lifecycle/update-service.ts','apps/api/src/applications/native-catalog.ts','apps/api/src/lifecycle/updater-client.ts'];
 const historyTargets=new Map(historyFiles.map(file=>[new URL(file.replace('/src/','/dist/').replace(/\.ts$/,'.js'),repo).href,join(historical,file.split('/').at(-1).replace(/\.ts$/,'.mjs'))]));
 for(const file of historyFiles){
  const before=historicalBytes(file,source016[file]).toString('utf8'),base=new URL(file.replace('/src/','/dist/').replace(/\.ts$/,'.js'),repo);
  const code=ts.transpileModule(before,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_all,quote,specifier)=>{const target=new URL(specifier,base).href;return quote+(historyTargets.has(target)?pathToFileURL(historyTargets.get(target)).href:target)+quote});
  await writeFile(historyTargets.get(base.href),code);
 }
 const originalService=await import(pathToFileURL(join(historical,'update-service.mjs')).href),originalCatalog=await import(pathToFileURL(join(historical,'native-catalog.mjs')).href);
 for(const [Service,loadApplications] of [[originalService.UpdateService,originalCatalog.loadNativeApplications],[UpdateService,loadNativeApplications]]){
 const calls=[],authorization=[];const service=new Service({client:{product:{deliveryKind:'archive',appKey:FRAMEWORK},status:()=>({receipt:{entitlements:[{packageKey:PHOTO,type:'app'}]}})},assertComponentAllowed:(...args)=>authorization.push(args)},async(path,body)=>{calls.push({path,body});return {accepted:true}},[{key:'id-photo',packageKey:PHOTO,source:'native'}]);
 const previous=process.env.UPDATER_SOCKET;process.env.UPDATER_SOCKET=join(f.root,'fixture.sock');try{
  await service.checkComponent({packageKey:PHOTO});await service.execute({requestId:'6fbbe5cb-e253-4ad2-9142-41732f17f721',packageKey:PHOTO,targetVersion:'0.1.7',manifestSha256:'a'.repeat(64)});await service.applicationOperation({packageKey:PHOTO,operation:'repair'});
 }finally{if(previous===undefined)delete process.env.UPDATER_SOCKET;else process.env.UPDATER_SOCKET=previous}
 assert.deepEqual(calls.map(c=>c.path),['/check','/execute','/applications/check']);assert.equal(authorization.length,3);
 const app=join(f.root,'photo');await mkdir(join(app,'server'),{recursive:true});await writeFile(join(app,'application.json'),JSON.stringify({format:'qicore-application-v1',key:'id-photo',packageKey:PHOTO,version:'0.1.7',name:'Photo',pendingTasks:[]}));
 await writeFile(join(app,'server/main.mjs'),`export const format='qicore-application-v1',version='0.1.7',definition={key:'id-photo',name:'Photo',licensePackageKey:'${PHOTO}',permissions:[],defaultConfig:()=>({}),validateConfig:v=>v};export function createRuntime(){return {}}`);
 const components={[FRAMEWORK]:{version:'0.1.6',manifestSha256:'a'.repeat(64),path:f.root,type:'framework',entrypoint:'server/main.mjs'},[PHOTO]:{version:'0.1.7',manifestSha256:'b'.repeat(64),path:app,type:'app',entrypoint:'server/main.mjs'}};
 assert.equal((await loadApplications(JSON.stringify(components),FRAMEWORK)).applications[0].definition.version,'0.1.7');
 components[PHOTO].integrity={format:'id-photo-release-integrity-v1'};await assert.rejects(loadApplications(JSON.stringify(components),FRAMEWORK));
 }
});
