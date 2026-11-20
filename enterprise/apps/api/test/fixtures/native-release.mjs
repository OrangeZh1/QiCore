import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {crc32} from 'node:zlib';
import {canonicalJson} from '../../dist/license/contracts.js';
import {nativeArchiveFromCatalog,NATIVE_SIGNATURE_DOMAIN,QICORE_FRAMEWORK_KEY} from '../../dist/license/native-release.js';
import {LicenseClient} from '../../dist/license/client.js';
import {StateStore} from '../../dist/license/store.js';
import {NativeState} from '../../dist/lifecycle/native-state.js';
export const hash=v=>createHash('sha256').update(v).digest('hex');
export function zip(entries){
  const local=[],central=[];let offset=0;
  for(const e of entries){const name=Buffer.from(e.path),data=Buffer.from(e.data),crc=crc32(data),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(((e.mode??0o100644)<<16)>>>0,38);c.writeUInt32LE(offset,42);
    local.push(h,name,data);central.push(c,name);offset+=h.length+name.length+data.length;
  }
  const tail=Buffer.alloc(22),directory=Buffer.concat(central);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(entries.length,8);tail.writeUInt16LE(entries.length,10);tail.writeUInt32LE(directory.length,12);tail.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,tail]);
}
export function initialRelease(release){
 const {publishedAt,...metadata}=release,{releaseId,downloadUrl,...artifact}=metadata.artifact;
 return {...metadata,format:'qicore-initial-release-v1',artifact};
}
export function fixture(root,options={}){
  const frameworkKey=options.frameworkKey||'frm_fixture';
  const receipt=generateKeyPairSync('ed25519'),framework=generateKeyPairSync('ed25519'),application=generateKeyPairSync('ed25519');
  const anchor=(pair,role)=>({publicKey:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),sha256:hash(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32)),role});
  const product={product:'qicore',version:options.version||'1.0.0',appKey:frameworkKey,componentType:'framework',deliveryKind:'archive',licenseApi:'https://license.example/api/v1/',receiptKeyId:'receipt',receiptPublicKey:anchor(receipt).publicKey,receiptPublicKeySha256:anchor(receipt).sha256,archiveReleaseKeys:{framework:anchor(framework,'framework_update'),application:anchor(application,'component_update')}};
  const client=new LicenseClient(new StateStore(join(root,'license')),product,'127.0.0.1');const id=client.identity(true).instanceId;
  const envelope=payload=>{const bytes=Buffer.from(canonicalJson(payload));return{key_id:'receipt',payload:bytes.toString('base64url'),signature:sign(null,bytes,receipt.privateKey).toString('base64url')}};
  const now=Date.now(),iso=ms=>new Date(ms).toISOString();
  client.acceptReceipt(envelope({protocol:'license-api-v2',key_id:'receipt',issuer:'https://license.mcent.cn',audience:'qiadmin-runtime',license_id:'license-test',revision:1,product_id:product.appKey,instance_id:id,instance_public_key_sha256:id,authorized_domain:'127.0.0.1',authorized_server_ip:null,mode:'domain',domain_matched:true,server_ip_matched:null,decision:'allow',reason_code:'AUTHORIZED',decision_id:'decision-test',entitlements:[{packageKey:frameworkKey,type:'framework',useExpiresAt:null,updatesExpiresAt:null,channel:'stable'},{packageKey:options.applicationPackageKey||'app_fixture',type:'app',useExpiresAt:null,updatesExpiresAt:null,channel:'stable',...(options.applicationTenantLimit===undefined?{}:{tenantLimit:options.applicationTenantLimit})}],issued_at:iso(now-1000),refresh_after:iso(now+60000),online_valid_until:iso(now+3600000),grace_until:iso(now+7200000),binding_directive:null}));
  function release(packageKey=frameworkKey,version='2.0.0',from='1.0.0',files={'server/main.mjs':'console.log("fixture")'},changes={}){
    const type=changes.type??(packageKey.startsWith('app_')?'app':'framework'),app=type!=='framework',keyId=app?'application':'framework';
    const manifest={schema:'qilicense-release-v2',packageKey,type,parentApp:null,version,channel:'stable',frameworkRange:app?'^1.0.0':'*',minimumDirectUpgrade:from,requiredUpgradeHops:[],dependencies:[],files:Object.entries(files).map(([path,data])=>({path,size:Buffer.byteLength(data),sha256:hash(data)})),migrations:[],artifactSha256:'0'.repeat(64),artifactPackageType:type+'_update',artifactFromVersion:from,releaseManifestSha256:'0'.repeat(64),runtime:{name:'node',major:24,platform:'linux',arch:'x64'},framework:app?{packageKey:frameworkKey,range:'^1.0.0'}:null,entrypoint:'server/main.mjs',databaseCompatibility:'backward-compatible',...changes};
    const archiveManifest=nativeArchiveFromCatalog(manifest),raw=canonicalJson(archiveManifest)+'\n';
    const entries=[...Object.entries(files).map(([path,data])=>({path,data})),{path:'release-manifest.json',data:raw}];
    const archive=zip(entries);manifest.artifactSha256=hash(archive);manifest.releaseManifestSha256=hash(raw);
    const payload={format:'qilicense-release-payload-v3',product:packageKey,package_type:manifest.artifactPackageType,package_key:packageKey,from_version:from,version,key_id:keyId,archive_sha256:hash(archive),archive_size:String(archive.length),release_manifest_sha256:hash(raw)};
    const bytes=Buffer.from(canonicalJson(payload)),signatureEnvelope={format:'qilicense-release-signature-v2',algorithm:'Ed25519',key_id:keyId,payload:bytes.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from(NATIVE_SIGNATURE_DOMAIN),bytes]),(app?application:framework).privateKey).toString('base64url')};
    return {archive,entries,files,release:{version,channel:'stable',releaseNotes:'修复：原生完整包测试',publishedAt:iso(now-1000),artifact:{releaseId:'release_'+hash(archive).slice(0,16),version,sha256:hash(archive),size:String(archive.length),manifestSha256:hash(raw),packageType:manifest.artifactPackageType,packageKey,fromVersion:from,signatureEnvelope,downloadUrl:'/api/v1/updates/artifacts/release_'+hash(archive).slice(0,16)},manifest,migrations:manifest.migrations}};
  }
  function plan(release,installed=[{packageKey:frameworkKey,version:'1.0.0'}],target=frameworkKey,capability=frameworkKey===QICORE_FRAMEWORK_KEY?'native-full-v3':'native-full-v2'){
    const steps=release?[{...release,component:{packageKey:release.manifest.packageKey,type:release.manifest.type,name:'Fixture'},fromVersion:release.artifact.fromVersion,targetVersion:release.version,requiredUpgradeHops:[],upgradeHops:[]}]:[];
    return {protocol:'license-api-v2',key_id:'receipt',planId:'plan_'+randomUUID(),licenseId:'license-test',licenseRevision:1,instanceId:id,generatedAt:iso(now),validUntil:iso(now+600000),requiresConfirmation:true,steps,nativeContext:{capability,productId:frameworkKey,domain:'127.0.0.1',targetPackageKeys:[target],installed}};
  }
  const config={root:join(root,'code'),stateRoot:join(root,'state'),dataRoot:join(root,'data'),socket:join(root,'updater.sock'),frameworkKey,healthUrl:'http://127.0.0.1:3401/health',loginUrl:'http://127.0.0.1:3400/admin/login',runtimeUid:10001,runtimeGid:10001,environmentFile:join(root,'native.env'),licenseStateRoot:join(root,'license'),product,migrationUrl:'mysql://test:test@127.0.0.1/zjz_test',backupRoot:join(root,'backups'),backupKeyRoot:join(root,'backup-key'),mysqldump:'mysqldump'};
  mkdirSync(config.root);if(!options.initial)writeFileSync(config.environmentFile,'');const state=new NativeState(config);
  async function install(f){const r=f.release,key=r.manifest.packageKey,slot=state.slot(r),store=state.component(key);store.write(`release-${r.artifact.manifestSha256}.json`,r);const path=state.path(key,slot);mkdirSync(path,{recursive:true});for(const [name,data]of Object.entries(f.files)){mkdirSync(dirname(join(path,name)),{recursive:true});writeFileSync(join(path,name),data)}await state.registerHealthyInstallation(r,randomUUID(),async()=>{});return slot}
  function signArchive(m,archive){
    const raw=canonicalJson(m)+'\n',digest=hash(archive),manifestSha256=hash(raw),app=m.package_type==='app_update',keyId=app?'application':'framework';
    const payload={format:'qilicense-release-payload-v3',product:m.package_key,package_type:m.package_type,package_key:m.package_key,from_version:m.from_version,version:m.version,key_id:keyId,archive_sha256:digest,archive_size:String(archive.length),release_manifest_sha256:manifestSha256};
    const bytes=Buffer.from(canonicalJson(payload)),signatureEnvelope={format:'qilicense-release-signature-v2',algorithm:'Ed25519',key_id:keyId,payload:bytes.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from(NATIVE_SIGNATURE_DOMAIN),bytes]),(app?application:framework).privateKey).toString('base64url')};
    const release={version:m.version,channel:'stable',releaseNotes:'Isolated full package verification',publishedAt:iso(now-1000),artifact:{releaseId:'release_'+digest.slice(0,16),version:m.version,sha256:digest,size:String(archive.length),manifestSha256,packageType:m.package_type,packageKey:m.package_key,fromVersion:m.from_version,signatureEnvelope,downloadUrl:'/api/v1/updates/artifacts/release_'+digest.slice(0,16)},manifest:{schema:'qilicense-release-v2',packageKey:m.package_key,type:app?'app':'framework',parentApp:null,version:m.version,channel:'stable',frameworkRange:m.framework?.range||'*',minimumDirectUpgrade:m.from_version,requiredUpgradeHops:[],dependencies:m.dependencies,files:m.files,migrations:m.migrations,artifactSha256:digest,artifactPackageType:m.package_type,artifactFromVersion:m.from_version,releaseManifestSha256:manifestSha256,runtime:m.runtime,framework:m.framework,entrypoint:m.entrypoint,databaseCompatibility:m.databaseCompatibility},migrations:m.migrations};
    return !app&&m.from_version==='0.0.0'?initialRelease(release):release;
  }
  return {client,product,envelope,release,plan,state,install,signArchive};
}
