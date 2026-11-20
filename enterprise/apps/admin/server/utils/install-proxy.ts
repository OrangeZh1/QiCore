import {request} from 'node:http'
import type {H3Event} from 'h3'
export async function installProxy(event:H3Event,path:string){
 const socket=String(useRuntimeConfig().installSocket||'')
 if(!socket)throw createError({statusCode:404,statusMessage:'安装入口未启用'})
 let body:string|undefined
 if(event.method==='POST'){const chunks:Buffer[]=[];let size=0;for await(const chunk of event.node.req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>16384)throw createError({statusCode:413,statusMessage:'请求内容过大'});chunks.push(bytes)}body=Buffer.concat(chunks).toString('utf8')}
 const headers:Record<string,string>={'content-type':'application/json'}
 for(const name of ['origin','cookie','x-install-csrf']){const value=getHeader(event,name);if(value)headers[name]=value}
 headers['x-install-host']=getRequestURL(event).hostname
 const response=await new Promise<{status:number;headers:Record<string,string|string[]|undefined>;body:string}>((ok,fail)=>{
  const req=request({socketPath:socket,path,method:event.method,headers},res=>{let text='';res.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>1024*1024)req.destroy(Error('INSTALL_RESPONSE_TOO_LARGE'))});res.on('end',()=>ok({status:res.statusCode||502,headers:res.headers as Record<string,string|string[]|undefined>,body:text}));res.on('error',fail)})
  req.on('error',()=>fail(createError({statusCode:503,statusMessage:'安装服务暂不可用，请稍后重试'})));req.setTimeout(25000,()=>req.destroy(Error('INSTALL_REQUEST_TIMEOUT')));req.end(body)
 })
 setResponseStatus(event,response.status);setHeader(event,'cache-control','no-store, private');setHeader(event,'referrer-policy','no-referrer')
 if(response.headers['set-cookie'])setHeader(event,'set-cookie',response.headers['set-cookie']!)
 return JSON.parse(response.body)
}
