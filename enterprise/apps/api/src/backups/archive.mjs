import {readBackupBinding,assertBackupBinding,assertImportBinding,protectionTarget,localBackupBinding} from './standalone-binding.mjs';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {accessSync,existsSync,mkdirSync,lstatSync,readdirSync,readFileSync,writeFileSync,openSync,closeSync,readSync,fsyncSync,renameSync,unlinkSync,rmdirSync,chmodSync,chownSync,createReadStream,createWriteStream,appendFileSync,fstatSync,constants} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {hostname} from 'node:os';
import {pipeline} from 'node:stream/promises';
import {Transform,Writable} from 'node:stream';
import {createGzip,createGunzip} from 'node:zlib';
import {PrismaClient} from '@prisma/client';
import {StateStore} from '../license/store.js';
import {mysqlClientConfig,parseMigrationUrl} from '../lifecycle/database-credentials.js';

const MAGIC=Buffer.from('ZJZBKUP2'),ID=/^backup-[a-zA-Z0-9_-]{16,64}$/;
const fail=code=>{throw Error(code)};
const contained=(parent,child)=>{const r=relative(parent,child);return !r||!r.startsWith('..')&&!isAbsolute(r)};
function noLinks(path){for(let cursor=resolve(path);;cursor=dirname(cursor)){if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())fail('BACKUP_PATH_INVALID');if(dirname(cursor)===cursor)break}}
function alive(pid){try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}
export async function migrationFingerprint(db){
  const rows=await db.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name');
  if(rows.some(r=>!r.finished_at&&!r.rolled_back_at))fail('BACKUP_MIGRATIONS_DIRTY');
  const prisma=rows.filter(r=>r.finished_at&&!r.rolled_back_at).map(r=>[r.migration_name,r.checksum]);
  const tables=await db.$queryRawUnsafe("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='_qicore_migrations'");
  const native=tables.length?await db.$queryRawUnsafe('SELECT package_key,migration_id,sha256,finished FROM _qicore_migrations ORDER BY package_key,migration_id'):[];
  if(native.some(r=>!r.finished))fail('BACKUP_MIGRATIONS_DIRTY');
  // Empty native history keeps legacy framework-only backups compatible. Once a
  // component migrates, old Prisma-only fingerprints must no longer authorize restore.
  return createHash('sha256').update(JSON.stringify(native.length?{prisma,native:native.map(r=>[r.package_key,r.migration_id,r.sha256])}:prisma)).digest('hex');
}
export class BackupArchive{
  constructor({root='',keyRoot='',instanceDirectory=process.env.ADMIN_STATE_PATH,binary='mysqldump',owner=/** @type {{uid:number,gid:number}|null} */(null),readOnlyKey=false,publicRoots=/** @type {string[]} */([]),timeoutMs=15*60000,maxBytes=2*1024**3,maxPlainBytes=10*1024**3}={}){
    this.instanceDirectory=instanceDirectory;
    if(!root||!keyRoot)fail('BACKUP_PATH_INVALID');
    this.root=resolve(root);this.keyRoot=resolve(keyRoot);this.binary=binary;this.owner=owner;this.readOnlyKey=readOnlyKey;this.timeoutMs=timeoutMs;this.maxBytes=maxBytes;this.maxPlainBytes=maxPlainBytes;this.jobs=new Map();this.children=new Set();
    if(contained(this.root,this.keyRoot)||contained(this.keyRoot,this.root)||publicRoots.some(p=>contained(resolve(p),this.root)||contained(resolve(p),this.keyRoot)))fail('BACKUP_PATH_INVALID');
    if(![timeoutMs,maxBytes,maxPlainBytes].every(v=>Number.isSafeInteger(v)&&v>0))fail('BACKUP_LIMIT_INVALID');
  }
  protect(path,directory=false){
    if(process.platform==='win32'){
      if(!this.sid){const r=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});this.sid=r.stdout?.match(/S-1-5-[0-9-]+/)?.[0];if(r.status!==0||!this.sid)fail('BACKUP_PERMISSIONS_FAILED')}
      const flags=directory?'(OI)(CI)(F)':'(F)',r=spawnSync('icacls',[path,'/inheritance:r','/grant:r',`*${this.sid}:${flags}`,`*S-1-5-18:${flags}`,`*S-1-5-32-544:${flags}`],{windowsHide:true,stdio:'ignore'});if(r.status!==0)fail('BACKUP_PERMISSIONS_FAILED');
    }else{chmodSync(path,directory?0o700:0o600);if(this.owner)chownSync(path,this.owner.uid,this.owner.gid)}
  }
  init(){
    noLinks(this.root);noLinks(this.keyRoot);mkdirSync(this.root,{recursive:true,mode:0o700});this.protect(this.root,true);this.store=new StateStore(this.root);
    if(!this.readOnlyKey){mkdirSync(this.keyRoot,{recursive:true,mode:0o700});this.protect(this.keyRoot,true)}
    this.key();this.recover();
    this.checkCapability();
  }
  checkCapability(){
    noLinks(this.root);noLinks(this.keyRoot);
    accessSync(this.root,constants.R_OK|constants.W_OK);this.key();accessSync(join(this.keyRoot,'backup.key'),constants.R_OK);
    const tool=spawnSync(this.binary,['--version'],{encoding:'utf8',windowsHide:true,shell:false,timeout:5000,maxBuffer:64000});
    if(tool.status!==0||!/mysqldump|mariadb-dump/i.test(tool.stdout||''))fail('BACKUP_TOOL_UNAVAILABLE');this.maria=/mariadb/i.test(tool.stdout);
  }
  key(){
    const file=join(this.keyRoot,'backup.key');noLinks(file);
    if(!existsSync(file)){
      if(this.readOnlyKey||readdirSync(this.root).some(n=>n.endsWith('.zbackup')||n.endsWith('.partial')||n==='key-initialization.json'||/^backup-.*\.json$/.test(n)))fail('BACKUP_KEY_MISSING');
      try{const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,randomBytes(32));fsyncSync(fd)}finally{closeSync(fd)}this.protect(file);if(process.platform!=='win32'){const directory=openSync(this.keyRoot,'r');try{fsyncSync(directory)}finally{closeSync(directory)}}}catch(e){if(e.code!=='EEXIST')throw e}
    }
    if(!lstatSync(file).isFile())fail('BACKUP_KEY_INVALID');const key=readFileSync(file);if(key.length!==32)fail('BACKUP_KEY_INVALID');return key;
  }
  file(id,suffix){if(!ID.test(id))fail('BACKUP_ID_INVALID');const path=join(this.root,id+suffix);noLinks(path);return path}
  read(id){const file=this.file(id,'.json');if(!existsSync(file))return null;if(!lstatSync(file).isFile())fail('BACKUP_RECORD_INVALID');const r=JSON.parse(readFileSync(file,'utf8'));if(r.id!==id)fail('BACKUP_RECORD_INVALID');return r}
  save(record){this.file(record.id,'.json');this.store.write(record.id+'.json',record);this.protect(this.file(record.id,'.json'))}
  operation(){const path=join(this.root,'operation.lock');noLinks(path);return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null}
  acquireOperation(kind,taskId){const current=this.operation();if(current){if(kind==='update'&&current.kind===kind&&current.taskId===taskId)return;fail('BACKUP_OPERATION_BUSY')}if(existsSync(join(this.root,'backup.lock')))fail('BACKUP_BUSY');const path=join(this.root,'operation.lock'),fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify({kind,taskId,pid:process.pid,host:hostname()}));fsyncSync(fd);this.protect(path)}catch(e){closeSync(fd);unlinkSync(path);throw e}closeSync(fd)}
  releaseOperation(kind,taskId){const current=this.operation();if(current?.kind===kind&&current.taskId===taskId)unlinkSync(join(this.root,'operation.lock'))}
  trackChild(lockName,pid){const owner=this.store.read(lockName);if(owner){owner.childPid=pid||null;this.store.write(lockName,owner);this.protect(this.store.path(lockName))}}
  protectedReason(record){
    const restore=this.store.read('restore-state.json');if(restore&&[restore.backupId,restore.protectionId,...(restore.retainedIds||[])].includes(record.id))return '该备份被还原恢复流程引用';
    if(record.source==='update'){const refs=this.store.read('update-references.json');if(!refs||!Array.isArray(refs.ids)||refs.ids.includes(record.id))return '该备份被系统更新恢复流程保护'}
    if(record.status==='running'||record.error==='BACKUP_CLEANUP_REQUIRED')return '备份仍在处理或等待清理';return null;
  }
  list(){return readdirSync(this.root).filter(n=>/^backup-[a-zA-Z0-9_-]{16,64}\.json$/.test(n)).map(n=>this.read(n.slice(0,-5))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}
  cleanupWork(id){const work=this.file(id,'.work');if(existsSync(work)){noLinks(work);const config=join(work,'client.cnf');if(existsSync(config)){noLinks(config);unlinkSync(config)}rmdirSync(work)}}
  cleanupImportWork(id){const work=this.file(id,'.restore-work');if(!existsSync(work))return;noLinks(work);if(readdirSync(work).some(name=>name!=='client.cnf'))fail('BACKUP_CLEANUP_REQUIRED');const secret=join(work,'client.cnf');noLinks(secret);if(existsSync(secret))unlinkSync(secret);rmdirSync(work)}
  recover(){
    const operation=this.operation();if(operation&&(operation.host!==hostname()||!Number.isSafeInteger(operation.pid)||alive(operation.pid)||(operation.childPid&&alive(operation.childPid))))return;
    const lock=join(this.root,'backup.lock');noLinks(lock);
    if(existsSync(lock)){const owner=JSON.parse(readFileSync(lock,'utf8'));if(owner.host!==hostname()||!Number.isSafeInteger(owner.pid)||alive(owner.pid)||(owner.childPid&&alive(owner.childPid)))return;const r=this.read(owner.id);if(r?.status==='running'){r.status='failed';r.stage='interrupted';r.error='BACKUP_INTERRUPTED';r.finishedAt=new Date().toISOString();this.save(r)}this.cleanupWork(owner.id);const partial=this.file(owner.id,'.partial');if(existsSync(partial))unlinkSync(partial);unlinkSync(lock)}
    if(!existsSync(lock))for(const r of this.list().filter(r=>r.schema==='zjz-backup-v2'&&r.status==='running')){r.status='failed';r.stage='interrupted';r.error='BACKUP_INTERRUPTED';r.finishedAt=new Date().toISOString();this.save(r);this.cleanupWork(r.id);const partial=this.file(r.id,'.partial');if(existsSync(partial))unlinkSync(partial)}
    if(operation&&['backup','read','delete'].includes(operation.kind))this.releaseOperation(operation.kind,operation.taskId);
  }
  start({id,source,actorId,actorName,version,url,binding=/** @type {any} */(null),accountMode='existing',taskId=/** @type {string|null} */(null)}){
    if(this.closing)fail('BACKUP_STOPPING');
    if(!ID.test(id)||!['manual','update','pre_restore'].includes(source))fail('BACKUP_INPUT_INVALID');
    const previous=this.read(id);if(previous){if(binding)assertBackupBinding(binding,previous.binding);if(previous.status==='deleted'||previous.source!==source||previous.actorId!==actorId)fail('BACKUP_REQUEST_CONFLICT');return{record:previous,completion:this.jobs.get(id)||Promise.resolve(previous)}}
    const operation=this.operation();if(operation&&!(source==='update'&&operation.kind==='update'&&operation.taskId===taskId)&&!(source==='pre_restore'&&operation.kind==='restore'&&operation.taskId===taskId))fail('BACKUP_OPERATION_BUSY');
    const ownOperation=!operation;if(ownOperation)this.acquireOperation('backup',id);
    const lock=join(this.root,'backup.lock');noLinks(lock);let fd;try{fd=openSync(lock,'wx',0o600)}catch(e){if(ownOperation)this.releaseOperation('backup',id);if(e.code==='EEXIST')fail('BACKUP_BUSY');throw e}
    try{writeFileSync(fd,JSON.stringify({id,pid:process.pid,host:hostname()}));fsyncSync(fd);this.protect(lock)}catch(e){closeSync(fd);unlinkSync(lock);if(ownOperation)this.releaseOperation('backup',id);throw e}closeSync(fd);
    const record={schema:'zjz-backup-v2',id,source,actorId,actorName,version,taskId,...(binding?{binding}:{}),status:'running',stage:'checking',createdAt:new Date().toISOString(),finishedAt:null,bytes:null,sha256:null,verifiedAt:null,error:null};
    try{this.save(record)}catch(e){unlinkSync(lock);if(ownOperation)this.releaseOperation('backup',id);throw e}
    const completion=this.run(record,url,accountMode).finally(()=>{this.jobs.delete(id);try{const owner=JSON.parse(readFileSync(lock,'utf8'));if(owner.id===id)unlinkSync(lock)}catch{}if(ownOperation)this.releaseOperation('backup',id)});
    completion.catch(()=>{});
    this.jobs.set(id,completion);return{record,completion};
  }
  async run(record,url,mode){
    const partial=this.file(record.id,'.partial'),final=this.file(record.id,'.zbackup'),work=this.file(record.id,'.work');let child,timer,finished,transfer;
    try{
      const parsed=parseMigrationUrl(url,mode);if([...parsed.url.searchParams.keys()].some(k=>!['connection_limit','pool_timeout','connect_timeout','socket_timeout'].includes(k)))fail('BACKUP_CONNECTION_OPTIONS_UNSUPPORTED');
      const db=new PrismaClient({datasources:{db:{url}}});let recoveryTarget,migrationHash;try{const bad=await db.$queryRaw`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=${parsed.database} AND TABLE_TYPE='BASE TABLE' AND ENGINE<>'InnoDB'`;if(bad.length)fail('BACKUP_ENGINE_UNSUPPORTED');const actual=await readBackupBinding(db,this.instanceDirectory);if(record.binding)assertBackupBinding(record.binding,actual);if(actual)record.binding=actual;if(record.source==='pre_restore'&&actual)recoveryTarget=await protectionTarget(db,parsed);migrationHash=await migrationFingerprint(db)}finally{await db.$disconnect()}
      if(this.closing)fail('BACKUP_INTERRUPTED');
      mkdirSync(work,{mode:0o700});this.protect(work,true);const secret=join(work,'client.cnf');writeFileSync(secret,mysqlClientConfig(url,mode),{flag:'wx',mode:0o600});this.protect(secret);
      record.migrationHash=migrationHash;
      const key=this.key(),nonce=randomBytes(12),header=Buffer.from(JSON.stringify({schema:'zjz-backup-v2',id:record.id,algorithm:'aes-256-gcm',compression:'gzip',nonce:nonce.toString('hex'),keyId:createHash('sha256').update(key).digest('hex').slice(0,16),database:parsed.database,migrationHash,createdAt:record.createdAt,source:record.source,version:record.version,...(recoveryTarget?{recoveryTarget,restoreTask:record.taskId}:{}),...(record.binding?{binding:record.binding}:{})}));
      const length=Buffer.alloc(4);length.writeUInt32BE(header.length);const prefix=Buffer.concat([MAGIC,length,header]),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(prefix);
      const output=createWriteStream(partial,{flags:'wx',mode:0o600});output.write(prefix);let plainBytes=0,encryptedBytes=prefix.length+16;
      const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:work,TMP:work,HOME:work,LANG:'C.UTF-8',MYSQL_TEST_LOGIN_FILE:join(work,'no-login.cnf')};
      const args=['--defaults-file='+secret,'--single-transaction','--quick','--skip-lock-tables','--no-tablespaces','--hex-blob','--routines','--events','--default-character-set=utf8mb4',...(this.maria?[]:['--set-gtid-purged=OFF','--column-statistics=0']),'--',parsed.database];
      record.stage='dumping';this.save(record);child=spawn(this.binary,args,{shell:false,windowsHide:true,env,stdio:['ignore','pipe','pipe']});this.children.add(child);child.stderr.resume();
      finished=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('BACKUP_DUMP_FAILED')));child.once('exit',code=>code===0?resolve():reject(Error('BACKUP_DUMP_FAILED')))});timer=setTimeout(()=>child.kill('SIGKILL'),this.timeoutMs);this.trackChild('backup.lock',child.pid);
      transfer=pipeline(child.stdout,new Transform({transform:(chunk,_,done)=>{plainBytes+=chunk.length;done(plainBytes>this.maxPlainBytes?Error('BACKUP_SIZE_LIMIT'):null,chunk)}}),createGzip(),cipher,new Transform({transform:(chunk,_,done)=>{encryptedBytes+=chunk.length;done(encryptedBytes>this.maxBytes?Error('BACKUP_SIZE_LIMIT'):null,chunk)}}),output);
      await Promise.all([finished,transfer]);
      if(!plainBytes)fail('BACKUP_EMPTY');appendFileSync(partial,cipher.getAuthTag());const sync=openSync(partial,'r+');try{fsyncSync(sync)}finally{closeSync(sync)}
      record.stage='verifying';this.save(record);const verified=await this.openVerified(record,partial);closeSync(verified.fd);this.cleanupWork(record.id);
      renameSync(partial,final);this.protect(final);Object.assign(record,{status:'completed',stage:'complete',verification:'passed',bytes:verified.bytes,sha256:verified.sha256,verifiedAt:new Date().toISOString(),finishedAt:new Date().toISOString()});this.save(record);
    }catch(e){child?.kill('SIGKILL');await Promise.allSettled([finished,transfer].filter(Boolean));try{this.cleanupWork(record.id);if(existsSync(partial))unlinkSync(partial)}catch{e=Error('BACKUP_CLEANUP_REQUIRED')}
      Object.assign(record,{status:'failed',stage:'failed',finishedAt:new Date().toISOString(),error:['BACKUP_ENGINE_UNSUPPORTED','BACKUP_CONNECTION_OPTIONS_UNSUPPORTED','BACKUP_SIZE_LIMIT','BACKUP_KEY_MISSING','BACKUP_KEY_INVALID','BACKUP_CLEANUP_REQUIRED','BACKUP_INTERRUPTED'].includes(e.message)?e.message:'BACKUP_FAILED'});this.save(record);
    }finally{clearTimeout(timer);if(child){child.kill('SIGKILL');this.children.delete(child)}}return record;
  }
  async openVerified(record,path=this.file(record.id,'.zbackup')){
    noLinks(path);const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{
      const info=fstatSync(fd);if(!info.isFile()||info.size<45||info.size>this.maxBytes)fail('BACKUP_VERIFY_FAILED');const initial=Buffer.alloc(12);if(readSync(fd,initial,0,12,0)!==12||!initial.subarray(0,8).equals(MAGIC))fail('BACKUP_VERIFY_FAILED');
      const length=initial.readUInt32BE(8);if(length>4096||length<1||12+length+16>=info.size)fail('BACKUP_VERIFY_FAILED');const header=Buffer.alloc(length);if(readSync(fd,header,0,length,12)!==length)fail('BACKUP_VERIFY_FAILED');const fields=JSON.parse(header.toString()),key=this.key();
      if(fields.schema!=='zjz-backup-v2'||fields.id!==record.id||fields.algorithm!=='aes-256-gcm'||fields.compression!=='gzip'||!/^[a-f0-9]{24}$/.test(fields.nonce)||fields.keyId!==createHash('sha256').update(key).digest('hex').slice(0,16))fail('BACKUP_VERIFY_FAILED');
      const tag=Buffer.alloc(16);readSync(fd,tag,0,16,info.size-16);const hash=createHash('sha256');await pipeline(createReadStream('',{fd,start:0,autoClose:false}),new Writable({write(chunk,_,done){hash.update(chunk);done()}}));const sha256=hash.digest('hex');if(record.sha256&&record.sha256!==sha256)fail('BACKUP_VERIFY_FAILED');
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(fields.nonce,'hex'));decipher.setAAD(Buffer.concat([initial,header]));decipher.setAuthTag(tag);let plain=0;
      await pipeline(createReadStream('',{fd,start:12+length,end:info.size-17,autoClose:false}),decipher,createGunzip(),new Writable({write:(chunk,_,done)=>{plain+=chunk.length;done(plain>this.maxPlainBytes?Error('BACKUP_VERIFY_FAILED'):null)}}));if(!plain)fail('BACKUP_VERIFY_FAILED');
      return{fd,bytes:info.size,sha256,header:fields,prefix:Buffer.concat([initial,header]),offset:12+length,tag};
    }catch{closeSync(fd);fail('BACKUP_VERIFY_FAILED')}
  }
  async verify(id,binding=/** @type {any} */(null)){const r=this.read(id);if(r?.schema!=='zjz-backup-v2'||r.status!=='completed')fail('BACKUP_NOT_READY');try{const result=await this.openVerified(r);try{if(binding)assertBackupBinding(binding,result.header.binding)}finally{closeSync(result.fd)}r.verification='passed';r.error=null;r.verifiedAt=new Date().toISOString();this.save(r);return r}catch(e){r.verification='failed';r.verifiedAt=new Date().toISOString();this.save(r);throw e}}
  async importDatabase(id,url,binary,expectedHash,binding=/** @type {any} */(null),recoveryTask=/** @type {string|null} */(null)){
    const record=this.read(id);if(record?.status!=='completed')fail('BACKUP_NOT_READY');const parsed=parseMigrationUrl(url,'existing'),file=await this.openVerified(record);const work=this.file(id,'.restore-work');let child,finished,transfer,timer;
    try{
      const checkDb=new PrismaClient({datasources:{db:{url}}});
      try{
        if(recoveryTask && file.header.recoveryTarget){
          const journal=this.store.read('restore-state.json'),operation=this.operation();
          if(operation?.kind!=='restore'||operation.taskId!==recoveryTask||journal?.id!==recoveryTask||
             !['running','recovery_required'].includes(journal.status)||!journal.importStarted||
             journal.protectionId!==id||journal.protectionSha256!==file.sha256||journal.migrationHash!==expectedHash||
             file.header.source!=='pre_restore'||file.header.restoreTask!==recoveryTask||
             file.header.recoveryTarget!==await protectionTarget(checkDb,parsed))fail('BACKUP_RECOVERY_TARGET_MISMATCH');
          assertBackupBinding(localBackupBinding(file.header.binding?.enterpriseId,this.instanceDirectory),file.header.binding);
          if(binding)assertBackupBinding(binding,file.header.binding);
          if(journal.binding)assertBackupBinding(journal.binding,file.header.binding);
          const surviving=await readBackupBinding(checkDb,this.instanceDirectory,true);
          if(surviving)assertBackupBinding(surviving,file.header.binding);
        }else{
          await assertImportBinding(checkDb,file.header.binding,binding,this.instanceDirectory);
        }
      }finally{await checkDb.$disconnect()}
      if(file.header.database!==parsed.database||file.header.migrationHash!==expectedHash)fail('BACKUP_RESTORE_INCOMPATIBLE');
      mkdirSync(work,{mode:0o700});this.protect(work,true);const secret=join(work,'client.cnf');writeFileSync(secret,mysqlClientConfig(url,'existing'),{flag:'wx',mode:0o600});this.protect(secret);
      const decipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(file.header.nonce,'hex'));decipher.setAAD(file.prefix);decipher.setAuthTag(file.tag);
      child=spawn(binary,['--defaults-file='+secret,'--binary-mode=1','--default-character-set=utf8mb4','--',parsed.database],{shell:false,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:work,TMP:work,HOME:work,MYSQL_TEST_LOGIN_FILE:join(work,'no-login.cnf')},stdio:['pipe','pipe','pipe']});child.stdout.resume();child.stderr.resume();
      finished=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('BACKUP_IMPORT_FAILED')));child.once('exit',code=>code===0?resolve():reject(Error('BACKUP_IMPORT_FAILED')))});timer=setTimeout(()=>child.kill('SIGKILL'),this.timeoutMs);this.trackChild('operation.lock',child.pid);
      transfer=pipeline(createReadStream('',{fd:file.fd,start:file.offset,end:file.bytes-17,autoClose:false}),decipher,createGunzip(),child.stdin);await Promise.all([finished,transfer]);
    }catch(e){child?.kill('SIGKILL');await Promise.allSettled([finished,transfer].filter(Boolean));throw e}finally{clearTimeout(timer);closeSync(file.fd);this.trackChild('operation.lock',null);const secret=join(work,'client.cnf');if(existsSync(secret))unlinkSync(secret);if(existsSync(work))rmdirSync(work)}
  }
  async close(){this.closing=true;for(const child of this.children)child.kill('SIGKILL');await Promise.allSettled(this.jobs.values())}
}
