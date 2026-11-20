import {generateKeyPairSync,createHash,sign} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {canonicalJson} from '../../dist/license/contracts.js'
import {nativeArchiveFromCatalog,NATIVE_SIGNATURE_DOMAIN} from '../../dist/applications/standalone-archive.js'
import {zip} from './native-release.mjs'
const digest=value=>createHash('sha256').update(value).digest('hex')
export function fixtureProduct(key='app_fixture_main',version='1.0.0'){
  const receipt=generateKeyPairSync('ed25519'),release=generateKeyPairSync('ed25519')
  function anchor(keys){const bytes=keys.publicKey.export({type:'spki',format:'der'});return {publicKey:bytes.toString('base64'),sha256:digest(bytes.subarray(-32))}}
  const issuer=anchor(receipt),signer=anchor(release)
  return {product:{product:'fixture-enterprise',appKey:key,componentType:'app',deliveryKind:'archive',version,licenseApi:'https://fixture.invalid/api/v1/',
    receiptKeyId:'receipt',receiptPublicKey:issuer.publicKey,receiptPublicKeySha256:issuer.sha256,archiveReleaseKeys:{release:{...signer,role:'component_update'}}},privateKey:release.privateKey,receiptKeys:receipt}
}
export async function signedFixture(root,privateKey,packageKey='app_fixture_main',version='1.0.0'){
  const entries=[]
  async function visit(directory,prefix=''){for(const item of await readdir(directory,{withFileTypes:true})){
    const path=prefix+item.name
    if(item.isDirectory())await visit(join(directory,item.name),path+'/')
    else entries.push({path,data:await readFile(join(directory,item.name))})
  }}
  await visit(root)
  const manifest={schema:'qilicense-release-v2',packageKey:packageKey,type:'app',parentApp:null,version,channel:'stable',applicationMode:'STANDALONE',frameworkRange:'*',
    minimumDirectUpgrade:'0.0.0',requiredUpgradeHops:[],dependencies:[],files:entries.map(e=>({path:e.path,size:e.data.length,sha256:digest(e.data)})),migrations:[],
    artifactSha256:'0'.repeat(64),artifactPackageType:'app_update',artifactFromVersion:'0.0.0',releaseManifestSha256:'0'.repeat(64),
    runtime:{name:'node',major:24,platform:'linux',arch:'x64'},framework:null,entrypoint:'server/start.mjs',databaseCompatibility:'backward-compatible'}
  const raw=canonicalJson(nativeArchiveFromCatalog(manifest))+'\n'
  const archive=zip([...entries,{path:'release-manifest.json',data:raw}])
  manifest.artifactSha256=digest(archive);manifest.releaseManifestSha256=digest(raw)
  const payload={format:'qilicense-release-payload-v3',product:packageKey,package_type:'app_update',package_key:packageKey,
    from_version:'0.0.0',version,key_id:'release',archive_sha256:digest(archive),archive_size:String(archive.length),release_manifest_sha256:digest(raw)}
  const encoded=Buffer.from(canonicalJson(payload))
  const signatureEnvelope={format:'qilicense-release-signature-v2',algorithm:'Ed25519',key_id:'release',payload:encoded.toString('base64url'),
    signature:sign(null,Buffer.concat([Buffer.from(NATIVE_SIGNATURE_DOMAIN),encoded]),privateKey).toString('base64url')}
  return {format:'qicore-initial-release-v1',version,channel:'stable',releaseNotes:'隔离夹具',migrations:[],manifest,
    artifact:{version,sha256:digest(archive),size:String(archive.length),manifestSha256:digest(raw),packageType:'app_update',packageKey:packageKey,fromVersion:'0.0.0',signatureEnvelope}}
}
