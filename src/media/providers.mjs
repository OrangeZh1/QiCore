import OSS from 'ali-oss';
import COS from 'cos-nodejs-sdk-v5';
import qiniu from 'qiniu';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {open} from 'node:fs/promises';
import {Transform,pipeline} from 'node:stream';
import {byteRange} from './range.mjs';
import {isIP,BlockList} from 'node:net';
import {putLocal,getLocal,deleteLocal,checkedPath} from './local.mjs';

const deny=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]])deny.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]])deny.addSubnet(ip,bits,'ipv6');
// Node also matches IPv4 against mapped-IPv6 rules; apply this rule only to IPv6 answers.
const mapped=new BlockList();mapped.addSubnet('::ffff:0:0',96,'ipv6');
export function privateDomain(value){if(!value)return '';const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||url.pathname!=='/'||isIP(url.hostname)||!url.hostname.includes('.'))throw Error('PRIVATE_DOMAIN_INVALID');return url.origin}
export function publicObjectUrl(provider,config,key){
  if(provider==='local'||config.access!=='public')return null;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.[a-z0-9]+$/.test(key)||key.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('INVALID_OBJECT_KEY');
  const domain=privateDomain(config.privateDomain);if(!domain)throw Error('STORAGE_DOMAIN_REQUIRED');
  return domain+'/'+key.split('/').map(encodeURIComponent).join('/');
}
export async function publicAddress(url,resolver=lookup){const addresses=await resolver(url.hostname,{all:true});if(!addresses.length||addresses.some(a=>![4,6].includes(a.family)||deny.check(a.address,a.family===4?'ipv4':'ipv6')||a.family===6&&mapped.check(a.address,'ipv6')))throw Error('PRIVATE_NETWORK_REJECTED');return addresses[0]}
// Pin a public DNS answer in the actual HTTPS connection; redirects are never followed.
export async function download(urlString,max=20*1024*1024){
  const url=new URL(urlString);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw Error('DOWNLOAD_URL_INVALID');
  const address=await publicAddress(url);
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',family:address.family,autoSelectFamily:false,lookup:(_host,_options,callback)=>callback(null,address.address,address.family)},res=>{
      const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>max){req.destroy(Error('OBJECT_TOO_LARGE'));return}chunks.push(chunk)});
      res.on('error',()=>reject(Error('STORAGE_DOWNLOAD_FAILED')));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}));
    });req.setTimeout(15000,()=>req.destroy(Error('STORAGE_TIMEOUT')));req.on('error',()=>reject(Error('STORAGE_DOWNLOAD_FAILED')));req.end();
  });
}
export class StorageProviders {
  constructor(root,{transport=request,resolver=lookup}={}){this.root=root;this.transport=transport;this.resolver=resolver}
  oss(c,k){return new OSS({region:c.region,bucket:c.bucket,accessKeyId:k.accessKeyId,accessKeySecret:k.secret,secure:true,timeout:15000})}
  cos(k){return new COS({SecretId:k.accessKeyId,SecretKey:k.secret,Protocol:'https:',Timeout:15000})}
  qiniu(k){qiniu.conf.RPC_TIMEOUT=15000;const config=new qiniu.conf.Config({useHttpsDomain:true});config.regionsQueryResultCachePath=null;const mac=new qiniu.auth.digest.Mac(k.accessKeyId,k.secret);return{config,mac,manager:new qiniu.rs.BucketManager(mac,config)}}
  async checkPrivate(p,c,k){
    if(p==='local')return;
    if(p==='oss'){if((await this.oss(c,k).getBucketACL(c.bucket)).acl!=='private')throw Error('BUCKET_NOT_PRIVATE')}
    else if(p==='cos'){if((await this.cos(k).getBucketAcl({Bucket:c.bucket,Region:c.region})).ACL!=='private')throw Error('BUCKET_NOT_PRIVATE')}
    else{const r=await this.qiniu(k).manager.getBucketInfo(c.bucket);if(!r.ok()||![0,1].includes(r.data?.private))throw Error('BUCKET_LOOKUP_FAILED');if(r.data.private!==1)throw Error('BUCKET_NOT_PRIVATE')}
  }
  async put(p,c,k,key,bytes,mime='application/octet-stream'){
    if(p==='local')return putLocal(this.root,key,bytes);
    if(c.access!=='public')await this.checkPrivate(p,c,k);
    if(p==='oss')await this.oss(c,k).put(key,bytes,{mime,headers:{'x-oss-object-acl':c.access==='public'?'public-read':'private'}});
    else if(p==='cos')await this.cos(k).putObject({Bucket:c.bucket,Region:c.region,Key:key,Body:bytes,ContentType:mime,ACL:c.access==='public'?'public-read':'private'});
    else{const client=this.qiniu(k),token=new qiniu.rs.PutPolicy({scope:c.bucket+':'+key,expires:60}).uploadToken(client.mac),extra=new qiniu.form_up.PutExtra();extra.mimeType=mime;const r=await new qiniu.form_up.FormUploader(client.config).put(token,key,bytes,extra);if(r.resp?.statusCode!==200)throw Error('STORAGE_UPLOAD_FAILED')}
  }
  async url(p,c,k,key,signed=true){
    const publicUrl=publicObjectUrl(p,c,key);if(publicUrl)return publicUrl;
    if(p==='oss'){const url=this.oss(c,k).signatureUrl(key,{expires:60});if(signed)return url;const plain=new URL(url);plain.search='';return plain.href}
    if(p==='cos')return new Promise((resolve,reject)=>this.cos(k).getObjectUrl({Bucket:c.bucket,Region:c.region,Key:key,Sign:signed,Expires:60,Protocol:'https:'},(error,result)=>error?reject(Error('STORAGE_SIGN_FAILED')):resolve(result.Url)));
    const url=privateDomain(c.privateDomain)+'/'+key.split('/').map(encodeURIComponent).join('/');return signed?this.qiniu(k).manager.privateDownloadUrl(privateDomain(c.privateDomain),key,Math.floor(Date.now()/1000)+60):url;
  }
  async get(p,c,k,key,max=20*1024*1024){
    if(p==='local')return getLocal(this.root,key,max);
    const result=await download(await this.url(p,c,k,key),max);if(result.status!==200)throw Error('STORAGE_DOWNLOAD_FAILED');return result.bytes;
  }
  /** @returns {Promise<{stream:import('node:stream').Readable,length:number,range:{start:number,end:number,total:number}|null}>} */
  async stream(p,c,k,key,total,rangeHeader){
    if(!Number.isSafeInteger(total)||total<1||total>100*1024*1024)throw Error('OBJECT_TOO_LARGE');
    const range=byteRange(rangeHeader,total),length=range?range.end-range.start+1:total;
    if(p==='local'){
      const handle=await open(await checkedPath(this.root,key),'r');
      try{if((await handle.stat()).size!==total)throw Error('OBJECT_SIZE_CHANGED');const stream=handle.createReadStream(range?{start:range.start,end:range.end}:{});stream.on('error',()=>{});return{stream,length,range}}catch(e){await handle.close();throw e}
    }
    const url=new URL(await this.url(p,c,k,key));if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw Error('DOWNLOAD_URL_INVALID');
    const address=await publicAddress(url,this.resolver);
    return new Promise((resolve,reject)=>{
      const req=this.transport(url,{method:'GET',headers:range?{Range:`bytes=${range.start}-${range.end}`}:{},family:address.family,autoSelectFamily:false,lookup:(_host,_options,callback)=>callback(null,address.address,address.family)},res=>{
        if(res.statusCode!==(range?206:200)||range&&res.headers['content-range']!==`bytes ${range.start}-${range.end}/${total}`||res.headers['content-length']!==undefined&&Number(res.headers['content-length'])!==length){res.destroy();reject(Error('STORAGE_RANGE_INVALID'));return}
        let received=0;const stream=new Transform({transform(chunk,_encoding,done){received+=chunk.length;done(received>length?Error('OBJECT_TOO_LARGE'):null,chunk)},flush(done){done(received!==length?Error('OBJECT_SIZE_CHANGED'):null)}});
        stream.on('error',()=>{});stream.once('close',()=>req.destroy());pipeline(res,stream,error=>{if(error)stream.destroy(error)});resolve({stream,length,range});
      });req.setTimeout(15000,()=>req.destroy(Error('STORAGE_TIMEOUT')));req.on('error',()=>reject(Error('STORAGE_DOWNLOAD_FAILED')));req.end();
    });
  }
  async remove(p,c,k,key){
    if(p==='local')return deleteLocal(this.root,key);
    if(p==='oss')await this.oss(c,k).delete(key);
    else if(p==='cos')await this.cos(k).deleteObject({Bucket:c.bucket,Region:c.region,Key:key});
    else{const r=await this.qiniu(k).manager.delete(c.bucket,key);if(!r.ok()&&r.resp?.statusCode!==612)throw Error('STORAGE_DELETE_FAILED')}
  }
  async assertNotPublic(p,c,k,key){if(p==='local')return;const r=await download(await this.url(p,c,k,key,false),1024*1024);if(![401,403,404].includes(r.status))throw Error('PUBLIC_ACCESS_NOT_BLOCKED')}
}
