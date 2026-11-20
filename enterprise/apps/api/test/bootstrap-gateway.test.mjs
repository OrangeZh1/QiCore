import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter,once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBootstrapGateway,startBootstrapGateway} from '../dist/lifecycle/bootstrap-gateway.js';

const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port};
const close=server=>new Promise((ok,fail)=>server.listening?server.close(error=>error?fail(error):ok()):ok());
async function setup(t,handler){
 const ui=createServer(handler),uiPort=await listen(ui),maintenance=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data:{state:'updating',protocol:'qicore-maintenance-v1'}}))});
 const maintenancePort=await listen(maintenance),gateway=createBootstrapGateway(uiPort,{port:maintenancePort}),port=await listen(gateway.server);
 t.after(async()=>{await gateway.close();await close(ui);await close(maintenance)});
 return {ui,maintenance,gateway,port,base:'http://127.0.0.1:'+port};
}
function send(port,path,options={}){return new Promise((ok,fail)=>{const req=request({host:'127.0.0.1',port,path,...options},res=>{const chunks=[];res.on('data',value=>chunks.push(value));res.on('error',fail);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}))});req.on('error',fail);req.end(options.body)})}

test('one public entry preserves page titles, paths, Origin, cookies and redirects without trusting Host as a target',async t=>{
 let received;const x=await setup(t,(req,res)=>{
  received={url:req.url,headers:req.headers};res.setHeader('set-cookie',['a=1; HttpOnly','b=2; Secure']);
  if(req.url==='/redirect'){res.writeHead(302,{location:'/admin/login'});res.end();return}
  res.setHeader('content-type','text/html');res.end('<html><title>客户后台 · QiCore</title></html>');
 });
 const response=await send(x.port,'/admin/settings?q=a%2Fb',{headers:{host:'qisaas.vipui.cn',origin:'https://qisaas.vipui.cn',cookie:'session=fixture',connection:'x-hop','x-hop':'remove'}});
 assert.equal(response.status,200);assert.match(response.body,/<title>客户后台 · QiCore<\/title>/);assert.equal(response.headers['set-cookie'].length,2);
 assert.equal(received.url,'/admin/settings?q=a%2Fb');assert.equal(received.headers.host,'qisaas.vipui.cn');assert.equal(received.headers.origin,'https://qisaas.vipui.cn');assert.equal(received.headers.cookie,'session=fixture');assert.equal(received.headers['x-hop'],undefined);
 assert.equal((await send(x.port,'/redirect')).headers.location,'/admin/login');
 assert.equal((await send(x.port,'/test',{headers:{host:'untrusted.invalid'}})).status,200);assert.equal(received.headers.host,'untrusted.invalid');
 assert.equal((await send(x.port,'http://untrusted.invalid/path')).status,400);
});

test('uploads stream before completion and aborted clients close the upstream',async t=>{
 let first,aborted;const firstChunk=new Promise(ok=>first=ok),upstreamAborted=new Promise(ok=>aborted=ok);
 const x=await setup(t,(req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;first()});req.on('aborted',aborted);req.on('end',()=>res.end(body))});
 const completed=new Promise((ok,fail)=>{const req=request({host:'127.0.0.1',port:x.port,path:'/api/upload',method:'POST'},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>ok(body))});req.on('error',fail);req.write('first');firstChunk.then(()=>req.end('second'))});
 assert.equal(await completed,'firstsecond');
 let started;const nextChunk=new Promise(ok=>started=ok);x.ui.once('request',req=>req.once('data',started));
 const req=request({host:'127.0.0.1',port:x.port,path:'/api/upload',method:'POST'});req.on('error',()=>{});req.write('partial');await nextChunk;req.destroy();await upstreamAborted;
});

test('streamed responses arrive immediately and maintenance remains available while the UI is stopped',async t=>{
 let finish;const release=new Promise(ok=>finish=ok);
 const x=await setup(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');void release.then(()=>res.end('data: last\n\n'))});
 const response=await fetch(x.base+'/events'),reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/first/);finish();await reader.cancel();
 x.ui.closeAllConnections();await close(x.ui);
 const status=await fetch(x.base+'/api/v1/public/maintenance?refresh=1');assert.equal(status.status,200);assert.equal((await status.json()).data.state,'updating');
 assert.equal((await fetch(x.base+'/api/v1/public/maintenance',{method:'POST'})).status,404);
 const down=await fetch(x.base+'/admin');assert.equal(down.status,503);assert.equal((await down.json()).error.code,'SERVICE_UNAVAILABLE');
});

test('WebSocket handshakes and frames pass through the same fixed UI target',async t=>{
 const x=await setup(t,(_req,res)=>res.end());const peers=new Set();t.after(()=>{for(const peer of peers)peer.destroy()});
 x.ui.on('upgrade',(req,socket)=>{
  peers.add(socket);socket.on('close',()=>peers.delete(socket));socket.on('error',()=>{});
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.write(Buffer.from([0x81,2,104,105]));
  socket.on('data',chunk=>{if((chunk[0]&15)===8)socket.end(Buffer.from([0x88,0]))});
 });
 const ws=new WebSocket(x.base.replace('http:','ws:')+'/socket');
 assert.equal(await new Promise((ok,fail)=>{ws.addEventListener('message',event=>ok(event.data),{once:true});ws.addEventListener('error',fail,{once:true})}),'hi');
 const closed=new Promise(ok=>ws.addEventListener('close',ok,{once:true}));ws.close();await closed;
});

test('maintenance can use a private local socket without exposing a second HTTP port',async t=>{
 const id=randomUUID(),socketPath=process.platform==='win32'?'\\\\.\\pipe\\qicore-maintenance-'+id:join(tmpdir(),'qicore-maintenance-'+id+'.sock');
 const maintenance=createServer((_req,res)=>res.end('{"data":{"state":"updating"}}'));maintenance.listen(socketPath);await once(maintenance,'listening');
 const gateway=createBootstrapGateway(1,{socketPath}),port=await listen(gateway.server);t.after(async()=>{await gateway.close();await close(maintenance)});
 assert.equal((await send(port,'/api/v1/public/maintenance')).body,'{"data":{"state":"updating"}}');
});

test('gateway supervision drops privileges, excludes parent secrets and handles exit once',async t=>{
 const original=childProcess.fork;let child,options,failures=0;
 childProcess.fork=(_entry,_args,opts)=>{options=opts;child=new EventEmitter();Object.assign(child,{pid:123,exitCode:null,signalCode:null,connected:true,send:()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0))},kill:()=>{child.signalCode='SIGTERM';queueMicrotask(()=>child.emit('exit',null))}});queueMicrotask(()=>child.emit('message',{ready:true,uid:10001}));return child};syncBuiltinESMExports();
 t.after(()=>{childProcess.fork=original;syncBuiltinESMExports()});
 const settings={publicPort:3500,uiPort:3502,maintenance:{socketPath:'/tmp/fixture-maintenance.sock'}};
 await assert.rejects(startBootstrapGateway(settings,0,10001,()=>{}),/UNPRIVILEGED_GATEWAY_REQUIRED/);
 const gateway=await startBootstrapGateway(settings,10001,10001,()=>failures++);assert.equal(options.uid,10001);assert.equal(options.gid,10001);assert.deepEqual(options.env,{NODE_ENV:'production'});
 child.exitCode=1;child.emit('exit',1);child.emit('exit',1);assert.equal(failures,1);await gateway.close();
 const planned=await startBootstrapGateway(settings,10001,10001,()=>failures++);await planned.close();assert.equal(failures,1);
});
