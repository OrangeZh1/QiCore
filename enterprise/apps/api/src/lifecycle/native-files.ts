import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,readdirSync,openSync,closeSync,fsyncSync,statfsSync,chmodSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform,Writable} from 'node:stream';
import yauzl from 'yauzl';
import {canonicalJson,LICENSE_PROTOCOL_VERSION} from '../license/contracts.js';
import {nativePathSchema,nativeArchiveFromCatalog,type NativeArchiveManifest} from '../license/native-release.js';
import {type NativeRelease,type NativeStoredRelease,verifyNativeRelease,sha256} from '../license/native-updates.js';
import type {LicenseClient} from '../license/client.js';
import type {IntegrityIssue} from './update-engine.js';

function integrityFailure(code:string,path:string,kind:IntegrityIssue['kind']):never {throw Object.assign(Error(code),{integrity:[{path,kind}]})}

export function noLinks(path:string){
  for(let p=resolve(path);;p=dirname(p)){
    if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('NATIVE_PATH_UNSAFE');
    if(dirname(p)===p)break;
  }
}
export function syncDirectory(path:string){if(process.platform!=='win32'){const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}}
export async function fileHash(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
export async function verifyNativeTree(root:string,manifest:NativeArchiveManifest,allowDamaged=false){
  const issues:IntegrityIssue[]=[];
  const report=(code:string,path:string,kind:IntegrityIssue['kind'])=>{if(allowDamaged&&['modified','missing'].includes(kind))issues.push({path,kind});else integrityFailure(code,path,kind)};
  noLinks(root);if(!existsSync(root)){report('RELEASE_FILE_MISSING',manifest.entrypoint,'missing');return issues}
  if(!lstatSync(root).isDirectory())throw Error('NATIVE_PATH_UNSAFE');
  const expected=new Map(manifest.files.map(f=>[f.path,f])),found=new Set<string>();
  const folders=new Set(manifest.files.flatMap(f=>f.path.split('/').slice(0,-1).map((_,i)=>f.path.split('/').slice(0,i+1).join('/'))));
  async function walk(directory:string,prefix=''){
    for(const name of readdirSync(directory)){
      const relative=prefix+name,path=join(directory,name),s=lstatSync(path);
      if(s.isSymbolicLink())integrityFailure('NATIVE_PATH_UNSAFE',relative,'unsafe');
      if(s.isDirectory()){if(!folders.has(relative))integrityFailure('UNDECLARED_RELEASE_FILE',relative,'unknown');await walk(path,relative+'/');continue}
      const file=expected.get(relative);
      if(!s.isFile()||s.nlink!==1||!file)integrityFailure('UNDECLARED_RELEASE_FILE',relative,'unknown');
      if(s.size!==file.size||await fileHash(path)!==file.sha256)report('LOCAL_RELEASE_MODIFIED',relative,'modified');
      found.add(relative);
    }
  }
  await walk(root);for(const path of expected.keys())if(!found.has(path))report('RELEASE_FILE_MISSING',path,'missing');return issues;
}
export async function downloadNativeArchive(client:LicenseClient,release:NativeRelease,planId:string,path:string,fetcher=fetch){
  release=verifyNativeRelease(client.product,release);
  noLinks(path);
  const a=release.artifact,access=await client.machine(`updates/artifacts/${a.releaseId}/access`,{protocol:LICENSE_PROTOCOL_VERSION,planId});
  if(typeof access.accessToken!=='string'||!/^[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{43}$/.test(access.accessToken)
    ||!Number.isFinite(Date.parse(access.expiresAt))||Date.parse(access.expiresAt)<=Date.now()||Date.parse(access.expiresAt)>Date.now()+65000)throw Error('DOWNLOAD_GRANT_INVALID');
  const url=new URL(a.downloadUrl,client.product.licenseApi),base=new URL(client.product.licenseApi);
  if(url.origin!==base.origin||url.protocol!=='https:'||url.pathname!==`/api/v1/updates/artifacts/${a.releaseId}`)throw Error('DOWNLOAD_URL_INVALID');
  const response=await fetcher(url,{headers:{authorization:`Bearer ${access.accessToken}`,'accept-encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(15*60000)});
  if(!response.ok||!response.body||response.headers.get('content-encoding')&&response.headers.get('content-encoding')!=='identity'
    ||response.headers.get('content-length')!==a.size){await response.body?.cancel();throw Error('DOWNLOAD_RESPONSE_INVALID')}
  let bytes=0;const hash=createHash('sha256');
  await pipeline(Readable.fromWeb(response.body as any),new Transform({transform(chunk:Buffer,_,done){bytes+=chunk.length;if(bytes>Number(a.size)){done(Error('ARCHIVE_SIZE_MISMATCH'));return}hash.update(chunk);done(null,chunk)}}),createWriteStream(path,{flags:'wx',mode:0o600}));
  if(bytes!==Number(a.size)||hash.digest('hex')!==a.sha256)throw Error('ARCHIVE_DIGEST_MISMATCH');
  const fd=openSync(path,process.platform==='win32'?'r+':'r');try{fsyncSync(fd)}finally{closeSync(fd)}syncDirectory(dirname(path));
}
export async function extractNativeArchive(archive:string,candidate:string,release:NativeStoredRelease){
  noLinks(archive);noLinks(candidate);
  if(existsSync(candidate))throw Error('CANDIDATE_EXISTS');
  if(lstatSync(archive).size!==Number(release.artifact.size)||await fileHash(archive)!==release.artifact.sha256)throw Error('ARCHIVE_DIGEST_MISMATCH');
  const manifest=nativeArchiveFromCatalog(release.manifest),space=statfsSync(dirname(candidate));
  if(space.bavail*space.bsize<manifest.files.reduce((sum,f)=>sum+f.size,0)+64*1024*1024)throw Error('NATIVE_DISK_SPACE_REQUIRED');
  const expected=new Map(manifest.files.map(f=>[f.path,f]));
  const metadata=Buffer.from(canonicalJson(manifest)+'\n');
  if(expected.has('release-manifest.json'))throw Error('RESERVED_RELEASE_PATH');
  expected.set('release-manifest.json',{path:'release-manifest.json',size:metadata.length,sha256:sha256(metadata)});
  const folders=new Set([...expected.keys()].flatMap(p=>p.split('/').slice(0,-1).map((_,i)=>p.split('/').slice(0,i+1).join('/'))));
  const zip=await new Promise<yauzl.ZipFile>((ok,fail)=>yauzl.open(archive,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(e,z)=>e?fail(e):ok(z!)));
  try{
    if(zip.entryCount>expected.size+folders.size)throw Error('UNDECLARED_RELEASE_FILE');
    const entries=await new Promise<yauzl.Entry[]>((ok,fail)=>{const list:yauzl.Entry[]=[];zip.on('error',fail);zip.on('entry',e=>{list.push(e);zip.readEntry()});zip.once('end',()=>ok(list));zip.readEntry()});
    const seen=new Set<string>(),files:yauzl.Entry[]=[];
    for(const e of entries){
      const directory=e.fileName.endsWith('/'),name=directory?e.fileName.slice(0,-1):e.fileName;
      nativePathSchema.parse(name);
      const mode=(e.externalFileAttributes>>>16)&0xf000;
      if((e.generalPurposeBitFlag&1)!==0||![0,8].includes(e.compressionMethod)||![0,0x8000,0x4000].includes(mode)
        ||(mode===0x4000)!==directory&&mode!==0||seen.has(name.toLowerCase()))throw Error('ARCHIVE_ENTRY_UNSAFE');
      seen.add(name.toLowerCase());
      if(directory){if(!folders.has(name)||e.uncompressedSize!==0)throw Error('UNDECLARED_RELEASE_FILE');continue}
      const file=expected.get(name);if(!file||file.size!==e.uncompressedSize)throw Error('ARCHIVE_INVENTORY_MISMATCH');files.push(e);
    }
    if(files.length!==expected.size)throw Error('RELEASE_FILE_MISSING');
    mkdirSync(candidate,{mode:0o755});
    for(const e of files){
      const stream=await new Promise<import('node:stream').Readable>((ok,fail)=>zip.openReadStream(e,(error,s)=>error?fail(error):ok(s!)));
      let bytes=0;const hash=createHash('sha256'),file=expected.get(e.fileName)!;
      const check=new Transform({transform(chunk:Buffer,_,done){bytes+=chunk.length;if(bytes>file.size){done(Error('ARCHIVE_SIZE_MISMATCH'));return}hash.update(chunk);done(null,chunk)}});
      if(e.fileName==='release-manifest.json')await pipeline(stream,check,new Writable({write(_chunk,_encoding,done){done()}}));
      else{const path=join(candidate,e.fileName);mkdirSync(dirname(path),{recursive:true,mode:0o755});await pipeline(stream,check,createWriteStream(path,{flags:'wx',mode:0o644}));const fd=openSync(path,process.platform==='win32'?'r+':'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
      if(bytes!==file.size||hash.digest('hex')!==file.sha256)throw Error('ARCHIVE_FILE_DIGEST_MISMATCH');
    }
    await verifyNativeTree(candidate,manifest);
    // Immutable code must remain readable by the unprivileged runtime even when
    // the controller uses umask 077 for credentials and recovery state.
    const syncTree=(dir:string)=>{chmodSync(dir,0o755);for(const name of readdirSync(dir)){const path=join(dir,name);if(lstatSync(path).isDirectory())syncTree(path);else chmodSync(path,0o644)}syncDirectory(dir)};
    syncTree(candidate);syncDirectory(dirname(candidate));
  }finally{zip.close()}
}
