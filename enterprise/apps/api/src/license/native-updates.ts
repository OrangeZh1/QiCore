import {createHash,createPublicKey,verify} from 'node:crypto';
import {z} from 'zod';
import semver from 'semver';
import {LicenseClient,type Product} from './client.js';
import {canonicalJson,decodeCanonicalBase64Url,LICENSE_PROTOCOL_VERSION,utcDateTimeMillisSchema} from './contracts.js';
import {nativeReleaseManifestSchema,nativeSignaturePayloadSchema,nativeArtifactIntegritySchema,nativeArchiveFromCatalog,NATIVE_SIGNATURE_DOMAIN,QICORE_FRAMEWORK_KEY,ID_PHOTO_PACKAGE_KEY,type NativeArchiveManifest} from './native-release.js';

export const sha256=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export const nativeUpdateCapability=(product:Product)=>product.appKey===QICORE_FRAMEWORK_KEY?'native-full-v3' as const:'native-full-v2' as const;
export const nativeLifecycleCapability=(product:Product)=>product.appKey===QICORE_FRAMEWORK_KEY?'native-lifecycle-v2' as const:'native-lifecycle-v1' as const;
export type NativeRelease=z.infer<typeof releaseSchema>;
export type NativeInitialRelease=z.infer<typeof initialReleaseSchema>;
export type NativeLocalRelease=z.infer<typeof localReleaseSchema>;
export type NativeStoredRelease=NativeRelease|NativeInitialRelease|NativeLocalRelease;
const signatureSchema=z.object({format:z.literal('qilicense-release-signature-v2'),algorithm:z.literal('Ed25519'),key_id:z.string(),payload:z.string().max(65536),signature:z.string()}).strict();
const artifactFields={version:z.string(),sha256:z.string(),size:z.string(),manifestSha256:z.string(),packageType:z.string(),packageKey:z.string(),fromVersion:z.string()};
const signedArtifactSchema=z.object({...artifactFields,signatureEnvelope:signatureSchema}).strict();
const integrityArtifactSchema=z.object({...artifactFields,integrity:nativeArtifactIntegritySchema}).strict();
const onlineFields={releaseId:z.string().regex(/^[A-Za-z0-9_-]{8,191}$/),downloadUrl:z.string()};
const artifactSchema=z.union([signedArtifactSchema.extend(onlineFields),integrityArtifactSchema.extend(onlineFields)]);
const releaseSchema=z.object({version:z.string(),channel:z.literal('stable'),releaseNotes:z.string().min(1).max(5000),publishedAt:utcDateTimeMillisSchema,
  artifact:artifactSchema,manifest:nativeReleaseManifestSchema,migrations:nativeReleaseManifestSchema.shape.migrations}).strict();
const offlineReleaseSchema=releaseSchema.omit({publishedAt:true,artifact:true});
const initialReleaseSchema=z.union([
  offlineReleaseSchema.extend({format:z.literal('qicore-initial-release-v1'),artifact:signedArtifactSchema}),
  offlineReleaseSchema.extend({format:z.literal('qicore-initial-release-v2'),artifact:integrityArtifactSchema}),
]);
const localReleaseSchema=z.union([
  offlineReleaseSchema.extend({format:z.literal('qicore-local-release-v1'),artifact:signedArtifactSchema}),
  offlineReleaseSchema.extend({format:z.literal('qicore-local-release-v2'),artifact:integrityArtifactSchema}),
]);
const stepSchema=releaseSchema.extend({component:z.object({packageKey:z.string(),type:z.enum(['framework','app','plugin']),name:z.string()}).strict(),
  fromVersion:z.string(),targetVersion:z.string(),requiredUpgradeHops:z.array(z.string()).max(0),upgradeHops:z.array(z.unknown()).max(0)}).strict();
const planSchema=z.object({protocol:z.literal(LICENSE_PROTOCOL_VERSION),key_id:z.string(),planId:z.string().regex(/^[A-Za-z0-9_-]{8,191}$/),licenseId:z.string(),licenseRevision:z.number().int().positive(),
  instanceId:z.string(),generatedAt:utcDateTimeMillisSchema,validUntil:utcDateTimeMillisSchema,requiresConfirmation:z.literal(true),steps:z.array(stepSchema).max(1),
  nativeContext:z.object({capability:z.enum(['native-full-v2','native-full-v3']),productId:z.string(),domain:z.string(),targetPackageKeys:z.tuple([z.string()]),installed:z.array(z.object({packageKey:z.string(),version:z.string()}).strict())}).strict()}).strict();
