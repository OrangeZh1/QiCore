import { request } from 'node:http';
import type { UpdateTask } from './update-engine.js';

export type UpdaterStatus = {kind?:'native';backups?:{ready:boolean;code:string|null};applicationIdentities?:{packageKey:string;key:string}[];applicationLifecycle?:boolean;code:'READY'|'RUNNING'|'RECOVERY_REQUIRED'|'INSTALLATION_REQUIRED';tasks:(UpdateTask&{packageKey?:string})[];components?:{packageKey:string;version:string;update:any}[]};
export function updaterRequest<T>(path:string,body?:unknown,socketPath=process.env.UPDATER_SOCKET):Promise<T> {
  if(!socketPath) return Promise.reject(Error('UPDATER_NOT_CONFIGURED'));
  return new Promise((resolve,reject)=>{
    const req=request({socketPath,path,method:body?'POST':'GET',headers:{'content-type':'application/json'}},res=>{
      let raw='';res.on('data',chunk=>{raw+=chunk;if(raw.length>32*1024*1024)req.destroy(Error('UPDATER_RESPONSE_TOO_LARGE'))});
      res.on('end',()=>{let value;try{value=JSON.parse(raw)}catch{reject(Error('UPDATER_REQUEST_REJECTED'));return}if(res.statusCode!==200&&res.statusCode!==202){reject(Object.assign(Error(typeof value.code==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(value.code)?value.code:'UPDATER_REQUEST_REJECTED'),{responseStatus:res.statusCode}));return}resolve(value)});
      res.on('error',()=>reject(Error('UPDATER_UNAVAILABLE')));
    });
    req.setTimeout(path.endsWith('/check')?30000:5000,()=>req.destroy(Error('UPDATER_TIMEOUT')));
    req.on('error',()=>reject(Error('UPDATER_UNAVAILABLE')));req.end(body?JSON.stringify(body):undefined);
  });
}
export function publicTasks(tasks:(UpdateTask&{businessAvailable?:boolean})[]) {
  return tasks.map(t=>({id:t.id,operation:t.operation??'update',businessAvailable:t.businessAvailable===true,status:t.status,step:t.step,code:t.code,integrity:t.integrity,createdAt:t.createdAt,updatedAt:t.updatedAt,
    packageKey:t.request?.packageKey??null,version:t.componentTarget?.to?.version??t.target?.to.version??null,fromVersion:t.componentTarget?.from?.version??t.target?.from.version??null,releaseNotes:t.componentTarget?.releaseNotes??t.target?.releaseNotes??''}));
}
