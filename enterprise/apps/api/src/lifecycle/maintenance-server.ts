import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {NativeState} from './native-state.js';
import type {NativeHost} from './native-host.js';

// Separate from both runtime children. Nginx routes only this public read endpoint here.
export function createMaintenanceServer(state:NativeState,host:Pick<NativeHost,'running'|'acceptsHealth'>,transport:typeof fetch=fetch){
 let cached=false,expires=0,pending:Promise<boolean>|undefined;
 const read=(name:string)=>{const path=join(state.config.dataRoot,'control',name);return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null};
 function maintenanceStatus(){
  const maintenance=read('maintenance.json');
  if(!maintenance)return null;
  const history=read('maintenance-history.json');
  const recent=(Array.isArray(history)?history:[]).filter(item=>item.outcome==='updated'&&Number.isFinite(item.durationMs)&&item.durationMs>0&&Date.now()-Date.parse(item.finishedAt)<30*86400000).slice(-10);
  const estimate=recent.length?Math.ceil(Math.max(...recent.map(item=>item.durationMs))/30000)*30:null;
  const task=state.tasks().find(item=>item.id===maintenance.taskId);
  return {state:task?.status==='recovery_required'?'recovery_required':'updating',startedAt:maintenance.at,estimatedSeconds:estimate,serviceAvailable:false};
 }
 async function health(){
  let available=false;
  if(host.running())try{const response=await transport(state.config.healthUrl,{signal:AbortSignal.timeout(2000),redirect:'error'});const health=await response.json() as any;available=response.ok&&health.ready===true&&health.mock!==true&&host.acceptsHealth(health);}catch{}
  return available;
 }
 return createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');res.setHeader('access-control-allow-origin','*');res.setHeader('x-content-type-options','nosniff');
  if(req.method!=='GET'||req.url!=='/api/v1/public/maintenance'){res.statusCode=404;res.end('{}');return;}
  try{
   let maintenance=maintenanceStatus();
   if(!maintenance&&Date.now()>=expires){pending??=health().then(value=>{cached=value;expires=Date.now()+1000;return value}).finally(()=>{pending=undefined});await pending;}
   // A new update may begin during the health await or while health is cached.
   // The maintenance journal is authoritative at response time, never cached.
   maintenance=maintenanceStatus();
   const available=cached&&Date.now()<expires&&host.running();
   res.end(JSON.stringify({data:{protocol:'qicore-maintenance-v1',...(maintenance??{state:available?'ready':'unavailable',startedAt:null,estimatedSeconds:null,serviceAvailable:available})}}));
  }catch{res.statusCode=503;res.end(JSON.stringify({error:{code:'MAINTENANCE_STATUS_UNAVAILABLE'}}));}
 });
}