const operationPlanSchema=z.object({protocol:z.literal(LICENSE_PROTOCOL_VERSION),capability:z.enum(['native-lifecycle-v1','native-lifecycle-v2']),operation:z.enum(['install','repair']),key_id:z.string(),
  planId:z.string().regex(/^[A-Za-z0-9_-]{8,191}$/),licenseId:z.string(),licenseRevision:z.number().int().positive(),instanceId:z.string(),generatedAt:utcDateTimeMillisSchema,validUntil:utcDateTimeMillisSchema,
  productId:z.string(),domain:z.string(),packageKey:z.string(),installed:z.array(z.object({packageKey:z.string(),version:z.string()}).strict()).max(500),release:releaseSchema}).strict();

export function verifyNativeRelease(product:Product,input:unknown):NativeRelease {
  const release=releaseSchema.parse(input);
  verifyArchive(product,release);
  if(release.artifact.downloadUrl!==`/api/v1/updates/artifacts/${release.artifact.releaseId}`)throw Error('RELEASE_IDENTITY_MISMATCH');
  return release;
}
export function verifyNativeInitialRelease(product:Product,input:unknown):NativeInitialRelease {
  const release=initialReleaseSchema.parse(input);
  if(release.manifest.packageKey!==product.appKey||release.manifest.type!=='framework'||release.artifact.fromVersion!=='0.0.0'||release.migrations.length)throw Error('INITIAL_RELEASE_REQUIRED');
  verifyArchive(product,release);
  return release;
}
export function verifyNativeLocalRelease(product:Product,input:unknown):NativeLocalRelease {
  const release=localReleaseSchema.parse(input);
  if(!semver.valid(release.artifact.fromVersion)||release.artifact.fromVersion==='0.0.0'||!semver.gt(release.version,release.artifact.fromVersion))throw Error('LOCAL_UPDATE_VERSION_INVALID');
  if(release.manifest.type==='framework'&&release.manifest.packageKey!==product.appKey)throw Error('RELEASE_IDENTITY_MISMATCH');
  verifyArchive(product,release);return release;
}
// Persisted slots retain support for historical signed metadata without downgrading it.
// Update plans and downloads must continue to use verifyNativeRelease exclusively.
export function verifyNativeStoredRelease(product:Product,input:unknown):NativeStoredRelease {
  if(input&&typeof input==='object'&&'format' in input&&['qicore-local-release-v1','qicore-local-release-v2'].includes(String(input.format)))return verifyNativeLocalRelease(product,input);
  return input&&typeof input==='object'&&'format' in input?verifyNativeInitialRelease(product,input):verifyNativeRelease(product,input);
}
function verifyArchive(product:Product,release:NativeStoredRelease){
  const m=release.manifest,a=release.artifact;
  const p='integrity' in a?a.integrity:verifyArchiveSignature(product,m.type,a.signatureEnvelope);
  if('integrity' in a){
    if(product.appKey!==QICORE_FRAMEWORK_KEY)throw Error('RELEASE_IDENTITY_MISMATCH');
    if(a.integrity.format==='qicore-release-integrity-v1'){
      if(m.packageKey!==product.appKey||m.type!=='framework')throw Error('RELEASE_IDENTITY_MISMATCH');
    }else if(m.packageKey!==ID_PHOTO_PACKAGE_KEY||m.type!=='app'||m.parentApp!==null||m.framework?.packageKey!==product.appKey
      ||a.integrity.framework_package_key!==m.framework.packageKey)throw Error('RELEASE_IDENTITY_MISMATCH');
  }
  const manifestHash=sha256(canonicalJson(nativeArchiveFromCatalog(m))+'\n');
  if(p.package_key!==m.packageKey||p.package_type!==m.artifactPackageType||p.from_version!==m.artifactFromVersion||p.version!==m.version
    ||p.archive_sha256!==m.artifactSha256||p.release_manifest_sha256!==manifestHash||m.releaseManifestSha256!==manifestHash
    ||a.sha256!==p.archive_sha256||a.size!==p.archive_size||a.manifestSha256!==manifestHash||a.fromVersion!==p.from_version
    ||a.packageKey!==p.package_key||a.packageType!==p.package_type||a.version!==p.version||release.version!==p.version
    ||canonicalJson(release.migrations)!==canonicalJson(m.migrations))throw Error('RELEASE_IDENTITY_MISMATCH');
}
function verifyArchiveSignature(product:Product,type:string,e:z.infer<typeof signatureSchema>){
  const anchor=product.archiveReleaseKeys?.[e.key_id];
  if(!anchor)throw Error('RELEASE_TRUST_REQUIRED');
  const der=Buffer.from(anchor.publicKey,'base64'),key=createPublicKey({key:der,format:'der',type:'spki'});
  if(der.length!==44||key.asymmetricKeyType!=='ed25519'||sha256(der.subarray(-32))!==anchor.sha256||anchor.sha256===product.receiptPublicKeySha256
    ||anchor.role!==(type==='framework'?'framework_update':'component_update'))throw Error('RELEASE_TRUST_INVALID');
  const bytes=Buffer.from(decodeCanonicalBase64Url(e.payload)),signature=Buffer.from(decodeCanonicalBase64Url(e.signature));
  const p=nativeSignaturePayloadSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(signature.length!==64||canonicalJson(p)!==bytes.toString('utf8')||p.key_id!==e.key_id||!verify(null,Buffer.concat([Buffer.from(NATIVE_SIGNATURE_DOMAIN),bytes]),key,signature))throw Error('RELEASE_SIGNATURE_INVALID');
  return p;
}
export function assertNativeCompatibility(manifests:NativeArchiveManifest[],target:NativeArchiveManifest,platform=process.platform,arch=process.arch,node=process.versions.node){
  if(target.runtime.platform!==platform||target.runtime.arch!==arch||Number(node.split('.')[0])!==target.runtime.major)throw Error('NATIVE_RUNTIME_INCOMPATIBLE');
  const resulting=[...manifests.filter(m=>m.package_key!==target.package_key),target],versions=new Map(resulting.map(m=>[m.package_key,m.version]));
  for(const m of resulting)for(const d of [...m.dependencies,...(m.framework?[m.framework]:[])])if(!semver.validRange(d.range)||!versions.has(d.packageKey)||!semver.satisfies(versions.get(d.packageKey)!,d.range))throw Error('COMPONENT_DEPENDENCY_CONFLICT');
}
export async function checkNativePlan(client:LicenseClient,installed:{packageKey:string;version:string}[],packageKey:string){
  const status=client.status(),type=packageKey===client.product.appKey?'framework':status.receipt?.entitlements.find(item=>item.packageKey===packageKey)?.type??'app',component=client.componentStatus(packageKey,type);
  const current=installed.find(c=>c.packageKey===packageKey);
  if(!current||current.version==='0.0.0'||!semver.valid(current.version))throw Error('NATIVE_INSTALLATION_REQUIRED');
  if(status.state!=='active'||component.state!=='active'||!component.updatesEligible||!status.receipt)throw Error('UPDATE_NOT_ELIGIBLE');
  const capability=nativeUpdateCapability(client.product);
  const response=await client.machine('updates/plan',{protocol:LICENSE_PROTOCOL_VERSION,installed,targetPackageKeys:[packageKey],capability});
  // Parse the verified payload only; unsigned mirrors never drive an update.
  const plan=planSchema.parse(client.verifyEnvelope(response.signedPlan)),now=Date.now();
  if(plan.nativeContext.capability!==capability||plan.nativeContext.productId!==client.product.appKey||plan.nativeContext.domain!==client.domain||plan.nativeContext.targetPackageKeys[0]!==packageKey
    ||canonicalJson(plan.nativeContext.installed)!==canonicalJson(installed))throw Error('UPDATE_PLAN_MISMATCH');
  if(plan.licenseId!==status.receipt.license_id||plan.licenseRevision!==status.receipt.revision||plan.instanceId!==client.identity()!.instanceId
    ||Date.parse(plan.generatedAt)>now+300000||Date.parse(plan.validUntil)<=now||Date.parse(plan.validUntil)<=Date.parse(plan.generatedAt)
    ||Date.parse(plan.validUntil)-Date.parse(plan.generatedAt)>86400000)throw Error('UPDATE_PLAN_MISMATCH');
  const step=plan.steps[0];
  if(!step)return {plan,release:null};
  if(step.component.packageKey!==packageKey||step.component.type!==type||step.manifest.type!==type||step.fromVersion!==current.version
    ||step.targetVersion!==step.version||step.artifact.fromVersion!==current.version||step.manifest.packageKey!==packageKey||!semver.gt(step.version,current.version))throw Error('UPDATE_PLAN_MISMATCH');
  const {component:_,fromVersion:__,targetVersion:___,requiredUpgradeHops:____,upgradeHops:_____,...raw}=step;
  return {plan,release:verifyNativeRelease(client.product,raw)};
}
export function nativeFileChanges(current:NativeArchiveManifest,target:NativeArchiveManifest){
  const before=new Map(current.files.map(f=>[f.path,f])),after=new Map(target.files.map(f=>[f.path,f]));
  return [...new Set([...before.keys(),...after.keys()])].sort().map(path=>({path,size:after.get(path)?.size??before.get(path)!.size,
    kind:!before.has(path)?'added':!after.has(path)?'deleted':before.get(path)!.sha256===after.get(path)!.sha256&&before.get(path)!.size===after.get(path)!.size?'unchanged':'modified'}));
}

