import {readFile,writeFile,mkdtemp,mkdir,rm,stat,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalJson} from '../apps/api/dist/license/contracts.js';
import {nativeArchiveManifestSchema,nativeReleaseManifestSchema,nativeArtifactIntegritySchema} from '../apps/api/dist/license/native-release.js';
import {sha256,verifyNativeRelease,verifyNativeInitialRelease,verifyNativeLocalRelease} from '../apps/api/dist/license/native-updates.js';
import {extractNativeArchive,fileHash} from '../apps/api/dist/lifecycle/native-files.js';
import {validateProduct} from '../apps/api/dist/license/client.js';
import {bootstrapDeliverySchema} from '../apps/api/dist/lifecycle/bootstrap-delivery.js';
import {deploymentOverridesSchema} from '../apps/api/dist/lifecycle/bootstrap-deployment.js';

const json=async file=>JSON.parse(await readFile(file,'utf8'));
const productFor=async(file,version)=>{const product={...await json(file),version};validateProduct(product);return product};
async function temporary(work){const root=await mkdtemp(join(tmpdir(),'qicore-delivery-'));try{return await work(root)}finally{if(dirname(resolve(root))!==resolve(tmpdir()))throw Error('DELIVERY_CLEANUP_PATH_INVALID');await rm(root,{recursive:true,force:true})}}
const save=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});

// Retired commands fail before inspecting any private-key path.
export async function signNativeCandidate(){throw Error('RELEASE_SIGNING_REMOVED_USE_PREPARE')}
export async function signNativeUpdateCandidate(){throw Error('RELEASE_SIGNING_REMOVED_USE_PREPARE_UPDATE')}
export async function prepareNativeCandidate(input){return prepareCandidate(input,true)}
export async function prepareNativeUpdateCandidate(input){return prepareCandidate(input,false)}
async function prepareCandidate(input,initial){
 if(['keyFile','keyId','signature','signatureEnvelope'].some(key=>input[key]!==undefined))throw Error('RELEASE_SIGNING_INPUT_REMOVED');
 const archive=resolve(input.archive),m=nativeArchiveManifestSchema.parse(await json(input.manifest)),product=await productFor(input.product,m.version);
 if(product.product!=='qicore'||product.appKey!=='frm_cdm43f43e7yhk5jd'||product.deliveryKind!=='archive')throw Error('QICORE_FRAMEWORK_REQUIRED');
 const framework=m.package_type==='framework_update'&&m.package_key===product.appKey;
 const photo=m.package_type==='app_update'&&m.package_key==='app_kmqjjt72urnxp526'&&m.framework?.packageKey===product.appKey;
 if(initial&&(!framework||m.from_version!=='0.0.0'))throw Error('INITIAL_FRAMEWORK_RELEASE_REQUIRED');
 if(!framework&&!photo)throw Error('ORDINARY_RELEASE_PRODUCT_REQUIRED');
 if(!initial){const from=m.from_version.split('.').map(Number),to=m.version.split('.').map(Number),changed=from.findIndex((value,index)=>value!==to[index]);if(m.from_version==='0.0.0'||changed<0||to[changed]<from[changed])throw Error('ONLINE_UPDATE_RELEASE_REQUIRED');}
 const artifactSha256=await fileHash(archive),artifactSize=String((await stat(archive)).size),raw=canonicalJson(m)+'\n';
 const manifest=nativeReleaseManifestSchema.parse({schema:'qilicense-release-v2',packageKey:m.package_key,type:photo?'app':'framework',parentApp:null,version:m.version,channel:'stable',frameworkRange:m.framework?.range??'*',minimumDirectUpgrade:m.from_version,requiredUpgradeHops:[],dependencies:m.dependencies,files:m.files,migrations:m.migrations,artifactSha256,artifactPackageType:m.package_type,artifactFromVersion:m.from_version,releaseManifestSha256:sha256(raw),runtime:m.runtime,framework:m.framework,entrypoint:m.entrypoint,databaseCompatibility:m.databaseCompatibility});
 await temporary(root=>extractNativeArchive(archive,join(root,'verified'),{manifest,artifact:{size:artifactSize,sha256:artifactSha256}}));
 if(typeof input.releaseNotes!=='string'||!input.releaseNotes.trim()||input.releaseNotes.length>5000)throw Error('RELEASE_NOTES_REQUIRED');
 const integrity=nativeArtifactIntegritySchema.parse({format:photo?'id-photo-release-integrity-v1':'qicore-release-integrity-v1',...(photo?{framework_package_key:product.appKey}:{}),package_key:m.package_key,package_type:m.package_type,from_version:m.from_version,version:m.version,archive_sha256:artifactSha256,archive_size:artifactSize,release_manifest_sha256:sha256(raw)});
 const fields={manifest:canonicalJson(manifest),releaseManifest:raw,releaseNotes:input.releaseNotes};
 const metadata={format:initial?'qicore-initial-release-v2':'qicore-local-release-v2',version:m.version,channel:'stable',releaseNotes:input.releaseNotes,manifest,migrations:manifest.migrations,
  artifact:{version:m.version,sha256:artifactSha256,size:artifactSize,manifestSha256:manifest.releaseManifestSha256,packageType:m.package_type,packageKey:m.package_key,fromVersion:m.from_version,integrity}};
 const release=(initial?verifyNativeInitialRelease:verifyNativeLocalRelease)(product,metadata);
 await save(input.output,{archive,sha256:artifactSha256,size:artifactSize,fields,...(initial?{initialRelease:release}:{localRelease:release})});return{output:resolve(input.output),sha256:artifactSha256,signed:false,published:false};
}

