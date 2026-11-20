import {needMaintenance,maintenanceAllows,maintenanceAudit} from './standalone-maintenance.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';

export function cacheNamespace(url){const u=new URL(url);return 'zjz:'+createHash('sha256').update(u.hostname+':'+u.port+u.pathname+(u.searchParams.has('socket')?'\0'+u.searchParams.get('socket'):'')).digest('hex').slice(0,16)+':cache:'}
export class SystemCache{
  constructor(db,redis,url=process.env.DATABASE_URL){this.db=db;this.redis=redis;this.prefix=cacheNamespace(url)}
  allow(s,permission){needMaintenance(s,permission)}
  async keys(){
    const prefix=this.prefix;
    const keys=new Set(),deadline=Date.now()+5000;let cursor='0',pages=0;
    do{if(Date.now()>deadline)fail('CACHE_LIMIT','缓存扫描超时，请稍后重试',409);const result=await this.redis.scan(cursor,'MATCH',prefix+'*','COUNT',100);cursor=result[0];for(const key of result[1])if(key.startsWith(prefix))keys.add(key);if(++pages>100||keys.size>10000)fail('CACHE_LIMIT','缓存数量较多，请由运维人员分批处理',409)}while(cursor!=='0');
    return [...keys];
  }
  async view(s){this.allow(s,'cache.read');try{return{count:(await this.keys()).length,canClear:maintenanceAllows(s,'cache.clear')}}catch(e){if(e.code==='CACHE_LIMIT')throw e;fail('CACHE_UNAVAILABLE','缓存服务暂不可用，请稍后重试',503)}}
  async clear(s){
    this.allow(s,'cache.clear');let keys;try{keys=await this.keys()}catch(e){if(e.code==='CACHE_LIMIT')throw e;fail('CACHE_UNAVAILABLE','缓存服务暂不可用，请稍后重试',503)}
    const id=randomUUID();await this.db.audit.create({data:{id,...maintenanceAudit(s),actor:s.id,action:'cache.clear',details:{status:'started',requested:keys.length}}});
    let cleared=0;try{for(let i=0;i<keys.length;i+=100)cleared+=await this.redis.unlink(...keys.slice(i,i+100));await this.db.audit.update({where:{id},data:{details:{status:'completed',cleared}}});return{cleared}}catch{await this.db.audit.update({where:{id},data:{details:{status:'failed',cleared}}}).catch(()=>{});fail('CACHE_CLEAR_FAILED','清理未完成，部分缓存可能已清理，请刷新后重试',503)}
  }
}
