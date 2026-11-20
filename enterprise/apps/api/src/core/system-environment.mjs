import {needMaintenance,maintenanceAllows} from './standalone-maintenance.mjs';
import {randomUUID} from 'node:crypto';
import {open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import os from 'node:os';
import {access,stat,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {fail} from './errors.mjs';

const require=createRequire(import.meta.url);
const packageVersion=name=>{try{return require(name+'/package.json').version}catch{return null}};
const versions={nestjs:packageVersion('@nestjs/core'),prisma:packageVersion('@prisma/client')};
const providerNames={local:'本地私有存储',qiniu:'七牛云',oss:'阿里云 OSS',cos:'腾讯云 COS'};
const knownVersion=value=>typeof value==='string'&&/^\d[\w.+-]{0,79}$/.test(value)?value:null;
const round=value=>Math.round(value*10)/10;
async function bounded(task,ms=3500){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CHECK_TIMEOUT')),ms)})])}finally{clearTimeout(timer)}}
export function cpuPercent(before,after){
  if(!before.length||before.length!==after.length)return null;
  let total=0,idle=0;
  for(let i=0;i<before.length;i++)for(const key of ['user','nice','sys','idle','irq']){const value=after[i].times[key]-before[i].times[key];if(!Number.isFinite(value)||value<0)return null;total+=value;if(key==='idle')idle+=value}
  return total>0?round((total-idle)/total*100):null;
}
export function diskStats(stats){
  const total=Number(stats.blocks)*Number(stats.bsize),free=Number(stats.bfree)*Number(stats.bsize),available=Number(stats.bavail)*Number(stats.bsize);
  if(![total,free,available].every(Number.isSafeInteger)||total<=0||free<0||free>total||available<0||available>free)return null;
  return{totalBytes:total,usedBytes:total-free,availableBytes:available,usedPercent:round((total-free)/total*100)};
}
export class SystemEnvironment{
  constructor(db,redis,storage,version){this.db=db;this.redis=redis;this.storage=storage;this.version=version;this.inFlight=new Map()}
  allow(s,key='environment.read'){needMaintenance(s,key)}
  async once(key,fn){if(this.inFlight.has(key))return this.inFlight.get(key);const request=Promise.resolve().then(fn).finally(()=>this.inFlight.delete(key));this.inFlight.set(key,request);return request}
  async database(){return this.once('database',async()=>{const started=performance.now();try{const rows=await bounded(this.db.$queryRaw`SELECT VERSION() AS version`);return{id:'database',status:'ready',version:knownVersion(rows[0]?.version),latencyMs:round(performance.now()-started),checkedAt:new Date().toISOString(),message:'数据库查询正常'}}catch{return{id:'database',status:'error',version:null,latencyMs:null,checkedAt:new Date().toISOString(),message:'数据库暂不可用，请检查连接或服务状态'}}})}
  async cache(){return this.once('redis',async()=>{const started=performance.now();try{if(this.redis.status!=='ready')throw Error('NOT_READY');if(await bounded(this.redis.ping())!=='PONG')throw Error('BAD_PING');const latencyMs=round(performance.now()-started);let version=null;try{const info=await bounded(this.redis.info('server'),1000);version=knownVersion(/^redis_version:([^\r\n]+)/m.exec(info)?.[1])}catch{}return{id:'redis',status:'ready',version,latencyMs,checkedAt:new Date().toISOString(),message:'缓存响应正常'}}catch{return{id:'redis',status:'error',version:null,latencyMs:null,checkedAt:new Date().toISOString(),message:'缓存暂不可用，请检查连接或服务状态'}}})}
  async directory(){
    let provider=null,writeTest={status:'unavailable',checkedAt:null};
    try{const state=await bounded(this.storage.state()),revision=await bounded(this.storage.revision(state.activeRevisionId));provider=Object.hasOwn(providerNames,revision.provider)?providerNames[revision.provider]:null;const local=state.providers?.local;if(local)writeTest={status:['passed','failed','testing','not_tested'].includes(local.status)?local.status:'not_tested',checkedAt:typeof local.checkedAt==='string'&&Number.isFinite(Date.parse(local.checkedAt))?local.checkedAt:null}}catch{}
    const started=performance.now();try{await bounded(access(this.storage.root,constants.R_OK|constants.W_OK));if(!(await bounded(stat(this.storage.root))).isDirectory())throw Error('NOT_DIRECTORY');return{id:'storage',status:writeTest.status==='failed'?'warning':'ready',version:null,provider,writeTest,latencyMs:round(performance.now()-started),checkedAt:new Date().toISOString(),message:writeTest.status==='failed'?'目录可访问，上次读写检测未通过':'目录访问检查通过'}}catch{return{id:'storage',status:'error',version:null,provider,writeTest,latencyMs:null,checkedAt:new Date().toISOString(),message:'本地文件目录不可访问，请检查目录和权限'}}
  }
  async resources(){return this.once('resources',async()=>{
    let cpu=null;try{const started=performance.now(),before=os.cpus();await delay(200);const after=os.cpus();cpu={percent:cpuPercent(before,after),cores:after.length||null,sampleMs:Math.round(performance.now()-started)}}catch{}
    let memory=null;try{const total=os.totalmem(),free=os.freemem();if(total>0&&free>=0&&free<=total)memory={totalBytes:total,usedBytes:total-free,availableBytes:free,usedPercent:round((total-free)/total*100),processBytes:process.memoryUsage().rss}}catch{}
    let disk=null;try{disk=diskStats(await bounded(statfs(this.storage.root,{bigint:true})))}catch{}
    return{cpu,memory,disk};
  })}
  canTestStorage(s){return maintenanceAllows(s,'environment.check')&&['settings.read','settings.write'].every(p=>s.permissions.includes((s.role==='tenant'?'tenant:':'')+p))}
  async view(s){this.allow(s);const [resources,database,redis,storage]=await Promise.all([this.resources(),this.database(),this.cache(),this.directory()]);return{runtime:{version:this.version()||null,node:process.version,nestjs:versions.nestjs,prisma:versions.prisma,platform:({win32:'Windows',linux:'Linux',darwin:'macOS'})[process.platform]||'其他',architecture:os.arch(),osRelease:os.release(),mode:({development:'开发',production:'生产',test:'测试'})[process.env.NODE_ENV]||'未指定',uptimeSeconds:Math.floor(process.uptime())},resources,checks:{database,redis,storage},canTestStorage:this.canTestStorage(s),updatedAt:new Date().toISOString()}}
  async check(s,body){
    this.allow(s,'environment.check');if(!body||Object.keys(body).length!==1||!['database','redis','storage'].includes(body.target))fail('ENVIRONMENT_CHECK_INVALID','请选择有效的检测项目');
    if(body.target==='database')return this.database();if(body.target==='redis')return this.cache();
    if(!this.canTestStorage(s))fail('FORBIDDEN','目录读写检测需要存储配置查看和修改权限',403);
    if(s.role==='tenant'){
      const target=join(this.storage.root,'.standalone-environment-'+randomUUID()),handle=await open(target,'wx+',0o600);
      try{await handle.writeFile('qicore');const value=Buffer.alloc(6);await handle.read(value,0,6,0);if(value.toString()!=='qicore')throw Error('STORAGE_CHECK_FAILED')}
      finally{try{await handle.close()}finally{await unlink(target)}}return this.directory();
    }
    await this.storage.test(s,'local');return this.directory();
  }
}
