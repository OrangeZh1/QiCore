import { z } from 'zod'

// Canonical STANDALONE full archive format shared with the standalone product helper.
export const NATIVE_SIGNATURE_DOMAIN = 'QiLicense.ReleaseSignature.v2\0'
const key = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
export const nativePathSchema = z.string().min(1).max(500).refine(value => {
  const parts = value.split('/')
  return parts.every(p => /^[A-Za-z0-9_@+.-]+$/.test(p) && p !== '.' && p !== '..'
    && !p.endsWith('.') && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))
    && !parts.some(p => /^(\.env(?:\..*)?|\.git|\.svn|uploads?|storage|logs?|cache|coverage|tests?|__tests__|secrets?|backups?|\.local)$/i.test(p))
    && !/\.(map|bak|old|log|sql\.gz)$/i.test(value)
}, 'Unsafe or persistent release path')
const files = z.array(z.object({path:nativePathSchema,size:z.number().int().min(0).max(512*1024*1024),sha256:hash}).strict()).min(1).max(60000)
const migration = z.object({id:z.string().regex(/^\d{14}_[a-z0-9_]{1,113}$/),order:z.number().int().nonnegative(),
  kind:z.literal('database'),path:nativePathSchema,sha256:hash,transactional:z.literal(false),reversible:z.literal(true)}).strict()
export const nativeArchiveManifestSchema = z.object({
  format:z.literal('qilicense-full-release-v1'),package_type:z.enum(['framework_update','app_update','plugin_update']),package_key:key,
  from_version:version,version,files,
  runtime:z.object({name:z.literal('node'),major:z.literal(24),platform:z.literal('linux'),arch:z.enum(['x64','arm64'])}).strict(),
  applicationMode:z.literal('STANDALONE').optional(),
  framework:z.object({packageKey:key,range:z.string().min(1).max(100)}).strict().nullable(),
  entrypoint:nativePathSchema,
  dependencies:z.array(z.object({packageKey:key,range:z.string().min(1).max(100)}).strict()).max(500),
  migrations:z.array(migration).max(10000),databaseCompatibility:z.literal('backward-compatible'),
}).strict().superRefine((m,c)=>{
  const from=m.from_version.split('.').map(BigInt),to=m.version.split('.').map(BigInt),i=from.findIndex((v,i)=>v!==to[i])
  if(i<0||from[i]!>=to[i]!)c.addIssue({code:'custom',message:'Release must be newer'})
  const paths=new Set<string>()
  for(const f of m.files){const p=f.path.toLowerCase();if(paths.has(p))c.addIssue({code:'custom',message:'Duplicate file'});paths.add(p)}
  for(const p of paths)if(p.split('/').slice(0,-1).some((_,i)=>paths.has(p.split('/').slice(0,i+1).join('/'))))c.addIssue({code:'custom',message:'File directory collision'})
  if(!m.files.some(f=>f.path===m.entrypoint)||! /\.(mjs|cjs|js)$/.test(m.entrypoint))c.addIssue({code:'custom',message:'Entry must be a declared JavaScript file'})
  if (m.applicationMode === 'STANDALONE') {
    if (m.package_type !== 'app_update' || m.framework !== null || m.dependencies.length) c.addIssue({code:'custom',message:'A standalone application is one root product'})
  } else if(m.package_type==='framework_update'?m.framework!==null:m.package_type==='app_update'?m.framework===null:m.framework===null&&!m.dependencies.length)c.addIssue({code:'custom',message:'Invalid framework owner'})
  if(new Set(m.dependencies.map(d=>d.packageKey)).size!==m.dependencies.length||m.dependencies.some(d=>d.packageKey===m.package_key))c.addIssue({code:'custom',message:'Invalid dependencies'})
  if(new Set(m.migrations.map(d=>d.id)).size!==m.migrations.length||new Set(m.migrations.map(d=>d.order)).size!==m.migrations.length)c.addIssue({code:'custom',message:'Duplicate migration'})
  for(const d of m.migrations)if(d.path!==`migrations/${d.id}.sql`||!m.files.some(f=>f.path===d.path&&f.sha256===d.sha256))c.addIssue({code:'custom',message:'Migration not bound to files'})
  if(m.files.reduce((sum,f)=>sum+f.size,0)>8*1024**3)c.addIssue({code:'custom',message:'Expanded release too large'})
})
export type NativeArchiveManifest=z.infer<typeof nativeArchiveManifestSchema>
const nativeCatalogSchema=z.object({
  schema:z.literal('qilicense-release-v2'),packageKey:key,type:z.enum(['framework','app','plugin']),parentApp:key.nullable(),version,channel:z.enum(['stable','beta']),
  applicationMode:z.literal('STANDALONE').optional(),
  frameworkRange:z.string().min(1).max(100),minimumDirectUpgrade:version,requiredUpgradeHops:z.array(version).max(0),
  dependencies:nativeArchiveManifestSchema.shape.dependencies,files,migrations:nativeArchiveManifestSchema.shape.migrations,
  artifactSha256:hash,artifactPackageType:nativeArchiveManifestSchema.shape.package_type,artifactFromVersion:version,releaseManifestSha256:hash,
  runtime:nativeArchiveManifestSchema.shape.runtime,framework:nativeArchiveManifestSchema.shape.framework,entrypoint:nativePathSchema,
  databaseCompatibility:z.literal('backward-compatible'),
}).strict()
export const nativeReleaseManifestSchema=nativeCatalogSchema.superRefine((m,c)=>{
  if(m.artifactPackageType!==`${m.type}_update`||m.minimumDirectUpgrade!==m.artifactFromVersion||(m.type!=='plugin'&&m.parentApp!==null)
    ||(m.type==='plugin'&&!m.framework&&!m.parentApp)
    ||(m.parentApp&&!m.dependencies.some(d=>d.packageKey===m.parentApp))
    ||m.frameworkRange!==(m.framework?.range??'*'))c.addIssue({code:'custom',message:'Native catalog identity mismatch'})
  const result=nativeArchiveManifestSchema.safeParse(nativeArchiveFromCatalog(m))
  if(!result.success)c.addIssue({code:'custom',message:'Invalid full release manifest'})
})
export function nativeArchiveFromCatalog(m:z.infer<typeof nativeCatalogSchema>):NativeArchiveManifest {
  return {format:'qilicense-full-release-v1',package_type:m.artifactPackageType,package_key:m.packageKey,from_version:m.artifactFromVersion,version:m.version,
    ...(m.applicationMode ? {applicationMode:m.applicationMode} : {}),
    files:m.files,runtime:m.runtime,framework:m.framework,entrypoint:m.entrypoint,dependencies:m.dependencies,migrations:m.migrations,databaseCompatibility:m.databaseCompatibility}
}
export const nativeSignaturePayloadSchema=z.object({format:z.literal('qilicense-release-payload-v3'),product:key,package_type:nativeArchiveManifestSchema.shape.package_type,
  package_key:key,from_version:version,version,key_id:z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),archive_sha256:hash,
  archive_size:z.string().regex(/^[1-9]\d{0,9}$/).refine(v=>BigInt(v)<=2147483648n),release_manifest_sha256:hash,
}).strict().refine(p=>p.product===p.package_key,'Product must equal component identity')
