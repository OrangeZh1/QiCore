import {needMaintenance,maintenanceAllows,maintenanceActor,maintenanceAudit,commandGrants} from './standalone-maintenance.mjs';
import {formValidationMessage} from './form-validation.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {Cron} from 'croner';
import {z} from 'zod';
import {fail} from './errors.mjs';
import {commands,splitArguments} from '../commands/index.mjs';
import {executeCommand} from '../commands/execute.mjs';
import {PrismaClient} from '@prisma/client';

export const taskCommands=Object.entries(commands).map(([value,{label,description,permissions}])=>({value,label,description,permissions}));
const text=max=>z.string().trim().max(max).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符');
const fields={name:text(60).min(1),command:z.string().trim().regex(/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*$/,'须为已注册的命令名，只能包含小写字母、数字、短横线及命令分隔冒号').max(64),params:z.string().trim().max(1000),rule:z.string().trim().max(100),enabled:z.boolean(),remark:text(200)};
const createSchema=z.object({...fields,requestId:z.string().uuid()}).strict(),editSchema=z.object({...fields,version:z.number().int().positive()}).strict();
function parse(schema,input){const result=schema.safeParse(input);if(!result.success)fail('TASK_INPUT_INVALID',formValidationMessage(result.error,{name:'任务名称'}));return result.data}
export function nextRuns(rule,after=new Date(),count=5){
  if(typeof rule!=='string'||rule.trim().split(/\s+/).length!==5||!/^[\d\s*,/\-]+$/.test(rule))fail('TASK_RULE_INVALID','请输入五段 Cron 规则：分 时 日 月 周');
  try{const cron=new Cron(rule,{timezone:'Asia/Shanghai',paused:true,legacyMode:true}),dates=cron.nextRuns(count,after);cron.stop();if(dates.length!==count)throw Error('NO_NEXT');return dates}catch{fail('TASK_RULE_INVALID','规则无效或没有可执行时间，请检查日期范围')}
}
export class ScheduledTasks{
  constructor(db,cache,execute=executeCommand,{databaseUrl=process.env.DATABASE_URL,enterpriseScope=/** @type {null|(()=>string)} */(null)}={}){this.db=db;this.cache=cache;this.execute=execute;this.busy=false;this.databaseUrl=databaseUrl;this.enterpriseScope=enterpriseScope;this.lockDb=null}
  locks(){if(!this.lockDb){const url=new URL(this.databaseUrl);url.searchParams.set('connection_limit','1');this.lockDb=new PrismaClient({datasources:{db:{url:url.href}}})}return this.lockDb}
  async close(){const db=this.lockDb;this.lockDb=null;await db?.$disconnect()}
  allow(s,p='tasks.read'){needMaintenance(s,p)}
  grant(permissions,command,existing=false){const item=taskCommands.find(c=>c.value===command);if(!item&&existing)return;if(!item)fail('TASK_COMMAND_UNKNOWN','命令尚未注册，请先在项目中添加该命令');if(item.permissions.some(p=>!permissions.includes(p)))fail('FORBIDDEN','没有此任务命令所需的操作权限',403)}
  async actor(tx,s){const a=await tx.adminAccount.findUnique({where:{id:s.id},include:{role:true}});if(!a?.enabled||a.deletedAt||!a.role.enabled||a.role.portal!=='admin'||!['tasks.read','tasks.write'].every(p=>a.role.permissions.includes(p)))fail('FORBIDDEN','任务管理权限已变更',403);if(s.tokenHash&&!await tx.adminSession.findFirst({where:{tokenHash:s.tokenHash,adminId:s.id,expiresAt:{gt:new Date()}}}))fail('UNAUTHENTICATED','会话已失效',401);return a}
  async effective(tx,s,permission){
    if(this.enterpriseScope)return maintenanceActor(tx,{...s,tenantId:this.enterpriseScope()},permission);
    const a=await this.actor(tx,s);return{_admin:true,role:'root',id:a.id,permissions:a.role.permissions}
  }
  scoped(){return this.enterpriseScope?{enterpriseId:this.enterpriseScope()}:{}}
  async audit(db,s,action,details){await db.audit.create({data:{id:randomUUID(),...maintenanceAudit(s),actor:s.id,action,details}})}
  async list(s,input){
    this.allow(s);const q=parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50,100].includes(n),'须为 10、20、50 或 100').default(20)}).strict(),input);
    const [items,total]=await this.db.$transaction([this.db.scheduledTask.findMany({where:this.scoped(),orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.scheduledTask.count({where:this.scoped()})]);
    return{items,total,commands:taskCommands.map(c=>({...c,grantable:c.permissions.every(p=>commandGrants(s).includes(p)),permissions:s.role==='tenant'?c.permissions.map(p=>p==='services.read'?'tenant:environment.check':'tenant:'+p):c.permissions})),timezone:'Asia/Shanghai'};
  }
  preview(s,body){this.allow(s);const input=parse(z.object({rule:z.string().max(100)}).strict(),body);return{times:nextRuns(input.rule),timezone:'Asia/Shanghai'}}
  async detail(s,id,db=this.db){this.allow(s);const row=await db.scheduledTask.findFirst({where:{id,...this.scoped()}});if(!row)fail('NOT_FOUND','任务不存在',404);return row}
  async save(s,id,body){
    this.allow(s,'tasks.write');const input=parse(id?editSchema:createSchema,body),next=nextRuns(input.rule)[0];this.grant(commandGrants(s),input.command);if(s.role==='tenant'&&input.enabled)this.allow(s,'tasks.execute');
    try{commands[input.command].parse(splitArguments(input.params))}catch{fail('TASK_ARGUMENTS_INVALID','命令参数无效，请检查选项、数值和引号')}
    const {requestId,version,...data}=input,payloadHash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
    // Reuse the existing request ledger; serializable transactions reject concurrent edits/claims.
    for(let attempt=0;attempt<3;attempt++)try{return await this.db.$transaction(async tx=>{
      const actor=await this.effective(tx,s,'tasks.write');this.grant(commandGrants(actor),data.command);if(actor.role==='tenant'&&data.enabled)this.allow(actor,'tasks.execute');
      if(!id){const prior=await tx.adminProvisionRequest.findUnique({where:{actorId_requestId:{actorId:s.id,requestId}}});if(prior){if(prior.kind!=='task.create'||prior.payloadHash!==payloadHash)fail('REQUEST_CONFLICT','请求内容已改变',409);return this.detail(s,prior.resultId,tx)}}
      const old=id?await tx.scheduledTask.findFirst({where:{id,...this.scoped()}}):null;
      if(id){if(!old)fail('NOT_FOUND','任务不存在',404);this.grant(commandGrants(actor),old.command,true);if(old.running)fail('TASK_BUSY','任务执行中，请稍后修改',409);if(old.version!==version)fail('TASK_CONFLICT','任务已更新，请刷新后重试',409)}
      const row=id?await tx.scheduledTask.update({where:{id},data:{...data,version:{increment:1},ownerId:s.id,nextRunAt:next}}):await tx.scheduledTask.create({data:{id:randomUUID(),...this.scoped(),...data,ownerId:s.id,nextRunAt:next}});
      if(!id)await tx.adminProvisionRequest.create({data:{actorId:s.id,requestId,kind:'task.create',payloadHash,resultId:row.id}});
      await this.audit(tx,s,id?'task.edit':'task.create',{taskId:row.id,name:row.name,command:row.command,rule:row.rule,enabled:row.enabled});return row;
    },{isolationLevel:'Serializable'})}catch(e){if(['P2034','P2002'].includes(e.code)&&attempt<2)continue;throw e}
  }
  async remove(s,id,body){this.allow(s,'tasks.delete');const input=parse(z.object({version:z.number().int().positive()}).strict(),body);return this.db.$transaction(async tx=>{const actor=await this.effective(tx,s,'tasks.delete'),row=await tx.scheduledTask.findFirst({where:{id,...this.scoped()}});if(!row)fail('NOT_FOUND','任务不存在',404);this.grant(commandGrants(actor),row.command,true);if(row.running)fail('TASK_BUSY','任务执行中，请稍后删除',409);const removed=await tx.scheduledTask.deleteMany({where:{id,version:input.version,running:false}});if(!removed.count)fail('TASK_CONFLICT','任务已更新，请刷新后重试',409);await this.audit(tx,s,'task.delete',{taskId:id,name:row.name});return{deleted:true}},{isolationLevel:'Serializable'})}
  async runNow(s,id,body){
    this.allow(s,'tasks.execute');
    const {version}=parse(z.object({version:z.number().int().positive()}).strict(),body);
    return this.tick(new Date(),{s,id,version})
  }
  async tick(now=new Date(),manual=/** @type {any} */(null)){
    if(this.busy){if(manual)fail('TASK_BUSY','已有任务执行中',409);return}this.busy=true;
    try{
      // Reserve the advisory lock on its own one-connection pool. Business writes
      // stay durably committed and work even when the runtime pool has one connection.
      return await this.locks().$transaction(async lock=>{
        const [name]=await lock.$queryRaw`SELECT CONCAT('zjz:tasks:', SHA2(DATABASE(), 224)) AS name`;
        const lockName=name.name.slice(0,64),[acquired]=await lock.$queryRaw`SELECT GET_LOCK(${lockName},0) AS acquired`;if(Number(acquired.acquired)!==1){if(manual)fail('TASK_BUSY','已有任务执行中',409);return}
        try{
          await this.db.scheduledTask.updateMany({where:{...this.scoped(),running:true},data:{running:false,lastStatus:'error',lastError:'上次执行因服务中断而未完成',lastFinishedAt:now}});
          const row=await this.db.scheduledTask.findFirst({where:{...this.scoped(),...(manual?{id:manual.id}:{enabled:true,nextRunAt:{lte:now}})},orderBy:[{nextRunAt:'asc'},{id:'asc'}]});
          if(!row){if(manual)fail('NOT_FOUND','任务不存在',404);return}
          if(manual){
            const operator=await this.effective(this.db,manual.s,'tasks.execute');this.grant(commandGrants(operator),row.command);
            if(manual.version!==row.version)fail('TASK_CONFLICT','任务已更新，请刷新',409);
          }
          const claimed=await this.db.scheduledTask.updateMany({where:{id:row.id,version:row.version,running:false,...(manual?{}:{enabled:true})},data:{running:true,lastRunAt:now,lastStatus:'running',lastError:null,...(manual?{version:{increment:1}}:{nextRunAt:nextRuns(row.rule,now,1)[0]})}});if(!claimed.count){if(manual)fail('TASK_CONFLICT','任务已变更，请刷新',409);return}
          const started=performance.now();let message=null,result=null;
          try{
            const actor=await this.effective(this.db,manual?.s||{id:row.ownerId},'tasks.execute');
            this.grant(commandGrants(actor),row.command);result=await this.execute(row.command,row.params,actor);
          }catch(e){message=e.code==='FORBIDDEN'?'任务负责人的权限已失效，请重新编辑保存':e.code==='TASK_COMMAND_UNKNOWN'?'任务命令已移除，请重新编辑保存':e.message==='COMMAND_TIMEOUT'?'任务执行超过 30 秒，已终止':'任务执行失败，请检查依赖服务后重试'}
          const duration=Math.round(performance.now()-started);
          await this.db.$transaction(async tx=>{await tx.scheduledTask.update({where:{id:row.id},data:{running:false,lastStatus:message?'error':'success',lastError:message,lastFinishedAt:new Date(),durationMs:duration,maxDurationMs:Math.max(row.maxDurationMs||0,duration),...(!manual&&message&&(message.startsWith('任务负责人')||message.startsWith('任务命令'))?{enabled:false}:{})}});await this.audit(tx,{id:manual?.s.id||row.ownerId,role:this.enterpriseScope?'tenant':'root',tenantId:row.enterpriseId},'task.execute',{taskId:row.id,name:row.name,status:message?'error':'success',durationMs:duration,cleared:result?.cleared??0})});
          if(manual){if(message)fail('TASK_EXECUTION_FAILED',message,409);return{executed:true}}
        }finally{await lock.$queryRaw`SELECT RELEASE_LOCK(${lockName})`}
      },{timeout:60000,maxWait:5000});
    }catch(error){await this.close();throw error}finally{this.busy=false}
  }
}
