import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {initialInstallInputSchema} from '../dist/lifecycle/native-installation.js';
import {Installation} from '../dist/lifecycle/installation.js';
import {StateStore} from '../dist/license/store.js';
import {passwordHash,passwordMatches} from '../dist/core/admin-auth.mjs';

test('all administrator passwords accept six characters and enforce the same boundaries',async()=>{
 const input={requestId:randomUUID(),archive:'/tmp/release.zip',release:{},administrator:{username:'admin',password:'123456'},redisUrl:'redis://127.0.0.1:6379',adminOrigin:'https://example.com',acceptTerms:true};
 assert.equal(initialInstallInputSchema.safeParse(input).success,true);
 assert.equal(initialInstallInputSchema.safeParse({...input,acceptTerms:false}).success,false);
 assert.equal(initialInstallInputSchema.safeParse({...input,administrator:{...input.administrator,password:'12345'}}).success,false);
 const digest=await passwordHash('123456');assert.ok(await passwordMatches('123456',digest));assert.equal(await passwordMatches('123457',digest),false);
 for(const password of ['12345','a'.repeat(129)])await assert.rejects(passwordHash(password),{code:'PASSWORD_INVALID'});
 for(const password of ['abc123','a'.repeat(128)])assert.ok(await passwordMatches(password,await passwordHash(password)));
});

test('failed and interrupted initial health never create a successful installation receipt or rerun migrations',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-install-journal-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});
 const store=new StateStore(root),calls=[];
 const effects=Object.fromEntries(['preflight','authorize','database','migrate','configure','start','health','finalize'].map(name=>[name,async()=>{calls.push(name);if(name==='health')throw Error('HEALTH_CHECK_FAILED')}]));
 const engine=new Installation(store,effects),id=randomUUID(),context={productId:'frm_fixture',domain:'127.0.0.1',instanceId:'a'.repeat(64),target:{version:'0.1.0',image:'native/frm_fixture@sha256:'+'b'.repeat(64)},requestHash:'c'.repeat(64),environment:{runtime:'nodejs',runtimeVersion:'24.0.0',deployment:'native',platform:'linux/amd64',stage:'test'}};
 assert.equal((await engine.execute(id,context)).status,'recovery_required');assert.equal(store.read('active.json'),null);assert.equal(store.read('installed-receipt.json'),null);
 assert.equal((await engine.execute(id,context)).status,'recovery_required');assert.equal(calls.filter(c=>c==='migrate').length,1);
 await assert.rejects(engine.execute(id,{...context,requestHash:'d'.repeat(64)}),/INSTALL_TARGET_CHANGED/);await assert.rejects(engine.execute(randomUUID(),context),/INSTALLATION_ALREADY_EXISTS/);
 const journal=store.read('installation.json');store.write('installation.json',{...journal,status:'running',code:undefined});engine.recoverInterrupted();assert.equal(store.read('installation.json').code,'INSTALLATION_INTERRUPTED');assert.equal(store.read('active.json'),null);
});

test('operator health recovery preserves initialized data and records success only after real health and closeout',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-install-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=new StateStore(root),calls=[],id=randomUUID(),context={productId:'frm_fixture',domain:'127.0.0.1',instanceId:'a'.repeat(64),target:{version:'0.1.0',image:'native/frm_fixture@sha256:'+'b'.repeat(64)},environment:{runtime:'nodejs',runtimeVersion:'24.0.0',deployment:'native',platform:'linux/amd64',stage:'test'}};
 let healthy=false,closeout=true;
 const effects=Object.fromEntries(['preflight','authorize','database','migrate','configure','start','health','finalize'].map(name=>[name,async()=>{calls.push(name);if(name==='health'&&!healthy)throw Error('RUNTIME_EXITED');if(name==='finalize'&&!closeout)throw Error('CLOSEOUT_FAILED')}]));
 const engine=new Installation(store,effects);
 await engine.execute(id,context);calls.length=0;
 await assert.rejects(engine.resumeHealth(randomUUID()),/INSTALL_HEALTH_RECOVERY_NOT_ALLOWED/);assert.deepEqual(calls,[]);
 assert.equal((await engine.resumeHealth(id)).status,'recovery_required');assert.equal(store.read('active.json'),null);assert.equal(store.read('installed-receipt.json'),null);
 healthy=true;closeout=false;calls.length=0;
 assert.equal((await engine.resumeHealth(id)).status,'recovery_required');assert.equal(store.read('active.json').health,'passed');
 closeout=true;calls.length=0;
 assert.equal((await engine.resumeHealth(id)).status,'succeeded');assert.deepEqual(calls,['preflight','authorize','start','health','finalize']);
 assert.equal(store.read('installed-receipt.json').attemptId,id);assert.equal(store.read('installation.json').code,undefined);
 const events=store.read('installation-outbox.json');assert.equal(events.at(-1).payload.status,'SUCCEEDED');assert.ok(events.some(event=>event.payload.status==='RECOVERY_REQUIRED'));
 await assert.rejects(engine.resumeHealth(id),/INSTALL_HEALTH_RECOVERY_NOT_ALLOWED/);
 for(const phase of ['database','migration','configuration']){store.write('installation.json',{id,context,status:'recovery_required',phase,startedAt:new Date().toISOString()});await assert.rejects(engine.resumeHealth(id),/INSTALL_HEALTH_RECOVERY_NOT_ALLOWED/)}
 store.write('installation.json',{id,context,status:'recovery_required',phase:'health',startedAt:new Date().toISOString()});store.write('active.json',{...store.read('active.json'),taskId:randomUUID()});
 await assert.rejects(engine.resumeHealth(id),/INSTALL_RECEIPT_MISMATCH/);
});
