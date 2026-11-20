import {maintenanceActor,maintenanceAudit} from '../core/standalone-maintenance.mjs';
import {localBackupBinding,assertBackupBinding,sameBackupBinding,readBackupBinding} from './standalone-binding.mjs';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {closeSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {parseMigrationUrl} from '../lifecycle/database-credentials.js';
import {migrationFingerprint} from './archive.mjs';
import {fail} from '../core/errors.mjs';

const messages={BACKUP_RESTORE_INCOMPATIBLE:'备份的数据库、版本或结构与当前系统不一致',BACKUP_RESTORE_PRIVILEGES:'恢复账户需要当前数据库的完整权限',BACKUP_RESTORE_UNCONFIGURED:'请在服务器配置专用恢复账户和 mysql 客户端',BACKUP_RESTORE_CONFIRMATION:'还原确认已失效，请重新检查',BACKUP_OPERATION_BUSY:'已有备份、更新或还原操作正在进行',BACKUP_PROTECTION_FAILED:'还原前保护备份未通过校验，已停止还原',BACKUP_DRAIN_TIMEOUT:'系统仍有进行中的任务，已停止还原',BACKUP_IMPORT_FAILED:'数据库导入未完成',BACKUP_RESTORE_INTERRUPTED:'还原被中断，需要检查保护性备份后恢复'};
export class Restoration{
  constructor(backups,{pause=async()=>{},brand=async()=>null,url=process.env.BACKUP_RESTORE_DATABASE_URL||(process.env.NODE_ENV==='production'?null:backups.url),runtimeUrl=process.env.DATABASE_URL||backups.url,binary=process.env.BACKUP_MYSQL_PATH}={}){this.backups=backups;this.db=backups.db;this.archive=backups.archive;this.pause=pause;this.brand=brand;this.url=url;this.runtimeUrl=runtimeUrl;const dump=this.archive?.binary||'mysqldump';this.binary=binary||(/[\\/]/.test(dump)?join(dirname(dump),process.platform==='win32'?'mysql.exe':'mariadb'):'mysql');this.job=null;this.maintenance=false;this.startupBlocked=false}
  state(){return this.archive?.store?.read('restore-state.json')||null}
  bootGuard(){const s=this.state();if(s&&['running','recovery_required'].includes(s.status)){this.startupBlocked=true;this.maintenance=true;if(s.status==='running'){s.status='recovery_required';s.stage='interrupted';s.message=messages.BACKUP_RESTORE_INTERRUPTED;this.save(s)}return true}return false}
  get active(){return this.maintenance||this.startupBlocked}
  save(s){this.archive.store.write('restore-state.json',s);this.archive.protect(this.archive.store.path('restore-state.json'))}
  summary(binding=null){const s=this.state();return s&&(!binding||sameBackupBinding(binding,s.binding))?{id:s.id,status:s.status,stage:s.stage,message:s.message||'',createdAt:s.createdAt,finishedAt:s.finishedAt||null}:null}
  mac(text){return createHmac('sha256',this.archive.key()).update(text).digest('hex')}
  statusToken(s){return this.mac('restore-status:'+s.id+':'+s.actorId+':'+s.expiresAt+(s.binding?':'+s.binding.instanceTag:''))}
  status(body,enterprise=null){const s=this.state();if(enterprise)assertBackupBinding(localBackupBinding(enterprise,this.archive?.instanceDirectory),s?.binding);if(!s||body?.id!==s.id||Date.now()>s.expiresAt||typeof body?.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)||!timingSafeEqual(Buffer.from(body.token,'hex'),Buffer.from(this.statusToken(s),'hex')))fail('FORBIDDEN','无效的还原状态凭据',403);return this.summary()}
  async config(){
    if(!this.url||!this.backups.ready)fail('BACKUP_RESTORE_UNCONFIGURED',messages.BACKUP_RESTORE_UNCONFIGURED,409);
    const target=parseMigrationUrl(this.url,'existing'),runtime=parseMigrationUrl(this.runtimeUrl,'existing');
    if(target.url.host!==runtime.url.host||target.database!==runtime.database||[...target.url.searchParams.keys()].some(k=>!['connection_limit','pool_timeout','connect_timeout','socket_timeout'].includes(k)))fail('BACKUP_RESTORE_INCOMPATIBLE',messages.BACKUP_RESTORE_INCOMPATIBLE,409);
    const client=spawnSync(this.binary,['--version'],{encoding:'utf8',windowsHide:true,timeout:5000});if(client.status!==0||!/mysql|mariadb/i.test(client.stdout||''))fail('BACKUP_RESTORE_UNCONFIGURED',messages.BACKUP_RESTORE_UNCONFIGURED,409);
    const db=new PrismaClient({datasources:{db:{url:this.url}}});try{const grants=await db.$queryRawUnsafe('SHOW GRANTS FOR CURRENT_USER');const expected=' ON `'+target.database+'`.* TO ';if(!grants.some(row=>Object.values(row).some(value=>typeof value==='string'&&value.startsWith('GRANT ALL PRIVILEGES')&&(value.includes(expected)||value.includes(' ON *.* TO ')))))fail('BACKUP_RESTORE_PRIVILEGES',messages.BACKUP_RESTORE_PRIVILEGES,403)}finally{await db.$disconnect()}
    return target;
  }
  async preview(s,id,body){
    this.backups.allow(s,'backups.restore');if(this.active)fail('BACKUP_OPERATION_BUSY',messages.BACKUP_OPERATION_BUSY,409);const input=z.object({requestId:z.string().uuid()}).strict().safeParse(body);if(!input.success)fail('BACKUP_INPUT_INVALID','还原请求无效');
    const release=this.backups.readLock();try{const target=await this.config(),r=this.archive.read(id);if(r?.status!=='completed')fail('BACKUP_NOT_READY','备份尚不可还原',409);const file=await this.archive.openVerified(r);let header;try{header=file.header}finally{closeSync(file.fd)}
    const binding=s.role==='tenant'?this.backups.binding(s):null;if(binding)assertBackupBinding(binding,header.binding);const currentHash=await migrationFingerprint(this.db);if(header.database!==target.database||header.version!==this.backups.version()||header.migrationHash!==currentHash)fail('BACKUP_RESTORE_INCOMPATIBLE',messages.BACKUP_RESTORE_INCOMPATIBLE,409);
    const payload={id:input.data.requestId,backupId:id,actorId:s.id,...(binding?{binding}:{}),sha256:file.sha256,migrationHash:currentHash,expiresAt:Date.now()+5*60000};const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return{token:encoded+'.'+this.mac('restore-plan:'+encoded),backupId:id,createdAt:r.createdAt,version:r.version,database:target.database};}finally{release()}
  }
  plan(s,body){const value=z.object({token:z.string().max(5000),confirm:z.literal('确认还原数据库')}).strict().safeParse(body);if(!value.success)fail('BACKUP_RESTORE_CONFIRMATION','请输入“确认还原数据库”');const [encoded,tag,...extra]=value.data.token.split('.');if(extra.length||!/^[a-f0-9]{64}$/.test(tag||'')||!timingSafeEqual(Buffer.from(tag,'hex'),Buffer.from(this.mac('restore-plan:'+encoded),'hex')))fail('BACKUP_RESTORE_CONFIRMATION',messages.BACKUP_RESTORE_CONFIRMATION,409);let p;try{p=JSON.parse(Buffer.from(encoded,'base64url').toString())}catch{fail('BACKUP_RESTORE_CONFIRMATION',messages.BACKUP_RESTORE_CONFIRMATION,409)}if(s.role==='tenant')assertBackupBinding(this.backups.binding(s),p.binding);if(p.actorId!==s.id||p.expiresAt<Date.now()||!z.string().uuid().safeParse(p.id).success)fail('BACKUP_RESTORE_CONFIRMATION',messages.BACKUP_RESTORE_CONFIRMATION,409);return p}
  async assertActor(s){if(s.role==='tenant'){await maintenanceActor(this.db,s,'backups.restore');return}const actor=await this.db.adminAccount.findUnique({where:{id:s.id},include:{role:true}});if(!actor?.enabled||actor.deletedAt||actor.role.portal!=='admin'||!actor.role.enabled||!['backups.read','backups.restore'].every(p=>actor.role.permissions.includes(p)))fail('FORBIDDEN','还原权限已变化',403);if(s.tokenHash&&!await this.db.adminSession.findFirst({where:{tokenHash:s.tokenHash,adminId:s.id,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','登录已失效',401)}
  async start(s,body){
    this.backups.allow(s,'backups.restore');const plan=this.plan(s,body),old=this.state();if(old?.id===plan.id){if(old.actorId!==s.id)fail('FORBIDDEN','无权查看此任务',403);return{...this.summary(),token:this.statusToken(old)}}
    if(this.active||this.job)fail('BACKUP_OPERATION_BUSY',messages.BACKUP_OPERATION_BUSY,409);await this.config();await this.assertActor(s);
    this.archive.acquireOperation('restore',plan.id);
    const state={...plan,actorName:s.nickname||s.username||'管理员',status:'running',stage:'draining',createdAt:new Date().toISOString(),expiresAt:Date.now()+2*3600000,message:'正在暂停写入',protectionId:null,finishedAt:null,retainedIds:[...new Set([...(old?.retainedIds||[]),old?.backupId,old?.protectionId].filter(Boolean))]};
    try{state.brand=await this.brand();this.save(state);this.maintenance=true}catch(e){this.archive.releaseOperation('restore',plan.id);throw e}
    this.job=delay(100).then(()=>this.run(s,state)).finally(()=>{this.job=null});this.job.catch(()=>{});return{...this.summary(),token:this.statusToken(state)};
  }
  async purgeAndAudit(state,action){await this.db.$connect();if(state.binding)assertBackupBinding(state.binding,await readBackupBinding(this.db,this.archive.instanceDirectory));await this.db.$transaction([this.db.adminDelegation.deleteMany(),this.db.adminSession.deleteMany(),this.db.session.deleteMany()]);await this.db.audit.create({data:{id:randomUUID(),...maintenanceAudit(state.binding?{role:'tenant',tenantId:state.binding.enterpriseId}:{role:'root'}),actor:state.actorId,action,details:{backupId:state.backupId,protectionId:state.protectionId}}})}
  async run(s,state){let importing=false;const stage=(step,message)=>{state.stage=step;state.message=message;this.save(state)};
    try{
      await this.pause();await this.assertActor(s);if(await migrationFingerprint(this.db)!==state.migrationHash)throw Error('BACKUP_RESTORE_INCOMPATIBLE');
      const selected=this.archive.read(state.backupId),file=await this.archive.openVerified(selected);try{if(s.role==='tenant'){assertBackupBinding(this.backups.binding(s),state.binding);assertBackupBinding(state.binding,file.header.binding)}if(file.sha256!==state.sha256)throw Error('BACKUP_RESTORE_INCOMPATIBLE')}finally{closeSync(file.fd)}
      stage('protecting','正在创建还原前保护备份');state.protectionId='backup-'+randomUUID();this.save(state);
      const protection=await this.archive.start({id:state.protectionId,source:'pre_restore',binding:state.binding,actorId:s.id,actorName:state.actorName,version:this.backups.version(),taskId:state.id,url:this.url}).completion;
      if(protection.status!=='completed'||protection.verification!=='passed'||protection.migrationHash!==state.migrationHash)throw Error('BACKUP_PROTECTION_FAILED');
      state.protectionSha256=protection.sha256;await this.db.$disconnect();state.importStarted=true;stage('importing','正在还原数据库');importing=true;await this.archive.importDatabase(state.backupId,this.url,this.binary,state.migrationHash,state.binding);await this.db.$connect();if(await migrationFingerprint(this.db)!==state.migrationHash)throw Error('BACKUP_RESTORE_INCOMPATIBLE');
      stage('finishing','正在校验并撤销旧会话');await this.purgeAndAudit(state,'backup.restore');state.status='completed';state.message='还原完成，请重新登录';state.stage='complete';state.finishedAt=new Date().toISOString();this.save(state);this.maintenance=false;this.archive.releaseOperation('restore',state.id);
    }catch(e){
      if(importing&&state.protectionId){try{stage('rolling_back','还原未完成，正在恢复还原前数据');await this.db.$disconnect();await this.archive.importDatabase(state.protectionId,this.url,this.binary,state.migrationHash,state.binding,state.id);await this.purgeAndAudit(state,'backup.restore.rollback');state.status='rolled_back';state.message='还原失败，已恢复还原前数据，请重新登录'}catch{state.status='recovery_required';state.message='还原及回退未完成，系统保持维护状态，请使用保护性备份进行人工恢复'}}
      else{state.status='failed';state.message=messages[e.code]||messages[e.message]||'还原未开始，现有数据保持不变'}
      state.stage=state.status;state.finishedAt=new Date().toISOString();this.save(state);if(state.status!=='recovery_required'){this.maintenance=false;this.archive.releaseOperation('restore',state.id)}
    }return this.summary();
  }
  async close(){await this.job}
}