export function releaseFromPublished(row,product){
 if(row.status!=='PUBLISHED'||row.channel!=='STABLE'||row.deliveryKind!=='ARCHIVE'||!row.id||!row.publishedAt)throw Error('PUBLISHED_RELEASE_REQUIRED');
 const manifest=nativeReleaseManifestSchema.parse(row.manifest);
 if(row.component?.packageKey!==manifest.packageKey||row.version!==manifest.version||row.artifactSha256!==manifest.artifactSha256)throw Error('PUBLISHED_RELEASE_MISMATCH');
 if(typeof row.signature!=='string'||!row.signature.trim())throw Error('PUBLISHED_RELEASE_EVIDENCE_REQUIRED');
 const evidence=JSON.parse(row.signature);let envelope;
 if(['qicore-release-integrity-v1','id-photo-release-integrity-v1'].includes(evidence.format)){
  if(row.signatureKeyId!=='')throw Error('PUBLISHED_RELEASE_MISMATCH');
  envelope={integrity:nativeArtifactIntegritySchema.parse(evidence)};
 }else if(evidence.format==='qilicense-release-signature-v2'&&row.signatureKeyId===evidence.key_id){
  envelope={signatureEnvelope:evidence};
 }else throw Error('PUBLISHED_RELEASE_MISMATCH');
 return verifyNativeRelease(product,{version:row.version,channel:'stable',releaseNotes:row.releaseNotes,publishedAt:row.publishedAt,manifest,migrations:manifest.migrations,artifact:{releaseId:row.id,version:row.version,sha256:row.artifactSha256,size:String(row.artifactSize),manifestSha256:manifest.releaseManifestSha256,packageType:manifest.artifactPackageType,packageKey:manifest.packageKey,fromVersion:manifest.artifactFromVersion,...envelope,downloadUrl:'/api/v1/updates/artifacts/'+row.id}});
}

