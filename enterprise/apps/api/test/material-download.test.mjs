import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {Materials,normalizeMaterial} from '../src/core/materials.mjs';
import {TenantMaterials} from '../src/core/tenant-materials.mjs';
import {StorageProviders,publicObjectUrl} from '../src/storage/providers.mjs';

for(const scope of ['platform','tenant'])test(`${scope} cloud attachments stream under the current filename while images and videos keep direct URLs`,async()=>{
 const bytes=Buffer.from('%PDF-1.7\nfixture document'),normalized=await normalizeMaterial(bytes,'合同.pdf'),requests=[];
 assert.equal(normalized.extension,'bin');assert.equal(normalized.kind,'file');
 const revision={id:randomUUID(),provider:'oss',config:{access:'public',privateDomain:'https://files.example.com'}};
 const providers=new StorageProviders('unused',{
  resolver:async()=>[{address:'203.0.113.10',family:4}],
  transport:(url,options,callback)=>{
   requests.push({url:String(url),headers:options.headers});const request=new EventEmitter();request.setTimeout=()=>request;request.destroy=()=>request;
   request.end=()=>queueMicrotask(()=>{const range=options.headers.Range?.match(/^bytes=(\d+)-(\d+)$/),part=range?bytes.subarray(Number(range[1]),Number(range[2])+1):bytes;
    const response=Readable.from([part]);response.statusCode=range?206:200;response.headers={'content-length':String(part.length),...(range?{'content-range':`bytes ${range[1]}-${range[2]}/${bytes.length}`}:{})};callback(response)});return request;
  }
 });
 const storage={providers,revision:async()=>revision,credentials:()=>null,publicUrl:(r,key)=>publicObjectUrl(r.provider,r.config,key)};
 let row={id:randomUUID(),tenantId:'site-a',scopeKey:'shared',name:normalized.name,kind:'file',mime:normalized.mime,bytes:bytes.length,provider:'oss',revisionId:revision.id,objectKey:`sites/site-a/shared/materials/${randomUUID()}.bin`,status:'ready'};
 const service=scope==='platform'?new Materials({},storage):new TenantMaterials({},storage);
 if(scope==='platform')service.get=async()=>row;else{service.authorize=async()=>({});service.row=async()=>row}
 const stream=range=>scope==='platform'?service.streamContent({},row.id,{},range):service.streamContent({},row.tenantId,row.scopeKey,row.id,{},range);
 const entry=await service.expose(row);assert.ok(entry.url.startsWith('/api/v1/admin/'));assert.ok(entry.url.includes(row.id));assert.equal(entry.name,'合同.pdf');
 const first=await stream();assert.equal(first.redirect,undefined);assert.equal(first.inline,false);assert.equal(first.name,'合同.pdf');assert.deepEqual(Buffer.concat(await Array.fromAsync(first.stream)),bytes);
 row={...row,name:'已签署合同.pdf'};const renamed=await stream('bytes=2-5');assert.equal(renamed.name,row.name);assert.equal(renamed.inline,false);assert.deepEqual(renamed.range,{start:2,end:5,total:bytes.length});assert.deepEqual(Buffer.concat(await Array.fromAsync(renamed.stream)),bytes.subarray(2,6));
 assert.equal(requests[1].headers.Range,'bytes=2-5');assert.equal(requests[0].url,'https://files.example.com/'+row.objectKey);
 for(const kind of ['image','video']){
  row={...row,kind,mime:kind==='image'?'image/webp':'video/mp4'};
  assert.equal((await service.expose(row)).url,'https://files.example.com/'+row.objectKey);
  assert.equal((await stream()).redirect,'https://files.example.com/'+row.objectKey);
 }
 assert.equal(requests.length,2,'public image/video links do not proxy cloud bytes');
});
