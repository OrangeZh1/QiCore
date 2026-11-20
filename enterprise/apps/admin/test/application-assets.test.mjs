import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {createServer,request} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync} from 'node:zlib';
import ts from 'typescript';

test('default branding files stay within the small-display asset budget',async()=>{
 for(const name of ['qicore.png','admin-avatar.png']){
  const bytes=await readFile(new URL('../public/brand/'+name,import.meta.url));
  assert.ok(bytes.length<=32768,name+' exceeds 32 KiB');
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
  assert.ok(bytes.readUInt32BE(16)<=256&&bytes.readUInt32BE(20)<=256,name+' exceeds 256px');
 }
});

test('application assets negotiate precompressed bytes, keep old packages usable and preserve HTTP and path boundaries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-assets-')),source=Buffer.from('console.log("static application asset");\n'.repeat(200));
 await mkdir(join(root,'public/_nuxt'),{recursive:true});
 for(const [suffix,bytes] of [['',source],['.br',brotliCompressSync(source)],['.gz',gzipSync(source)]])await writeFile(join(root,'public/_nuxt/entry.js'+suffix),bytes);
 await writeFile(join(root,'public/legacy.css'),'body{color:blue}');
 const require=createRequire(import.meta.url),nuxtRequire=createRequire(require.resolve('nuxt/package.json')),h3=require(nuxtRequire.resolve('h3'));
 const text=await readFile(new URL('../server/routes/application-assets/[applicationKey]/[version]/[...path].get.ts',import.meta.url),'utf8'),exports={};
 const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const files={installedWebApplications:async()=>[{key:'fixture',version:'1.0.0',root,web:{admin:{publicDir:'public'}}}],applicationWebFile:async(_root,file)=>{const path=resolve(root,file);if(!path.startsWith(root+sep))throw Error('outside application');await stat(path);return path}};
 new Function('require','exports','defineEventHandler','getRouterParam','createError','setHeader',code)(name=>name==='h3'?h3:name.startsWith('node:')?require(name):files,exports,h3.defineEventHandler,h3.getRouterParam,h3.createError,h3.setHeader);
 const app=h3.createApp();app.use(h3.eventHandler(event=>{const [,,applicationKey,version,...path]=h3.getRequestURL(event).pathname.split('/');event.context.params={applicationKey,version,path:path.join('/')};return exports.default(event)}));
 const server=createServer(h3.toNodeListener(app));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})});
 const get=(path,headers={},method='GET')=>new Promise((resolve,reject)=>{request({host:'127.0.0.1',port:server.address().port,path:'/application-assets/fixture/1.0.0/admin/'+path,headers,method},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}))}).on('error',reject).end()});
 const br=await get('_nuxt/entry.js',{'accept-encoding':'br, gzip'});assert.equal(br.status,200);assert.equal(br.headers['content-encoding'],'br');assert.deepEqual(brotliDecompressSync(br.body),source);assert.ok(br.body.length<source.length/2);assert.match(br.headers['content-type'],/javascript/);assert.match(br.headers.vary,/accept-encoding/i);assert.match(br.headers['cache-control'],/immutable/);
 const gzip=await get('_nuxt/entry.js',{'accept-encoding':'gzip'});assert.equal(gzip.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(gzip.body),source);
 const head=await get('_nuxt/entry.js',{'accept-encoding':'br'},'HEAD');assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),br.body.length);
 const fresh=await get('_nuxt/entry.js',{'accept-encoding':'br','if-none-match':br.headers.etag});assert.equal(fresh.status,304);assert.equal(fresh.body.length,0);
 for(const encoding of ['', 'br;q=0, gzip;q=0']){const identity=await get('_nuxt/entry.js',{'accept-encoding':encoding});assert.equal(identity.headers['content-encoding'],undefined);assert.deepEqual(identity.body,source)}
 const legacy=await get('legacy.css',{'accept-encoding':'br, gzip'});assert.equal(legacy.status,200);assert.equal(legacy.headers['content-encoding'],undefined);assert.equal(legacy.body.toString(),'body{color:blue}');
 for(const path of ['missing.js','_nuxt/entry.js.br','static/runtime.json','h5-routes.json','../../private.js']){const missing=await get(path);assert.equal(missing.status,404,path);assert.equal(missing.headers['cache-control'],undefined,path)}
});
