import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StateStore } from '../apps/api/dist/license/store.js'
import { provisionEnterprise, bindStandaloneEnterprise } from '../apps/api/dist/core/standalone-edition.mjs'
import { passwordHash, passwordMatches, tenantPermissions } from '../apps/api/dist/core/admin-auth.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaClient } = requireApi('@prisma/client')

async function migrate(database) {
  const args = [requireApi.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root,'apps/api/prisma/schema.prisma')]
  await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath,args,{cwd:root,env:{...process.env,DATABASE_URL:database},stdio:['ignore','ignore','ignore'],windowsHide:true})
    proc.once('error',reject)
    proc.once('exit',code=>code===0?resolve():reject(Error('数据库迁移未完成，请查看数据库中的迁移记录')))
  })
}

// This entry provisions the free source installation. Signed commercial bundles use their product installer.
export async function initializeStandalone(env=process.env) {
  if(env.QICORE_COMPONENTS || env.QICORE_STANDALONE_BUNDLE_ROOT || env.QICORE_STANDALONE_PRODUCT_FILE || env.QICORE_DEV_WORKSPACE) {
    throw Error('请使用对应产品的整包安装器或源码开发入口')
  }
  if(!env.STANDALONE_STATE_ROOT||!isAbsolute(env.STANDALONE_STATE_ROOT))throw Error('请指定 STANDALONE_STATE_ROOT 的绝对路径')
  const url = new URL(env.DATABASE_URL)
  if(url.protocol!=='mysql:' || !/^\/[a-zA-Z0-9_-]{1,64}$/.test(url.pathname)) throw Error('请指定专用 MySQL 数据库')
  if(['mysql','sys','information_schema','performance_schema'].includes(url.pathname.slice(1).toLowerCase()))throw Error('请选择专用业务数据库')
  const username=(env.STANDALONE_ADMIN_USERNAME||'').toLowerCase()
  if(!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)||!env.STANDALONE_ADMIN_PASSWORD_FILE)throw Error('需要管理员账号和本地密码文件路径')
  const password=(await readFile(env.STANDALONE_ADMIN_PASSWORD_FILE,'utf8')).replace(/\r?\n$/,'')
  const encoded=await passwordHash(password,12)
  await mkdir(env.STANDALONE_STATE_ROOT,{recursive:true,mode:0o700})
  const state=new StateStore(await realpath(env.STANDALONE_STATE_ROOT))
  const db=new PrismaClient({datasourceUrl:env.DATABASE_URL}),guard=new PrismaClient({datasourceUrl:env.DATABASE_URL})
  try{
    return await guard.$transaction(async connection=>{
      const [target]=await connection.$queryRaw`SELECT @@server_uuid AS serverId,DATABASE() AS dbName`
      const identity=createHash('sha256').update(target.serverId+'\n'+target.dbName).digest('hex')
      const lock='qicore-install-'+identity.slice(0,40)
      const [row]=await connection.$queryRaw`SELECT GET_LOCK(${lock},0) AS acquired`
      if(Number(row.acquired)!==1)throw Error('另一个安装操作正在进行')
      try{
        let journal=state.read('installation-attempt.json')
        if(!journal){
          const tables=await db.$queryRaw`SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() LIMIT 1`
          if(tables.length)throw Error('首次安装需要专用空库，已有数据库须使用原安装记录恢复')
          journal={format:'qicore-enterprise-install-attempt-v1',id:randomUUID(),databaseId:identity,username}
          state.write('installation-attempt.json',journal)
        }
        if(journal.format!=='qicore-enterprise-install-attempt-v1'||journal.databaseId!==identity||journal.username!==username)throw Error('安装记录与数据库或管理员不匹配')
        const receipt=state.read('installed.json')
        if(!receipt)await migrate(env.DATABASE_URL)
        const owner=await db.adminAccount.findUnique({where:{username}})
        if(!owner){
          if(receipt)throw Error('安装回执对应的账号缺失')
          await db.$transaction(tx=>provisionEnterprise(tx,{username,nickname:env.STANDALONE_ADMIN_NAME||'管理员',passwordHash:encoded,permissions:tenantPermissions,requestId:journal.id}),{isolationLevel:'Serializable'})
        }else if(!await passwordMatches(password,owner.passwordHash))throw Error('管理员核验失败')
        const enterpriseId=await bindStandaloneEnterprise(db)
        const bound=await db.tenant.findUniqueOrThrow({where:{id:enterpriseId}})
        const proof=await db.audit.findFirst({where:{tenantId:enterpriseId,actor:bound.ownerAdminId,action:'enterprise.bootstrap',details:{path:'$.attemptId',equals:journal.id}}})
        if(!proof || (receipt && (receipt.databaseId!==identity||receipt.enterpriseId!==enterpriseId||receipt.ownerId!==bound.ownerAdminId)))throw Error('站点归属与安装记录不匹配')
        if(!receipt)state.write('installed.json',{format:'qicore-enterprise-installed-v1',databaseId:identity,enterpriseId,ownerId:bound.ownerAdminId,attemptId:journal.id,installedAt:new Date().toISOString()})
        return {enterpriseId,alreadyInstalled:!!receipt}
      }finally{await connection.$queryRaw`SELECT RELEASE_LOCK(${lock})`}
    },{timeout:900000,maxWait:15000})
  }finally{await Promise.all([db.$disconnect(),guard.$disconnect()])}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{const result=await initializeStandalone();console.log(result.alreadyInstalled?'已核验现有单开实例':'站点与管理员初始化完成')}
  catch(error){console.error(error instanceof Error?error.message:'安装失败');process.exitCode=1}
}