export async function checkNativeOperation(client:LicenseClient,installed:{packageKey:string;version:string}[],packageKey:string,operation:'install'|'repair'){
 const current=installed.find(item=>item.packageKey===packageKey),status=client.status(),type=status.receipt?.entitlements.find(item=>item.packageKey===packageKey)?.type??'app',component=client.componentStatus(packageKey,type);
 if(packageKey===client.product.appKey||!installed.some(item=>item.packageKey===client.product.appKey)||!!current!==(operation==='repair')
  ||new Set(installed.map(item=>item.packageKey)).size!==installed.length||installed.some(item=>!semver.valid(item.version)||item.version==='0.0.0'))throw Error('APPLICATION_OPERATION_INVALID');
 if(status.state!=='active'||component.state!=='active'||!component.updatesEligible||!status.receipt)throw Error('UPDATE_NOT_ELIGIBLE');
 const capability=nativeLifecycleCapability(client.product);
 const response=await client.machine('updates/lifecycle/plan',{protocol:LICENSE_PROTOCOL_VERSION,capability,operation,packageKey,installed});
 const plan=operationPlanSchema.parse(client.verifyEnvelope(response.signedPlan)),now=Date.now();
 if(plan.capability!==capability||plan.productId!==client.product.appKey||plan.domain!==client.domain||plan.packageKey!==packageKey||plan.operation!==operation||canonicalJson(plan.installed)!==canonicalJson(installed)
  ||plan.licenseId!==status.receipt.license_id||plan.licenseRevision!==status.receipt.revision||plan.instanceId!==client.identity()!.instanceId
  ||Date.parse(plan.generatedAt)>now+300000||Date.parse(plan.validUntil)<=now||Date.parse(plan.validUntil)<=Date.parse(plan.generatedAt)||Date.parse(plan.validUntil)-Date.parse(plan.generatedAt)>86400000)throw Error('APPLICATION_PLAN_MISMATCH');
 const release=verifyNativeRelease(client.product,plan.release);
 if(release.manifest.packageKey!==packageKey||!['app','plugin'].includes(release.manifest.type)||release.manifest.type!==type||(release.manifest.framework&&release.manifest.framework.packageKey!==client.product.appKey)
  ||release.manifest.type==='plugin'&&(release.manifest.parentApp?(!installed.some(item=>item.packageKey===release.manifest.parentApp)||!release.manifest.dependencies.some(item=>item.packageKey===release.manifest.parentApp)):!release.manifest.framework)
  ||operation==='repair'&&release.version!==current?.version)throw Error('APPLICATION_PLAN_MISMATCH');
 return {plan,release};
}
