import 'reflect-metadata'
import metadata from '../package.json' with {type:'json'}
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import express from 'express'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { directoryPermissions, registerAccounts } from './accounts.mjs'
import { passwordMatches, can, digest } from './identity.mjs'
import { registerMedia, mediaPermissions } from './media.mjs'
import { registerSiteSettings, siteSettingPermissions, getCoreSiteBrand } from './site-settings.mjs'
import { registerCustomerContent, contentPermissions } from './customer-content.mjs'
import { privateStorage } from './storage.mjs'

const publicAccount = {id:true,login:true,displayName:true,avatar:true,enabled:true,roleId:true,deletedAt:true,role:{select:{permissions:true,title:true,enabled:true,deletedAt:true}}}
const dummyHash = 'scrypt$'+'00'.repeat(16)+'$'+'00'.repeat(64)
export const fail = (status,message) => Object.assign(new Error(message),{status})
export async function startHost(application, options = {}) {
  const db = options.db ?? (await import('./db.mjs')).db
  const origin = new URL(process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:3000').origin
  const secure = origin.startsWith('https:')
  if (!secure && !['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('公网后台需要 HTTPS')
  const app = express()
  app.disable('x-powered-by')
  const storage = privateStorage(process.env.FILES_ROOT || '.local/private')
  const limiter = new Map()
  const cookie = {httpOnly:true,secure,sameSite:'lax',path:'/'}
  const api = express.Router()
  app.use('/api',api)
  api.use((req,res,next)=>{
    res.set('Cache-Control','no-store')
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') && req.get('origin')!==origin) return res.status(403).json({message:'请求来源无效'})
    next()
  })
  api.use(['/admin/help','/admin/policies','/admin/customer-service','/admin/site-settings'],express.json({limit:'2mb'}))
  api.use(express.json({limit:'512kb'}))
  const sessionCookie = process.env.QICORE_SESSION_COOKIE || 'qc_session'
  if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(sessionCookie)) throw Error('无效的实例会话名称')
  function sessionDigest(req) {
    const prefix=sessionCookie+'='
    const raw=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(prefix))
    const token=raw?.slice(prefix.length)||''
    return digest(/^[a-f0-9]{64}$/.test(token)?token:'')
  }
  async function identity(req, source = db) {
    const session = await source.session.findUnique({where:{digest:sessionDigest(req)},include:{account:{select:publicAccount}}})
    if (!session?.account.enabled || session.account.deletedAt || !session.account.role.enabled || session.account.role.deletedAt || session.expiresAt<=new Date()) throw fail(401,'请重新登录')
    return session.account
  }
  api.get('/health',async(req,res)=>{await db.$queryRaw`SELECT 1`;await application?.ready?.();res.json({ok:true,app:application?.key??null,version:options.version??metadata.version,frameworkVersion:options.frameworkVersion??metadata.version})})
  api.post('/auth/login',async(req,res)=>{
    const {login,password}=z.object({login:z.string().trim().min(1).max(80),password:z.string().max(128)}).parse(req.body)
    const peer=req.socket.remoteAddress || 'local'
    const forwarded=req.get('x-qicore-client-ip')
    const trustedPeer=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)
    const client=trustedPeer && forwarded && isIP(forwarded) ? forwarded : peer
    const key=['127.0.0.1','::1','::ffff:127.0.0.1','local'].includes(client)
      ? client+'/'+login.toLowerCase() : client
    const now=Date.now()
    for(const [ip,entry] of limiter) if(entry.until<=now) limiter.delete(ip)
    const limit=limiter.get(key) || {count:0,until:now+60000}
    if(limit.count>=40) throw fail(429,'请求过于频繁，请稍后重试')
    limit.count++;limiter.set(key,limit)
    let rejected=false
    let user
    try {
      user=await db.account.findUnique({where:{login}})
      const matches=await passwordMatches(password,user?.passwordHash || dummyHash)
      if(!matches || !user?.enabled) {
        rejected=true
        throw fail(401,'账号或密码错误')
      }
    } finally {
      if(!rejected && limiter.get(key)===limit && --limit.count===0) limiter.delete(key)
    }
    const token=randomBytes(32).toString('hex'),maxAge=12*3600*1000
    await db.$transaction(async tx=>{
      const [current]=await tx.$queryRaw`SELECT a.passwordHash, a.enabled, a.allowMultipleSessions, a.deletedAt,
        r.enabled AS roleEnabled, r.deletedAt AS roleDeleted FROM qc_accounts a JOIN qc_roles r ON r.id = a.roleId
        WHERE a.id = ${user.id} FOR UPDATE`
      if(!current?.enabled || current.deletedAt || !current.roleEnabled || current.roleDeleted || current.passwordHash!==user.passwordHash) throw fail(401,'账号或密码已变更，请重新登录')
      if(!current.allowMultipleSessions) await tx.session.deleteMany({where:{accountId:user.id}})
      await tx.session.create({data:{digest:digest(token),accountId:user.id,expiresAt:new Date(now+maxAge)}})
    })
    res.cookie(sessionCookie,token,{...cookie,maxAge}).json({ok:true})
  })
  const clearSessionCookie = res => res.clearCookie(sessionCookie,cookie)
  api.post('/auth/logout',async(req,res)=>{
    await db.session.deleteMany({where:{digest:sessionDigest(req)}})
    clearSessionCookie(res).json({ok:true})
  })
  api.get('/me',async(req,res)=>{
    const account=await identity(req)
    const site=await getCoreSiteBrand(db,application?.title || 'QiCore')
    res.json({account,brand:site.name,site,menus:(application?.menus??[]).filter(menu=>can(account,menu.permission))})
  })
  api.get('/core/overview',async(req,res)=>{
    const account=await identity(req)
    const [total,enabled,roles]=await Promise.all([
      can(account,'core.accounts.read') ? db.account.count({where:{deletedAt:null}}) : null,
      can(account,'core.accounts.read') ? db.account.count({where:{deletedAt:null,enabled:true,role:{enabled:true,deletedAt:null}}}) : null,
      can(account,'core.roles.read') ? db.role.count({where:{deletedAt:null}}) : null,
    ])
    res.json({
      frameworkVersion:options.frameworkVersion??metadata.version,
      application:application ? {key:application.key,title:application.title,version:options.version??metadata.version} : null,
      accounts:total===null ? null : {total,enabled},roles,
    })
  })
  registerSiteSettings(api,{db,identity,fail,defaultName:application?.title||'QiCore'})
  registerCustomerContent(api,db,identity,fail,application)
  registerMedia(api,db,identity,fail,application)
  registerAccounts(api,db,identity,fail,new Set([...directoryPermissions,...siteSettingPermissions,...contentPermissions,...mediaPermissions,...(application?.permissions??[])]),clearSessionCookie,options.ownerId,application)
  if (application) {
    const declared=new Set(application.permissions)
    for(const menu of application.menus) if(!declared.has(menu.permission)) throw Error('菜单权限未声明')
    const scope=express.Router()
    api.use('/apps/'+application.key,scope)
    const route=(method,path,permission,handler)=>{
      if(!declared.has(permission)) throw Error('路由权限未声明 '+permission)
      scope[method](path,async(req,res)=>{
        const account=await identity(req)
        if(!can(account,permission)) throw fail(403,'无操作权限')
        const data=await handler({req,res,account})
        if(!res.headersSent) res.json(data)
      })
    }
    await application.register({route,publicRouter:scope,db,storage,fail,accountSelect:publicAccount,can})
  }
  api.use((err,req,res,next)=>{
    if(res.headersSent) return next(err)
    const status=err instanceof z.ZodError?400:err.status??(err.code==='P2002'||err.code==='P2034'?409:err.code==='P2025'?404:500)
    res.status(status).json({message:err instanceof z.ZodError?'输入格式无效':status===500?'服务暂时不可用':err.code==='P2002'?'记录已存在':err.code==='P2034'?'数据已变更，请刷新后重试':err.code==='P2025'?'找不到记录':err.message})
    if(status>=500) console.error('request failed',req.method,req.route?.path??'unknown',err.code??err.name)
  })
  class StandaloneHost {}
  Module({})(StandaloneHost)
  const nest=await NestFactory.create(StandaloneHost,new ExpressAdapter(app),{bodyParser:false,logger:['error','warn']})
  await db.$connect()
  if(options.listen===false) {await nest.init();return nest}
  await nest.listen(options.port??Number(process.env.API_PORT||3401),options.host??'127.0.0.1')
  return nest
}
