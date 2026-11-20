import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {timingSafeEqual} from 'node:crypto';

export function developmentGateway({port,corePort,applications,token,status,shutdown}){
 function target(path,upgrade=false){
  if(upgrade&&path.includes('/__qicore_dev/core-hmr'))return corePort;
  for(const app of applications){
   if(upgrade&&path.includes('/__qicore_dev/'+app.key+'/admin-hmr'))return app.adminPort;
   if(app.web?.h5&&path.startsWith('/__qicore_dev/'+app.key+'/h5/'))return app.h5Port;
   if(app.web?.admin&&path.startsWith('/application-assets/'+app.key+'/'+app.version+'/admin/'))return app.adminPort;
  }
  return upgrade?null:corePort;
 }
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/__qicore_dev/status'){res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify(status()));return}
  if(path==='/__qicore_dev/stop'){
   const supplied=Buffer.from(String(req.headers['x-qicore-development-token']||'')),expected=Buffer.from(token);
   if(req.method!=='POST'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(403);res.end();return}
   res.end('stopping');setImmediate(()=>void shutdown());return;
  }
  let decoded;try{decoded=decodeURIComponent(path)}catch{res.writeHead(400);res.end();return}
  if(/(?:^|\/)(?:\.env(?:\.|\/|$)|\.git(?:\/|$))/.test(decoded)||decoded.endsWith('/static/runtime.json')){res.writeHead(404);res.end();return}
  const targetPort=target(path),upstream=request({hostname:'127.0.0.1',port:targetPort,path:req.url,method:req.method,headers:{...req.headers,host:targetPort===corePort?req.headers.host:'127.0.0.1:'+targetPort}},response=>{res.writeHead(response.statusCode||502,response.headers);response.pipe(res)});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'content-type':'text/plain; charset=utf-8'});res.end('开发服务正在准备或重新编译，请稍后刷新。')});req.pipe(upstream);res.on('close',()=>upstream.destroy());
 });
 const sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))});
 server.on('upgrade',(req,socket,head)=>{
  const port=target(new URL(req.url,'http://127.0.0.1').pathname,true);if(!port){socket.destroy();return}
  const upstream=connect(port,'127.0.0.1',()=>{const headers={...req.headers,host:'127.0.0.1:'+port};upstream.write(req.method+' '+req.url+' HTTP/1.1\r\n'+Object.entries(headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)});
  socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
 });
 return{async listen(){await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)});return server.address()},async close(){for(const socket of sockets)socket.destroy();await new Promise(ok=>server.close(ok))}};
}
