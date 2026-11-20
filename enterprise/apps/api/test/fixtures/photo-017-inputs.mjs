import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import yauzl from 'yauzl';
import {canonicalJson} from '../../dist/license/contracts.js';
import {nativeArchiveManifestSchema,nativePathSchema,nativeArchiveFromCatalog} from '../../dist/license/native-release.js';
import {verifyNativeLocalRelease,verifyNativeRelease} from '../../dist/license/native-updates.js';
import {applicationDescriptorSchema,assertApplicationReleaseLayout} from '../../dist/applications/native-descriptor.js';

export const PHOTO_KEY='app_kmqjjt72urnxp526',FRAMEWORK_KEY='frm_cdm43f43e7yhk5jd';
export const photo016ReleaseSha256='010d10691e1acfd4737aed8b2c5a38148068d047521b25f59e682e44b6073b07';
export const photo017Inputs={
 original:{env:'QICORE_PHOTO_016_ZIP',version:'0.1.6',from:'0.1.5',range:'>=0.1.3 <=0.1.6',sha256:'360edc6c5e8bb19fdef22f7f950138e925bb172518c4728b4f988dcea30aadb8',manifestSha256:'8374ec576e143a3b86cf30797266d157b64ed5e3a6de3242e5878c87cd72f54b'},
 compatible:{env:'QICORE_PHOTO_017_ZIP',version:'0.1.7',from:'0.1.6',range:'>=0.1.3 <=0.1.7',sha256:'a673624f5bb81d9285f478d9529e109cffe0f40af0333f672f36fc361ee05e2b',manifestSha256:'1b22d9342e6b9fae4c683e8b0ae6c4ea0399c76369a389104c13ca8c6057c86d'},
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Read and hash the original ZIP in memory; never extract over or rewrite an approved artifact.
export async function verifyPhoto017Archive(bytes,expected){
 assert.equal(hash(bytes),expected.sha256,'photo archive digest');
 const entries=new Map();let manifestBytes,descriptorBytes,total=0;
 await new Promise((ok,fail)=>yauzl.fromBuffer(bytes,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
  if(error)return fail(error);
  const reject=error=>{zip.close();fail(error)};
  zip.on('error',reject);zip.once('end',ok);
  zip.on('entry',entry=>{(async()=>{
   const name=entry.fileName;nativePathSchema.parse(name);
   assert.ok(!name.endsWith('/')&&!entries.has(name.toLowerCase()),'photo duplicate/directory entry');
   const mode=(entry.externalFileAttributes>>>16)&0xf000;
   assert.ok([0,0x8000].includes(mode)&&!(entry.generalPurposeBitFlag&1),'photo special/encrypted entry');
   total+=entry.uncompressedSize;assert.ok(total<=512*1024*1024,'photo archive expansion limit');
   const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(e,s)=>e?no(e):yes(s)));
   const digest=createHash('sha256'),metadata=['release-manifest.json','application.json'].includes(name),chunks=[];let size=0;
   for await(const chunk of stream){size+=chunk.length;assert.ok(size<=entry.uncompressedSize);digest.update(chunk);if(metadata){assert.ok(size<=4*1024*1024);chunks.push(chunk)}}
   assert.equal(size,entry.uncompressedSize);entries.set(name.toLowerCase(),{path:name,size,sha256:digest.digest('hex')});
   if(name==='release-manifest.json')manifestBytes=Buffer.concat(chunks);
   if(name==='application.json')descriptorBytes=Buffer.concat(chunks);
   zip.readEntry();
  })().catch(reject)});zip.readEntry();
 }));
 assert.ok(manifestBytes&&descriptorBytes,'photo metadata required');
 assert.equal(hash(manifestBytes),expected.manifestSha256,'photo manifest digest');
 const manifest=nativeArchiveManifestSchema.parse(JSON.parse(manifestBytes));
 assert.equal(manifestBytes.toString(),canonicalJson(manifest)+'\n','canonical manifest required');
 assert.equal(manifest.package_key,PHOTO_KEY);assert.equal(manifest.package_type,'app_update');
 assert.equal(manifest.version,expected.version);assert.equal(manifest.from_version,expected.from);
 assert.deepEqual(manifest.framework,{packageKey:FRAMEWORK_KEY,range:expected.range});
 assert.deepEqual(manifest.runtime,{name:'node',major:24,platform:'linux',arch:'x64'});
 assert.equal(entries.size,manifest.files.length+1);
 for(const file of manifest.files)assert.deepEqual(entries.get(file.path.toLowerCase()),file,'photo inventory: '+file.path);
 const descriptor=applicationDescriptorSchema.parse(JSON.parse(descriptorBytes));assertApplicationReleaseLayout(descriptor,manifest);
 assert.equal(descriptor.key,'id-photo');assert.equal(descriptor.version,expected.version);
 return {bytes,manifest,descriptor,sha256:expected.sha256,manifestSha256:expected.manifestSha256};
}
export function assertPhoto017Pair(original,compatible){
 assert.equal(original.manifest.version,'0.1.6');assert.equal(compatible.manifest.from_version,original.manifest.version);
 assert.equal(compatible.manifest.version,'0.1.7');assert.deepEqual(original.manifest.migrations,compatible.manifest.migrations,'no application migration changes');
 // Unlike the older 0.1.0 compatibility-only release, 0.1.7 intentionally fixes mini-program code.
 return {applicationMigrationCount:original.manifest.migrations.length,miniProgramByteIdentityRequired:false};
}
export async function readPhoto017Inputs(env=process.env){
 const result={};for(const [name,expected] of Object.entries(photo017Inputs)){
  assert.ok(env[expected.env],expected.env+' must explicitly name the pinned original ZIP');
  const path=resolve(env[expected.env]);result[name]={path,...await verifyPhoto017Archive(await readFile(path),expected)};
 }
 assertPhoto017Pair(result.original,result.compatible);return result;
}

