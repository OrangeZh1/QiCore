import {randomUUID} from 'node:crypto';
export function requestContext(_req,res,next){res.locals.requestId=randomUUID();res.setHeader('X-Request-Id',res.locals.requestId);next()}
export function logFailure(error,context={}){
 const token=(v,max=80)=>typeof v==='string'&&/^[A-Za-z0-9_.:-]+$/.test(v)?v.slice(0,max):undefined;
 const frames=String(error?.stack||'').split('\n').slice(1).flatMap(line=>line.match(/[\w.-]+\.(?:[cm]?js|ts):\d+:\d+/g)||[]).slice(0,8);
 console.error(JSON.stringify({level:'error',at:new Date().toISOString(),requestId:token(context.requestId),recordId:token(context.recordId),operation:token(context.operation),method:token(context.method),status:Number.isInteger(context.status)?context.status:undefined,code:token(error?.code)||'INTERNAL_ERROR',frames}));
}
