import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,utimes,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'qicore-secret-check-')),calls=[];
 const previous=process.env.STORAGE_ENCRYPTION_KEY;delete process.env.STORAGE_ENCRYPTION_KEY;
 let failAcl=false;
 const mock=t.mock.method(childProcess,'spawnSync',(command,args)=>{calls.push({command,args});return command==='whoami'?{status:0,stdout:'"fixture","S-1-5-21-123"'}:{status:failAcl?1:0}});syncBuiltinESMExports();
 // Exercise the Windows branch on either OS, with real files and mocked OS commands.
 const source=(await readFile(new URL('../src/storage/secrets.mjs',import.meta.url),'utf8')).replace("process.platform==='win32'",'true');
 const {StorageSecrets}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 t.after(async()=>{mock.mock.restore();syncBuiltinESMExports();if(previous===undefined)delete process.env.STORAGE_ENCRYPTION_KEY;else process.env.STORAGE_ENCRYPTION_KEY=previous;if(!resolve(root).startsWith(resolve(tmpdir())+sep+'qicore-secret-check-'))throw Error('Invalid fixture cleanup');await rm(root,{recursive:true,force:true})});
 return{root,file:join(root,'storage.key'),secrets:new StorageSecrets(root),calls,fail:value=>{failAcl=value}};
}

test('unchanged keys do not spawn permission processes again; changed keys are resecured',async t=>{
 const f=await fixture(t),first=f.secrets.encrypt('scope',{value:'private'});assert.equal(f.calls.length,2);
 for(let n=0;n<8;n++){assert.deepEqual(f.secrets.decrypt('scope',first),{value:'private'});f.secrets.encrypt('scope',{n})}assert.equal(f.calls.length,2);
 const key=Buffer.alloc(32,7);await writeFile(f.file,key);await utimes(f.file,new Date(),new Date(Date.now()+2000));
 assert.deepEqual(f.secrets.key(false),key);assert.equal(f.calls.length,4);f.secrets.key(false);assert.equal(f.calls.length,4);
 assert.throws(()=>f.secrets.decrypt('scope',first),/STORAGE_CREDENTIALS_UNAVAILABLE/);
});

test('removed, corrupt and linked keys fail without silently regenerating an initialized key',async t=>{
 const f=await fixture(t),cipher=f.secrets.encrypt('tenant:app:user',{value:'private'});
 assert.throws(()=>f.secrets.decrypt('different-scope',cipher),/STORAGE_CREDENTIALS_UNAVAILABLE/);
 await writeFile(f.file,Buffer.alloc(3));assert.throws(()=>f.secrets.key(false),/STORAGE_KEY_INVALID/);
 await rm(f.file);assert.throws(()=>f.secrets.encrypt('scope',{}),/STORAGE_KEY_MISSING/);
 const target=join(f.root,'target');await mkdir(target);await symlink(target,f.file,process.platform==='win32'?'junction':'dir');assert.throws(()=>f.secrets.key(false),/STORAGE_KEY_PATH_INVALID/);
});

test('failed ACL initialization is retried, and environment keys keep validation',async t=>{
 const f=await fixture(t);f.fail(true);assert.throws(()=>f.secrets.key(),/STORAGE_KEY_ACL_FAILED/);
 f.fail(false);assert.equal(f.secrets.key().length,32);assert.equal(f.calls.length,4);f.secrets.key();assert.equal(f.calls.length,4);
 process.env.STORAGE_ENCRYPTION_KEY=Buffer.alloc(32,8).toString('base64');assert.deepEqual(f.secrets.key(),Buffer.alloc(32,8));assert.equal(f.calls.length,4);
 process.env.STORAGE_ENCRYPTION_KEY='invalid';assert.throws(()=>f.secrets.key(),/STORAGE_KEY_INVALID/);
});