export async function buildCustomerDelivery(input){
 if(input.origin!==undefined)throw Error('CUSTOMER_DELIVERY_ORIGIN_REMOVED: 通用包自动识别宝塔域名；请删除旧 origin 字段。指定客户的覆盖项请显式使用 deployment。');
 const candidate=await json(input.candidate),product=await productFor(input.product,candidate.initialRelease?.version),release=verifyNativeInitialRelease(product,candidate.initialRelease),report=await json(input.bootstrapReport);
 if(release.artifact.fromVersion!=='0.0.0'||release.manifest.migrations.length||release.manifest.packageKey!==product.appKey)throw Error('INITIAL_FRAMEWORK_RELEASE_REQUIRED');
 if(release.format!=='qicore-initial-release-v2'||report.initialReleaseFormat!==release.format)throw Error('BOOTSTRAP_INITIAL_RELEASE_UNSUPPORTED');
 if(report.version!==release.version||await fileHash(input.bootstrap)!==report.sha256)throw Error('BOOTSTRAP_ARCHIVE_MISMATCH');
 const archive=`qicore-${release.version}-linux-${release.manifest.runtime.arch}.zip`,delivery=bootstrapDeliverySchema.parse({format:'qicore-bootstrap-delivery-v1',product,archive,runtimeUser:input.runtimeUser||'www',...(input.privateRoot?{privateRoot:input.privateRoot}:{}),...(input.backupRoot?{backupRoot:input.backupRoot}:{})});
 const overrides=deploymentOverridesSchema.parse(input.deployment??{});
 const output=resolve(input.output);await mkdir(output);
 return temporary(async root=>{
  await extractNativeArchive(input.runtime,join(root,'verified-runtime'),release);
  const runtimeProduct=await json(join(root,'verified-runtime/config/license-product.json'));
  if(canonicalJson({...runtimeProduct,version:release.version})!==canonicalJson(product))throw Error('RUNTIME_PRODUCT_MISMATCH');
  const tree=join(root,'bundle');await mkdir(tree);await mkdir(join(tree,'incoming'));await cp(input.runtime,join(tree,'incoming',archive));await save(join(tree,'incoming/release.json'),release);await save(join(root,'delivery.json'),delivery);
  if(Object.keys(overrides).length)await save(join(tree,'deployment.json'),overrides);
  await save(join(tree,'deployment.example.json'),{adminOrigin:'https://your-domain.example',adminPort:3500,apiPort:3501,uiPort:3502});
  const guide=`# QiCore ${release.version} 安装\n\n将本 ZIP 解压到 /opt/qicore，确认其中有 bootstrap/start.mjs 和 incoming/release.json。\n\n1. 准备 Node.js 24、MySQL 8、Redis、Nginx、flock 和 mysqldump，创建空数据库及专用账号。\n2. 在宝塔添加 Node 通用项目：项目目录 /opt/qicore，启动文件 /opt/qicore/bootstrap/start.mjs，运行用户 root，关闭安装依赖。项目目录必须是安装包总目录，不是 bootstrap 子目录。\n3. 在 Node 项目中绑定客户自己的域名、启用 HTTPS，项目端口默认填 3500。程序只读识别当前项目的域名和端口，不额外修改 Nginx。内部 API 默认 3501、页面默认 3502；端口占用时明确报错，不自动换号。入口、API 和页面以 ${delivery.runtimeUser} 身份运行。\n4. 从启动日志打开客户域名的一次性安装链接，在线核验该域名授权，填写 Redis、数据库和管理员信息并安装。页面、API 和维护状态共用项目入口，无需粘贴或 include Nginx 配置。\n5. 如需改公开端口，在宝塔 Node 项目修改并重启；如需改内部端口，可在安装总目录的 deployment.json 中设置 apiPort 或 uiPort。多域名无法唯一识别时，用同一文件选择已绑定的 adminOrigin；非宝塔环境可参考 deployment.example.json。不要改 bootstrap/delivery.json 或私有配置中的派生字段。\n\n通用包不绑定发行方域名，不需要 pnpm、编译或生成 Prisma Client。默认私有配置目录为 /www/server/nodejs-env/qicore。安装器通过项目总目录的 .well-known 临时公开域名挑战令牌，验证后清理；不公开安装凭据、密码或私钥，不改 Nginx。\n\n已有实例的原维护端口保留兼容；没有新配置且无匹配宝塔项目时沿用原配置。安装/升级恢复中先完成原流程，再切换统一入口；已安装后的域名迁移需独立处理授权。\n\n仅兼容 bootstrap 根部清单外的空白 .htaccess 或宝塔默认注释占位；实际规则、其他额外文件、文件缺失或内容变更仍拒绝启动。保留安装日志和持久恢复记录，不删除后重新安装。\n`;
  const customerGuide=input.guide?await readFile(input.guide,'utf8'):guide;
  await writeFile(join(tree,'INSTALL.md'),customerGuide);
  const filename=`qicore-${release.version}-linux-${release.manifest.runtime.arch}-install.zip`,destination=join(output,filename);
  // Python's standard ZIP library is required only on the issuer's workstation.
  const py=String.raw`import sys,json,zipfile,pathlib,hashlib,re,stat
source,tree,delivery,destination=sys.argv[1:]
root=pathlib.Path(tree)/'bootstrap';root.mkdir()
with zipfile.ZipFile(source) as z:
 manifest=json.loads(z.read('bootstrap-manifest.json'))
 if manifest.get('format')!='qicore-bootstrap-v1' or manifest.get('initialReleaseFormat')!='qicore-initial-release-v2' or manifest.get('product')!='qicore' or manifest.get('packageKey')!='frm_cdm43f43e7yhk5jd' or manifest.get('version')!=json.loads(pathlib.Path(delivery).read_text())['product']['version'] or manifest.get('updatePlanCapability')!='native-full-v3' or manifest.get('applicationLifecycleCapability')!='native-lifecycle-v2': raise ValueError('BOOTSTRAP_MANIFEST_INVALID')
 expected={f['path']:f for f in manifest['files']}
 names=[i.filename for i in z.infolist()]
 if len(names)!=len(set(n.lower() for n in names)) or set(names)!=set(expected)|{'bootstrap-manifest.json'}: raise ValueError('BOOTSTRAP_INVENTORY_MISMATCH')
 for i in z.infolist():
  if any(not re.fullmatch(r'[A-Za-z0-9_@+.-]+',p) or p in ('.','..') for p in i.filename.split('/')) or stat.S_ISLNK(i.external_attr>>16): raise ValueError('BOOTSTRAP_PATH_UNSAFE')
  if i.filename=='bootstrap-manifest.json': continue
  f=expected[i.filename];data=z.read(i)
  if len(data)!=f['size'] or hashlib.sha256(data).hexdigest()!=f['sha256']: raise ValueError('BOOTSTRAP_FILE_CHANGED')
  if i.filename=='bootstrap.example.json': continue
  target=root/i.filename;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
(root/'delivery.json').write_bytes(pathlib.Path(delivery).read_bytes())
manifest['files']=[{'path':p.relative_to(root).as_posix(),'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(root.rglob('*')) if p.is_file()]
(root/'bootstrap-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(pathlib.Path(tree).rglob('*')):
  if p.is_file():
   info=zipfile.ZipInfo(p.relative_to(tree).as_posix());info.create_system=3;info.external_attr=(stat.S_IFREG|0o644)<<16
   z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_STORED if p.suffix=='.zip' else zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(destination) as z:
 if z.testzip(): raise ValueError('DELIVERY_ZIP_INVALID')
`;
  const command=spawnSync(process.platform==='win32'?'python':'python3',['-c',py,resolve(input.bootstrap),tree,join(root,'delivery.json'),destination],{encoding:'utf8',windowsHide:true});if(command.status!==0)throw Error('DELIVERY_ZIP_FAILED: '+command.stderr);
  const digest=await fileHash(destination);await writeFile(join(output,'SHA256SUMS.txt'),digest+'  '+filename+'\n');await writeFile(join(output,'INSTALL.md'),customerGuide);
  const receipt={version:release.version,origin:overrides.adminOrigin??null,deploymentMode:Object.keys(overrides).length?'customer-overrides':'baota-auto',archive:filename,sha256:digest,releaseFormat:release.format,integrityFormat:release.artifact.integrity.format,distribution:'issuer',qiLicensePublicationRequired:false,runtimeSha256:release.artifact.sha256,bootstrapSourceSha256:report.sha256,containsPrivateSigningKey:false,customerBuildRequired:false};await save(join(output,'delivery-report.json'),receipt);return receipt;
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [operation,file]=process.argv.slice(2);
 if(operation==='sign')await signNativeCandidate();
 if(operation==='sign-update')await signNativeUpdateCandidate();
 if(!file||!['prepare','prepare-update','bundle'].includes(operation))throw Error('Use: node scripts/customer-delivery.mjs prepare|prepare-update|bundle INPUT.json');
 console.log(JSON.stringify(await({prepare:prepareNativeCandidate,'prepare-update':prepareNativeUpdateCandidate,bundle:buildCustomerDelivery}[operation])(await json(file))));
}
