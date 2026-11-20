import { createServer } from 'node:http';
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { StateStore } from '../license/store.js';
import { UpdateEngine, type UpdateEffects } from './update-engine.js';

const executeSchema=z.object({requestId:z.string().uuid(),targetVersion:z.string().regex(/^\d+\.\d+\.\d+$/)}).strict();
const resumeSchema=z.object({taskId:z.string().uuid()}).strict();
// Caller must hold the deployment's OS flock for this server's entire lifetime.
export function createUpdaterServer(store:StateStore,effects:(id:string,version?:string)=>UpdateEffects) {
  let engine:UpdateEngine|undefined;
  const make=(id:string,version?:string)=>new UpdateEngine(store,effects(id,version));
  return createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    try {
      let tasks=store.read<import('./update-engine.js').UpdateTask[]>('tasks.json')??[];
      if(req.method==='GET'&&req.url==='/status') {
        const installation=store.read<{status:string}>('installation.json');
        res.end(JSON.stringify({code:installation?.status==='recovery_required'||tasks.some(t=>t.status==='recovery_required')?'RECOVERY_REQUIRED':tasks.some(t=>t.status==='running')?'RUNNING':store.read('active.json')?'READY':'INSTALLATION_REQUIRED',tasks}));return;
      }
      if(req.method!=='POST'||!['/execute','/resume-closeout'].includes(req.url??'')){res.statusCode=404;res.end('{}');return}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error('BODY_TOO_LARGE')}
      tasks=store.read<import('./update-engine.js').UpdateTask[]>('tasks.json')??[];
      if(req.url==='/execute') {
        const input=executeSchema.parse(JSON.parse(body)),old=tasks.find(t=>t.id===input.requestId);
        if(old){if(old.target&&old.target.to.version!==input.targetVersion)throw Error('REQUEST_ID_REUSED');res.end(JSON.stringify(old));return}
        if(tasks.some(t=>['running','recovery_required'].includes(t.status)))throw Error('UPDATE_ALREADY_ACTIVE');
        const installation=store.read<{status:string}>('installation.json');
        if(installation&&installation.status!=='succeeded')throw Error('INSTALLATION_NOT_COMPLETE');
        engine=make(input.requestId,input.targetVersion);
        // execute persists the task synchronously before its first effect awaits.
        void engine.execute(input.requestId).catch(()=>{});
        res.statusCode=202;res.end(JSON.stringify({accepted:true,taskId:input.requestId}));return;
      }
      const {taskId}=resumeSchema.parse(JSON.parse(body));
      if(tasks.some(t=>t.status==='running'))throw Error('UPDATE_ALREADY_ACTIVE');
      if(!tasks.some(t=>t.id===taskId&&t.status==='recovery_required'&&['ACTIVE_HEALTHY_CLOSEOUT_BLOCKED','ROLLBACK_CLOSEOUT_BLOCKED'].includes(t.code??'')))throw Error('CLOSEOUT_NOT_RETRYABLE');
      engine=make(taskId);void engine.resumeCloseout(taskId).catch(()=>{});
      res.statusCode=202;res.end(JSON.stringify({accepted:true,taskId}));
    }catch{res.statusCode=409;res.end(JSON.stringify({code:'UPDATE_REQUEST_REJECTED'}))}
  });
}
export function clearOwnedSocket(socket:string){
  if(existsSync(socket)){if(!lstatSync(socket).isSocket())throw Error('UNEXPECTED_SOCKET_TARGET');unlinkSync(socket)}
}
export function restrictSocket(socket:string){chmodSync(socket,0o660)}
