import express from 'express'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { passwordHash, passwordMatches } from './identity.mjs'
import { startHost } from './host.mjs'

const require = createRequire(import.meta.url)
const HASH = value => createHash('sha256').update(value).digest()
const fields = z.object({
  token: z.string().min(24).max(256), database: z.string().min(8).max(1800),
  login: z.string().trim().regex(/^[\w.@-]{2,80}$/), password: z.string().min(12).max(128)
}).strict()

class InstallError extends Error {
  constructor(status,message){super(message);this.status=status}
}

async function read(file) {
  try {return JSON.parse(await readFile(file,'utf8'))}
  catch(error){if(error.code==='ENOENT')return null;throw error}
}

// Private configuration and receipts are written independently. The receipt is always last.
async function persist(path,value) {
  const tmp=path+'.'+randomUUID()+'.tmp'
  const fd=await open(tmp,'wx',0o600)
  try{
    try{await fd.writeFile(JSON.stringify(value));await fd.sync()}finally{await fd.close()}
    await rename(tmp,path)
    if(process.platform!=='win32'){
      const dir=await open(dirname(path),'r')
      try{await dir.sync()}finally{await dir.close()}
    }
  }finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e})}
}

// A kernel-owned name releases automatically when the holder exits, including SIGKILL.
async function withInstallLock(root,fn) {
  const id=HASH(await realpath(root)).toString('hex').slice(0,40)
  const addr=process.platform==='win32'?'\\\\.\\pipe\\qicore-install-'+id:'\0qicore-install-'+id
  const lock=createServer(socket=>socket.destroy())
  try{
    await new Promise((ok,no)=>{
      lock.once('error',no)
      lock.listen(addr,()=>{lock.removeListener('error',no);ok()})
    })
  }catch(error){
    if(error.code==='EADDRINUSE')throw new InstallError(409,'另一个进程正在安装，请稍后重试')
    throw error
  }
  try{return await fn()}finally{await new Promise(ok=>lock.close(ok))}
}
function databaseIdentity(input) {
  let url
  try{url=new URL(input)}catch{throw new InstallError(400,'数据库连接地址无效')}
  if(url.protocol!=='mysql:'||!url.hostname||!/^\/[\w-]+$/.test(url.pathname)||url.hash)throw new InstallError(400,'数据库连接地址无效')
  return HASH(url.hostname.toLowerCase()+':'+(url.port||'3306')+url.pathname+'\0'+(url.searchParams.get('socket')||'')).toString('hex')
}
export async function migrate(schema,database) {
  const cli=require.resolve('prisma/build/index.js')
  await new Promise((ok,no)=>{
    const child=spawn(process.execPath,[cli,'migrate','deploy','--schema',schema],{
      env:{...process.env,DATABASE_URL:database},stdio:'ignore',windowsHide:true
    })
    child.once('error',no)
    child.once('exit',code=>code===0?ok():no(new InstallError(400,'数据库迁移未完成，请核对数据库权限和迁移记录')))
  })
}
async function inspectDatabase(db,schema,login,password) {
  const tables=await db.$queryRaw`SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()`
  if(!tables.length)return null
  const names=new Set(tables.map(row=>String(row.tableName)))
  const reject=()=>new InstallError(409,'数据库已有内容。请使用专用空库，或提供此安装原有的管理员账号及密码')
  if(!['_prisma_migrations','qc_roles','qc_accounts'].every(name=>names.has(name)))throw reject()
  const history=await db.$queryRaw`SELECT migration_name AS name,finished_at AS finished,rolled_back_at AS rolledBack FROM _prisma_migrations`
  const known=new Set((await readdir(join(dirname(schema),'migrations'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name))
  if(!history.length || history.filter(r=>!r.rolledBack).some(r=>!r.finished||!known.has(r.name)))throw reject()
  const admin=await db.account.findUnique({where:{login},select:{id:true,roleId:true,enabled:true,passwordHash:true}})
  if(admin?.roleId!=='admin'||!admin.enabled||!await passwordMatches(password,admin.passwordHash))throw reject()
  return admin
}

export async function startInstance({
  application=null,createDb,schema,migrateDatabase=migrate,hooks={},version='0.1.0',frameworkVersion,port=Number(process.env.API_PORT||3401),
  stateRoot=process.env.INSTANCE_ROOT||'.local/instance',host:bindHost=process.env.API_HOST||'127.0.0.1'
}) {
  const root=resolve(stateRoot), product=application?.key||'qicore'
  await mkdir(root,{recursive:true,mode:0o700})
  const receiptPath=join(root,'installed.json'), configPath=join(root,'database.json')
  const journalPath=join(root,'install-attempt.json'), tokenFile=join(root,'install-token.json')
  const publicUrl=new URL(process.env.PUBLIC_ORIGIN||'http://127.0.0.1:3000')
  if(publicUrl.protocol!=='https:' && !(publicUrl.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(publicUrl.hostname)))throw Error('公网安装入口需要 HTTPS')
  const server=express()
  server.disable('x-powered-by')
  let receipt=null,db=null,host=null,mounting,pendingTimer=null,installing=false,closing=false
  function scheduleHook(){
    if(pendingTimer||closing)return
    pendingTimer=setTimeout(()=>{pendingTimer=null;void afterCommit().catch(scheduleHook)},30000)
    pendingTimer.unref()
  }
  async function finishHook(){
    const attempt=await read(journalPath)
    if(!hooks.afterInstall||!attempt||attempt.id!==receipt.attemptId||attempt.phase==='complete')return
    await hooks.afterInstall({attemptId:attempt.id,receipt,stateRoot:root,db})
    await persist(journalPath,{...attempt,phase:'complete'})
  }
  async function afterCommit(){await withInstallLock(root,finishHook)}
  async function mount(candidate,ownerId){
    return startHost(application,{db:candidate,listen:false,version,frameworkVersion,ownerId})
  }
  async function loadInstance(){
    const existing=await read(receiptPath)
    if(!existing)return false
    if(existing.format!=='qicore-installed-v1'||existing.product!==product)throw Error('安装回执不属于当前产品')
    const config=await read(configPath)
    if(!config?.database)throw Error('已安装实例缺少数据库配置')
    const candidate=createDb(config.database)
    try{host=await mount(candidate,existing.accountId)}catch(error){await candidate.$disconnect();throw error}
    db=candidate;receipt=existing
    if(hooks.afterInstall)void afterCommit().catch(scheduleHook)
    return true
  }
  async function refresh(){
    if(receipt)return true
    if(installing)return false
    if(!mounting)mounting=loadInstance().finally(()=>{mounting=null})
    return mounting
  }
  if(!await refresh() && !await read(tokenFile)){
    try{
      await withInstallLock(root,async()=>{
        if(!await read(receiptPath)&&!await read(tokenFile))await persist(tokenFile,randomBytes(32).toString('hex'))
      })
    }catch(error){if(error.status!==409)throw error}
  }
  server.use((_req,res,next)=>{res.set('Cache-Control','no-store');next()})
  if(hooks.mountPublicRoutes)await hooks.mountPublicRoutes(server)
  server.get('/api/install/status',async(_req,res)=>{
    const installed=await refresh()
    res.json({installed,product:application?.title||'QiCore',next:installed?'/login':'/install'})
  })
  server.post('/api/install/complete',express.json({limit:'8kb'}),async(req,res)=>{
    if(installing || await refresh())throw new InstallError(409,'安装正在执行或已经完成')
    if(req.get('origin') && req.get('origin')!==publicUrl.origin)throw new InstallError(403,'请求来源无效')
    const parsed=fields.safeParse(req.body)
    if(!parsed.success)throw new InstallError(400,'请填写安装凭据、MySQL 连接地址和管理员资料')
    const input=parsed.data
    const token=await read(tokenFile)
    if(typeof token!=='string'||!timingSafeEqual(HASH(token),HASH(input.token)))throw new InstallError(403,'安装凭据无效')
    const databaseKey=databaseIdentity(input.database)
    installing=true
    try{
      await withInstallLock(root,async()=>{
        if(await read(receiptPath))throw new InstallError(409,'安装已完成')
        let attempt=await read(journalPath)
        if(attempt && (attempt.product!==product||attempt.databaseKey!==databaseKey||attempt.login!==input.login))
          throw new InstallError(409,'请使用原数据库和原管理员账号恢复本次安装')
        const candidate=createDb(input.database)
        let candidateHost
        try{
          if(!attempt){
            const existing=await inspectDatabase(candidate,schema,input.login,input.password)
            attempt={id:randomUUID(),product,version,databaseKey,login:input.login,accountId:existing?.id||randomUUID(),phase:'created'}
            await persist(journalPath,attempt)
          }
          await hooks.beforeInstall?.({attemptId:attempt.id,product,version,stateRoot:root,db:candidate})
          if(attempt.phase==='created'){
            attempt.phase='migrating';await persist(journalPath,attempt)
          }
          await migrateDatabase(schema,input.database)
          const existing=await candidate.account.findUnique({where:{login:input.login}})
          if(existing){
            if(existing.id!==attempt.accountId||existing.roleId!=='admin'||!existing.enabled||!await passwordMatches(input.password,existing.passwordHash))
              throw new InstallError(409,'请核对本次安装原有管理员的身份及密码')
          }else{
            await candidate.account.create({data:{id:attempt.accountId,login:input.login,displayName:input.login,roleId:'admin',passwordHash:await passwordHash(input.password)}})
          }
          candidateHost=await mount(candidate,attempt.accountId)
          await candidate.$queryRaw`SELECT 1`
          await application?.ready?.()
          await persist(configPath,{database:input.database})
          const completed={format:'qicore-installed-v1',product,version,attemptId:attempt.id,accountId:attempt.accountId,installedAt:new Date().toISOString()}
          await persist(receiptPath,completed)
          host=candidateHost;db=candidate;receipt=completed
        }catch(error){
          if(candidateHost)await candidateHost.close().catch(()=>{})
          await candidate.$disconnect().catch(()=>{})
          throw error
        }
        await unlink(tokenFile).catch(()=>{})
        if(hooks.afterInstall)await finishHook().catch(scheduleHook)
        else await persist(journalPath,{...attempt,phase:'complete'})
      })
      res.json({installed:true,next:'/login'})
    }finally{installing=false}
  })
  server.use(async(req,res,next)=>{
    if(!await refresh())return res.status(503).json({message:'请先完成安装',install:'/install'})
    if(hooks.authorizeRequest && !await hooks.authorizeRequest(req))return res.status(403).json({message:'暂时无法访问此应用'})
    host.getHttpAdapter().getInstance()(req,res,next)
  })
  server.use((err,req,res,next)=>{
    if(res.headersSent)return next(err)
    const status=err instanceof InstallError?err.status:err.type==='entity.parse.failed'?400:err.type==='entity.too.large'?413:503
    res.status(status).json({message:err instanceof InstallError?err.message:'请求未完成，请检查实例配置和连接状态'})
  })
  let listener
  try{
    await new Promise((ok,no)=>{listener=server.listen(port,bindHost,ok);listener.once('error',no)})
  }catch(error){await host?.close();await db?.$disconnect();throw error}
  return {listener,async close(){
    closing=true;clearTimeout(pendingTimer)
    await new Promise(r=>listener.close(r))
    await host?.close()
    await db?.$disconnect()
  }}
}
