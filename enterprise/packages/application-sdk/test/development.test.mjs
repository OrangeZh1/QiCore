import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {developmentCommand} from '../development.mjs';
import {installSdk} from '../install.mjs';
import {applicationEntry} from '../package-tools.mjs';
import {pathToFileURL} from 'node:url';

test('application SDK selects an explicit host, retaining arbitrary application and state locations',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-sdk-host-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const host=join(root,'official host'),app=join(root,'business'),state=join(root,'state');await mkdir(join(host,'scripts/development'),{recursive:true});await mkdir(app);
 await writeFile(join(host,'package.json'),JSON.stringify({name:'qicore',version:'0.1.7'}));
 for(const name of ['run','stop'])await writeFile(join(host,'scripts/development',name+'.mjs'),'');
 await assert.rejects(developmentCommand(['dev'],{cwd:app,env:{}}),/HOST_REQUIRED/);
 const start=await developmentCommand(['dev','--host',host,'--state',state],{cwd:app,env:{}});
 assert.equal(start.cwd,app);assert.deepEqual(start.args.slice(1),['--app',app,'--sdk-mode','installed','--state',state]);
 const stop=await developmentCommand(['dev:stop','--state',state],{cwd:app,env:{QICORE_DEV_HOST:host}});assert.equal(stop.args[1],state);
 await writeFile(join(host,'package.json'),'{}');await assert.rejects(developmentCommand(['dev','--host',host],{cwd:app,env:{}}),/HOST_INVALID/);
});

test('offline SDK installation verifies both archives and versions before changing the application',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-sdk-install-'));t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));return rm(root,{recursive:true,force:true})});
 const kit=join(root,'kit'),app=join(root,'app');await mkdir(kit);await mkdir(app);
 const packages=[];for(const name of ['@qicore/application-sdk','@orangezh1/qisvc-console-ui']){
  const file=name.replace(/^@/,'').replace('/','-')+'-1.0.0.tgz',bytes=Buffer.from(name);await writeFile(join(kit,file),bytes);packages.push({name,version:'1.0.0',file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 await writeFile(join(kit,'sdk-kit.json'),JSON.stringify({format:'qicore-sdk-kit-v1',packages}));
 await writeFile(join(app,'package.json'),JSON.stringify({qicore:{sdk:Object.fromEntries(packages.map(item=>[item.name,item.version]))}}));
 await writeFile(join(kit,packages[1].file),'corrupt');await assert.rejects(installSdk(kit,app),/INTEGRITY_FAILED/);
 await assert.rejects(readFile(join(app,'.local/qicore-sdk',packages[0].file)),{code:'ENOENT'});
 await writeFile(join(kit,packages[1].file),packages[1].name);assert.equal((await installSdk(kit,app)).packages.length,2);
});

test('application bundles borrow the public host facade and retain the same shared service identities',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-sdk-entry-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'entry.mjs');await writeFile(file,applicationEntry("module.exports={Fault:require('@qicore/application-sdk/server').Fault};"));
 const {createApplication}=await import(pathToFileURL(file));class Fault extends Error{}
 assert.equal(createApplication({version:1,api:{Fault}}).Fault,Fault);
 assert.equal(createApplication({version:1,modules:{'core/errors.mjs':{Fault}}}).Fault,Fault,'existing v1 hosts retain their exact service instances');
 assert.throws(()=>createApplication({version:2}),/SDK_UNSUPPORTED/);
});

test('application-owned production dependencies need no host allowlist and cannot silently resolve from a parent project',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-sdk-dependencies-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const app=join(root,'application');await mkdir(join(app,'node_modules/business-format'),{recursive:true});
 await writeFile(join(app,'node_modules/business-format/package.json'),JSON.stringify({name:'business-format',main:'index.cjs'}));
 await writeFile(join(app,'node_modules/business-format/index.cjs'),'module.exports={owned:true}');
 const entry=join(app,'entry.mjs');await writeFile(entry,applicationEntry("module.exports={value:require('business-format'),builtin:typeof require('path').join};"));
 const module=await import(pathToFileURL(entry)),value=module.createApplication({version:1,modules:{}});assert.equal(value.value.owned,true);assert.equal(value.builtin,'function');
 await mkdir(join(root,'node_modules/parent-only'),{recursive:true});await writeFile(join(root,'node_modules/parent-only/package.json'),JSON.stringify({main:'index.cjs'}));await writeFile(join(root,'node_modules/parent-only/index.cjs'),'module.exports=true');
 const outside=join(app,'outside.mjs');await writeFile(outside,applicationEntry("module.exports=require('parent-only');"));
 const foreign=await import(pathToFileURL(outside));assert.throws(()=>foreign.createApplication({version:1,modules:{}}),/APPLICATION_DEPENDENCY_OUTSIDE_PACKAGE/);
});
