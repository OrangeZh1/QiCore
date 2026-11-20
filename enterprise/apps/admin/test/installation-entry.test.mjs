import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import ts from 'typescript';

test('installation redirects before application routing and preserves installed requests and installer endpoints',async()=>{
 const directory=new URL('../server/middleware/',import.meta.url),files=(await readdir(directory)).filter(name=>name.endsWith('.ts')).sort();
 assert.equal(files[0],'00-installation.ts','installation must precede H5 and tenant application handlers');
 const code=ts.transpileModule(await readFile(new URL(files[0],directory),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,exports={};
 let installationMode=true;
 new Function('exports','defineEventHandler','useRuntimeConfig','sendRedirect','setHeader','createError',code)(exports,fn=>fn,()=>({public:{installationMode}}),(_event,location,status)=>({location,status}),(event,key,value)=>event.headers[key]=value,info=>Object.assign(Error(info.statusMessage),info));
 for(const method of ['GET','HEAD'])for(const path of ['/','/?from=bookmark','/profile','/admin/login','/admin/orders']){
  const event={method,path,headers:{}};
  assert.deepEqual(exports.default(event),{location:'/install',status:302});
  assert.equal(event.headers['cache-control'],'no-store, private');
 }
 for(const path of ['/install','/install/','/install?step=1','/health','/api/v1/install/state','/_nuxt/entry.js','/brand/qicore.png','/.well-known/qilicense-challenge','/__nuxt_error'])assert.equal(exports.default({method:'GET',path,headers:{}}),undefined);
 assert.equal(exports.default({method:'POST',path:'/api/v1/install/session',headers:{}}),undefined);
 for(const state of [true,false]){
   installationMode=state;
   for(const method of ['GET','HEAD','POST'])for(const path of ['/tenant','/tenant/login','/tenant/orders','/Tenant/orders','/tenant%2Forders']){
     assert.throws(()=>exports.default({method,path,headers:{}}),error=>error.statusCode===404,'retired addresses must not enter either UI or redirect to installation');
   }
 }
 installationMode=false;
 for(const path of ['/','/profile','/admin/login','/admin/orders'])assert.equal(exports.default({method:'GET',path,headers:{}}),undefined);
});
