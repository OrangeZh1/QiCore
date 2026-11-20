import {createServer,request,type IncomingHttpHeaders} from 'node:http';
import {connect,type Socket} from 'node:net';
import {fork} from 'node:child_process';

export type GatewaySettings={publicPort:number;uiPort:number;maintenance:{port:number}|{socketPath:string}};
const hopHeaders=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function headers(input:IncomingHttpHeaders){
 const blocked=new Set([...hopHeaders,...String(input.connection??'').toLowerCase().split(',').map(value=>value.trim())]);
 return Object.fromEntries(Object.entries(input).filter(([name,value])=>value!==undefined&&!blocked.has(name.toLowerCase())));
}

// Run in the unprivileged stable worker. Never derive an upstream from client input.
export function createBootstrapGateway(uiPort:number,maintenance:GatewaySettings['maintenance']){
 const sockets=new Set<Socket>(),upgraded=new Set<Socket>();let closing=false;
 const server=createServer((req,res)=>{
  if(!req.url?.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end();return}
  const isMaintenance=req.url.split('?')[0]==='/api/v1/public/maintenance';
  if(isMaintenance&&req.method!=='GET'){res.writeHead(404);res.end();return}
  if(closing){res.writeHead(503,{'cache-control':'no-store'});res.end();return}
  const target=isMaintenance?maintenance:{port:uiPort};
  const upstream=request({hostname:'127.0.0.1',...target,path:isMaintenance?'/api/v1/public/maintenance':req.url,method:req.method,headers:headers(req.headers),agent:false},response=>{
   res.writeHead(response.statusCode??502,headers(response.headers));response.on('error',()=>res.destroy());response.pipe(res);
  });
  upstream.setTimeout(60000,()=>upstream.destroy());
  upstream.on('error',()=>{
   if(res.destroyed)return;if(res.headersSent){res.destroy();return}
   res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'服务暂时不可用，请稍后重试'}}));
  });
  req.on('aborted',()=>upstream.destroy());req.on('error',()=>upstream.destroy());res.on('close',()=>{if(!res.writableFinished)upstream.destroy()});req.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});
 server.on('upgrade',(req,socket,head)=>{
  const client=socket as Socket;
  if(closing||req.headers.upgrade?.toLowerCase()!=='websocket'||!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.split('?')[0]==='/api/v1/public/maintenance'){client.destroy();return}
  const upstream=connect({host:'127.0.0.1',port:uiPort}),close=()=>{client.destroy();upstream.destroy()};
  upgraded.add(client);client.on('close',()=>{upgraded.delete(client);upstream.destroy()});client.on('error',close);upstream.on('error',close);upstream.on('close',()=>client.destroy());upstream.setTimeout(10000,close);
  upstream.on('connect',()=>{
   upstream.setTimeout(0);const forwarded={...headers(req.headers),connection:'Upgrade',upgrade:'websocket'};
   upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(forwarded).flatMap(([name,value])=>(Array.isArray(value)?value:[value]).map(item=>`${name}: ${item}\r\n`)).join('')+'\r\n');
   if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);
  });
 });
 async function close(){
  closing=true;for(const socket of upgraded)socket.destroy();if(!server.listening)return;
  await new Promise<void>((ok,fail)=>{const timeout=setTimeout(()=>{for(const socket of sockets)socket.destroy()},60000);timeout.unref();server.close(error=>{clearTimeout(timeout);error?fail(error):ok()})});
 }
 return {server,close};
}

export async function startBootstrapGateway(settings:GatewaySettings,uid:number,gid:number,onUnexpectedExit:()=>void){
 if(!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0)throw Error('UNPRIVILEGED_GATEWAY_REQUIRED');
 const child=fork(new URL('./bootstrap-gateway-worker.js',import.meta.url),[JSON.stringify(settings)],{uid,gid,env:{NODE_ENV:'production'},execArgv:[],stdio:['ignore','inherit','inherit','ipc']});
 let stopping=false,ready=false,failed=false;
 const unexpected=()=>{if(ready&&!stopping&&!failed){failed=true;onUnexpectedExit()}};child.on('exit',unexpected);child.on('error',unexpected);
 const close=async()=>{
  stopping=true;if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>((ok,fail)=>{
   const timeout=setTimeout(()=>{child.kill('SIGKILL');fail(Error('GATEWAY_DRAIN_TIMEOUT'))},65000);timeout.unref();
   child.once('exit',()=>{clearTimeout(timeout);ok()});if(child.connected)child.send('stop',error=>{if(error)child.kill('SIGTERM')});else child.kill('SIGTERM');
  });
 };
 try{
  await new Promise<void>((ok,fail)=>{
   const timeout=setTimeout(()=>fail(Error('GATEWAY_START_TIMEOUT')),15000);
   const exit=()=>{clearTimeout(timeout);fail(Error('GATEWAY_START_FAILED'))};child.once('exit',exit);child.once('error',exit);
   child.once('message',message=>{clearTimeout(timeout);child.removeListener('exit',exit);child.removeListener('error',exit);
    if(!message||typeof message!=='object'||!('uid' in message)||message.uid!==uid||!('ready' in message)||message.ready!==true){fail(Error('UNPRIVILEGED_GATEWAY_REQUIRED'));return}
    ready=true;ok();
   });
  });
 }catch(error){await close();throw error}
 return {close,pid:child.pid};
}
