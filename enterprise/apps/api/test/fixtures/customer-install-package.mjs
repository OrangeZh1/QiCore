import assert from 'node:assert/strict';
import {mkdir,readFile,lstat,readdir} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import yauzl from 'yauzl';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileHash,noLinks} from '../../dist/lifecycle/native-files.js';
import {verifyNativeInitialRelease} from '../../dist/license/native-updates.js';
import {nativeArchiveFromCatalog} from '../../dist/license/native-release.js';
import {validateProduct} from '../../dist/license/client.js';
import {bootstrapDeliverySchema} from '../../dist/lifecycle/bootstrap-delivery.js';
import {verifyBootstrapInventory} from '../../../../scripts/bootstrap-inventory.mjs';

export async function extractCustomerInstallZip(archive,expectedSha256,destination){
 assert.ok(isAbsolute(archive)&&isAbsolute(destination),'Absolute customer ZIP and extraction paths required');
 assert.match(expectedSha256,/^[a-f0-9]{64}$/);noLinks(archive);noLinks(destination);
 const info=await lstat(archive);assert.ok(info.isFile()&&info.nlink===1,'Customer ZIP must be a regular single-link file');
 assert.equal(await fileHash(archive),expectedSha256,'CUSTOMER_ZIP_DIGEST_MISMATCH');await mkdir(destination);
 const zip=await new Promise((ok,fail)=>yauzl.open(archive,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?fail(error):ok(value)));
 const names=new Set(),files=[];let total=0;
 try{
  assert.ok(zip.entryCount<=60000,'CUSTOMER_ZIP_TOO_LARGE');
  const entries=await new Promise((ok,fail)=>{const list=[];zip.on('error',fail);zip.on('entry',entry=>{list.push(entry);zip.readEntry()});zip.once('end',()=>ok(list));zip.readEntry()});
  for(const entry of entries){
   const name=entry.fileName,parts=name.split('/'),type=(entry.externalFileAttributes>>>16)&0o170000;
   assert.ok(parts.every(p=>/^[A-Za-z0-9_@+.-]+$/.test(p)&&p!=='.'&&p!=='..'&&!p.endsWith('.')),'CUSTOMER_ZIP_PATH_UNSAFE');
   assert.ok(!names.has(name.toLowerCase()),'CUSTOMER_ZIP_DUPLICATE');names.add(name.toLowerCase());
   assert.ok((type===0||type===0o100000)&&!(entry.generalPurposeBitFlag&1),'CUSTOMER_ZIP_ENTRY_UNSAFE');
   assert.ok(name.startsWith('bootstrap/')||name.startsWith('incoming/')||['INSTALL.md','deployment.json','deployment.example.json'].includes(name),'CUSTOMER_ZIP_UNEXPECTED_ROOT');
   assert.ok(!parts.some(p=>/^(?:\.env(?:\..*)?|identity\.json|receipt\.json|runtime\.env|\.git|\.local)$/.test(p))&&!/\.(pem|key)$/i.test(name),'CUSTOMER_ZIP_PRIVATE_FILE');
   total+=entry.uncompressedSize;assert.ok(entry.uncompressedSize<=512*1024**2&&total<=1024**3&&names.size<=60000,'CUSTOMER_ZIP_TOO_LARGE');
  }
  for(const entry of entries){
   const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(error,value)=>error?no(error):yes(value)));let length=0;
   const count=new Transform({transform(bytes,_encoding,done){length+=bytes.length;if(length>entry.uncompressedSize){done(Error('CUSTOMER_ZIP_SIZE_MISMATCH'));return}done(null,bytes)}});
   const path=join(destination,entry.fileName);await mkdir(dirname(path),{recursive:true});await pipeline(stream,count,createWriteStream(path,{flags:'wx',mode:0o644}));assert.equal(length,entry.uncompressedSize);files.push(entry.fileName);
  }
 }finally{zip.close()}
 const bootstrap=join(destination,'bootstrap');await verifyBootstrapInventory(bootstrap);
 const delivery=bootstrapDeliverySchema.parse(JSON.parse(await readFile(join(bootstrap,'delivery.json'),'utf8')));validateProduct(delivery.product);
 // The schema validates the account name; production runtimeIdentity additionally rejects UID 0.
 assert.notEqual(delivery.runtimeUser,'root','CUSTOMER_RUNTIME_USER_REQUIRED');
 assert.equal(delivery.product.product,'qicore');assert.equal(delivery.product.appKey,'frm_cdm43f43e7yhk5jd');
 const releaseFile=join(destination,'incoming/release.json'),release=verifyNativeInitialRelease(delivery.product,JSON.parse(await readFile(releaseFile,'utf8')));
 assert.equal(release.format,'qicore-initial-release-v2');assert.equal(release.version,delivery.product.version);
 const bootstrapManifest=JSON.parse(await readFile(join(bootstrap,'bootstrap-manifest.json'),'utf8'));
 assert.equal(bootstrapManifest.format,'qicore-bootstrap-v1');assert.equal(bootstrapManifest.product,'qicore');assert.equal(bootstrapManifest.packageKey,delivery.product.appKey);assert.equal(bootstrapManifest.version,release.version);assert.equal(bootstrapManifest.initialReleaseFormat,release.format);
 assert.equal(bootstrapManifest.updatePlanCapability,'native-full-v3','CUSTOMER_BOOTSTRAP_CAPABILITY_REQUIRED');
 assert.equal(bootstrapManifest.applicationLifecycleCapability,'native-lifecycle-v2','CUSTOMER_BOOTSTRAP_CAPABILITY_REQUIRED');
 const bootstrapManifestSha256=await fileHash(join(bootstrap,'bootstrap-manifest.json'));
 const runtimeName=`qicore-${release.version}-linux-${release.manifest.runtime.arch}.zip`;assert.equal(delivery.archive,runtimeName);
 assert.deepEqual(files.filter(name=>name.startsWith('incoming/')).sort(),['incoming/'+runtimeName,'incoming/release.json'].sort());
 for(const path of ['INSTALL.md','deployment.example.json','bootstrap/start.mjs','bootstrap/controller.mjs'])assert.ok(files.includes(path),path+' required');
 const runtime=join(destination,'incoming',runtimeName);assert.equal(String((await lstat(runtime)).size),release.artifact.size);assert.equal(await fileHash(runtime),release.artifact.sha256);
 const snapshots=await Promise.all(files.map(async path=>({path,sha256:await fileHash(join(destination,path))})));
 const folders=new Set(files.flatMap(path=>path.split('/').slice(0,-1).map((_,i)=>path.split('/').slice(0,i+1).join('/'))));folders.add('.well-known');
 const verifyUnchanged=async()=>{
  assert.equal(await fileHash(archive),expectedSha256);noLinks(destination);const actual=[];
  async function walk(dir,prefix=''){
   for(const name of await readdir(dir)){
    const path=join(dir,name),key=prefix+name,info=await lstat(path);assert.ok(!info.isSymbolicLink(),'CUSTOMER_TREE_LINK_REJECTED');
    if(info.isDirectory()){assert.ok(folders.has(key),'CUSTOMER_DIRECTORY_ADDED');await walk(path,key+'/')}
    else{assert.ok(info.isFile()&&info.nlink===1,'CUSTOMER_FILE_UNSAFE');actual.push(key)}
   }
  }
  await walk(destination);assert.deepEqual(actual.sort(),[...files].sort(),'CUSTOMER_FILE_INVENTORY_CHANGED');
  await verifyBootstrapInventory(bootstrap);for(const file of snapshots)assert.equal(await fileHash(join(destination,file.path)),file.sha256,'Customer package changed: '+file.path);
 };
 return {root:destination,bootstrap,releaseFile,release,runtime,manifest:nativeArchiveFromCatalog(release.manifest),zipSha256:expectedSha256,bootstrapManifestSha256,files:files.length,verifyUnchanged};
}
