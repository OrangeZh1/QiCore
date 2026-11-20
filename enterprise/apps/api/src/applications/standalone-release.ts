import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import type { Product } from '../license/client.js'
import { canonicalJson, decodeCanonicalBase64Url, utcDateTimeMillisSchema } from '../license/contracts.js'
import { nativeReleaseManifestSchema, nativeArchiveFromCatalog, nativeSignaturePayloadSchema, NATIVE_SIGNATURE_DOMAIN } from './standalone-archive.js'

export const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex')
const signature=z.object({format:z.literal('qilicense-release-signature-v2'),algorithm:z.literal('Ed25519'),key_id:z.string(),payload:z.string().max(65536),signature:z.string()}).strict()
const artifact=z.object({
  version:z.string(),sha256:z.string(),size:z.string(),manifestSha256:z.string(),packageType:z.literal('app_update'),
  packageKey:z.string(),fromVersion:z.string(),signatureEnvelope:signature
}).strict()
const common={
  version:z.string(),channel:z.enum(['stable','beta']),releaseNotes:z.string().min(1).max(5000),
  manifest:nativeReleaseManifestSchema,migrations:nativeReleaseManifestSchema.shape.migrations
}
const initial=z.object({...common,format:z.literal('qicore-initial-release-v1'),artifact}).strict()
const online=z.object({...common,publishedAt:utcDateTimeMillisSchema,artifact:artifact.extend({releaseId:z.string().regex(/^[A-Za-z0-9_-]{8,191}$/),downloadUrl:z.string()})}).strict()
export type NativeRelease=z.infer<typeof online>
export type NativeInitialRelease=z.infer<typeof initial>
export type NativeStoredRelease=NativeRelease|NativeInitialRelease

function verifyArchive(product:Product,release:NativeStoredRelease) {
  const {manifest:m,artifact:a}=release, signed=a.signatureEnvelope
  if(product.componentType!=='app' || product.deliveryKind!=='archive' || product.appKey!==m.packageKey ||
    m.type!=='app' || m.applicationMode!=='STANDALONE' || m.framework || m.parentApp || m.dependencies.length ||
    m.channel!==release.channel) throw Error('RELEASE_IDENTITY_MISMATCH')
  const anchor=product.archiveReleaseKeys?.[signed.key_id]
  if(!anchor || anchor.role!=='component_update')throw Error('RELEASE_TRUST_REQUIRED')
  const der=Buffer.from(anchor.publicKey,'base64')
  const key=createPublicKey({key:der,type:'spki',format:'der'})
  if(der.length!==44 || key.asymmetricKeyType!=='ed25519' || sha256(der.subarray(-32))!==anchor.sha256 ||
    anchor.sha256===product.receiptPublicKeySha256)throw Error('RELEASE_TRUST_INVALID')
  const bytes=Buffer.from(decodeCanonicalBase64Url(signed.payload)), sig=Buffer.from(decodeCanonicalBase64Url(signed.signature))
  const p=nativeSignaturePayloadSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))
  if(sig.length!==64 || p.key_id!==signed.key_id || canonicalJson(p)!==bytes.toString('utf8') ||
    !verify(null,Buffer.concat([Buffer.from(NATIVE_SIGNATURE_DOMAIN),bytes]),key,sig))throw Error('RELEASE_SIGNATURE_INVALID')
  const hash=sha256(canonicalJson(nativeArchiveFromCatalog(m))+'\n')
  if(a.manifestSha256!==hash || m.releaseManifestSha256!==hash || p.release_manifest_sha256!==hash ||
    a.sha256!==p.archive_sha256 || m.artifactSha256!==p.archive_sha256 || a.size!==p.archive_size ||
    m.artifactFromVersion!==p.from_version || a.fromVersion!==p.from_version || m.version!==p.version ||
    a.version!==p.version || release.version!==p.version || a.packageKey!==p.package_key ||
    m.packageKey!==p.package_key || m.artifactPackageType!==p.package_type || a.packageType!==p.package_type ||
    canonicalJson(m.migrations)!==canonicalJson(release.migrations))throw Error('RELEASE_IDENTITY_MISMATCH')
}
export function verifyNativeInitialRelease(product:Product,input:unknown){
  const release=initial.parse(input)
  verifyArchive(product,release)
  if(release.artifact.fromVersion!=='0.0.0')throw Error('INITIAL_RELEASE_REQUIRED')
  return release
}
export function verifyNativeRelease(product:Product,input:unknown){
  const release=online.parse(input)
  verifyArchive(product,release)
  if(release.artifact.downloadUrl!=='/api/v1/updates/artifacts/'+release.artifact.releaseId)throw Error('RELEASE_IDENTITY_MISMATCH')
  return release
}