export function bindPhoto017Releases(inputs,product,historical,candidate){
 assert.equal(historical.format,'qicore-local-release-v1');assert.ok(historical.artifact.signatureEnvelope);assert.ok(!Object.hasOwn(historical.artifact,'integrity'));
 const old=verifyNativeLocalRelease(product,historical),next=verifyNativeLocalRelease(product,candidate.localRelease);
 assert.equal(next.format,'qicore-local-release-v2');assert.equal(next.artifact.integrity?.format,'id-photo-release-integrity-v1');assert.ok(!Object.hasOwn(next.artifact,'signatureEnvelope'));
 assert.equal(next.artifact.integrity.framework_package_key,FRAMEWORK_KEY);
 assert.equal(candidate.sha256,inputs.compatible.sha256);assert.equal(String(candidate.size),String(inputs.compatible.bytes.length));
 assert.deepEqual(JSON.parse(candidate.fields.manifest),next.manifest);
 assert.equal(candidate.fields.releaseManifest,canonicalJson(inputs.compatible.manifest)+'\n');assert.equal(candidate.fields.releaseNotes,next.releaseNotes);
 const result={};for(const [name,local] of [['original',old],['compatible',next]]){
  const input=inputs[name];assert.equal(local.artifact.sha256,input.sha256);assert.equal(local.artifact.size,String(input.bytes.length));assert.equal(local.artifact.manifestSha256,input.manifestSha256);
  assert.deepEqual(nativeArchiveFromCatalog(local.manifest),input.manifest);
  const {format,...metadata}=local,releaseId='isolated_photo_'+(name==='original'?'016':'017');
  result[name]=verifyNativeRelease(product,{...metadata,publishedAt:'2026-11-02T00:00:00.000Z',artifact:{...local.artifact,releaseId,downloadUrl:'/api/v1/updates/artifacts/'+releaseId}});
 }
 return result;
}
export async function readPhoto017Releases(inputs,product,env=process.env){
 for(const key of ['QICORE_PHOTO_016_RELEASE','QICORE_PHOTO_017_RELEASE'])assert.ok(env[key],key+' required');
 const historicalBytes=await readFile(resolve(env.QICORE_PHOTO_016_RELEASE));assert.equal(hash(historicalBytes),photo016ReleaseSha256,'historical public signature metadata digest');
 const candidate=JSON.parse(await readFile(resolve(env.QICORE_PHOTO_017_RELEASE),'utf8'));
 assert.equal(resolve(candidate.archive),inputs.compatible.path,'candidate must name the supplied exact archive');
 return bindPhoto017Releases(inputs,product,JSON.parse(historicalBytes),candidate);
}
