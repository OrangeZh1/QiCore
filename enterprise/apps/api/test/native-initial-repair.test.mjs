import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,initialRelease} from './fixtures/native-release.mjs';
import {NativeInitialRepairEffects,RepairLicenseStore} from '../dist/lifecycle/native-initial-repair.js';
import {validateTarget} from '../dist/lifecycle/update-engine.js';
import {UpdateEngine} from '../dist/lifecycle/update-engine.js';

test('operator renewal cannot replace runtime-owned receipt or identity files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-repair-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original='{"revision":1}';await writeFile(join(root,'receipt.json'),original);const store=new RepairLicenseStore(root);
 assert.equal(store.read('receipt.json').revision,1);store.write('receipt.json',{revision:2});assert.equal(store.read('receipt.json').revision,2);assert.equal(await readFile(join(root,'receipt.json'),'utf8'),original);
 assert.throws(()=>store.write('identity.json',{privateKey:'forbidden'}),/READ_ONLY/);
});

test('same-version initial repair verifies issuer signature, current digest, zero applications and identical database schema',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-initial-repair-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{initial:true,version:'0.1.0'}),schema={'apps/api/prisma/schema.prisma':'fixture schema'};
 const before=f.release(f.product.appKey,'0.1.0','0.0.0',{...schema,'server/main.mjs':'old runtime'});await f.install(before);
 const candidate=f.release(f.product.appKey,'0.1.0','0.0.0',{...schema,'server/main.mjs':'repaired runtime'}),archive=join(root,'repair.zip');await writeFile(archive,candidate.archive);
 const effects=new NativeInitialRepairEffects(f.state,{},f.client,'initial_repair_fixture',archive,initialRelease(candidate.release),before.release.artifact.manifestSha256);
 effects.runtime=()=>({platform:'linux',arch:'x64',node:'24.0.0'});
 const target=await effects.authorize();assert.throws(()=>validateTarget(target),/INVALID_UPDATE_TARGET/);assert.doesNotThrow(()=>validateTarget(target,true));
 assert.throws(()=>validateTarget({...target,to:{...target.to,version:'0.1.1'}},true),/UPDATE_VERSION_NOT_NEWER/);
 await effects.inventory();await effects.pull(target.to);await effects.compatibility(target);
 const changed=f.release(f.product.appKey,'0.1.0','0.0.0',{'apps/api/prisma/schema.prisma':'different schema','server/main.mjs':'new runtime'});
 await assert.rejects(new NativeInitialRepairEffects(f.state,{},f.client,'initial_repair_other',archive,initialRelease(changed.release),before.release.artifact.manifestSha256).authorize(),/INITIAL_REPAIR_DATABASE_CHANGED/);
 await assert.rejects(new NativeInitialRepairEffects(f.state,{},f.client,'initial_repair_stale',archive,initialRelease(candidate.release),'0'.repeat(64)).authorize(),/INITIAL_REPAIR_SCOPE_INVALID/);
 const invalid=structuredClone(initialRelease(candidate.release));invalid.artifact.signatureEnvelope.signature='a'.repeat(86);assert.throws(()=>new NativeInitialRepairEffects(f.state,{},f.client,'initial_repair_badkey',archive,invalid,before.release.artifact.manifestSha256));
 const installed=f.state.installed.bind(f.state);f.state.installed=()=>[...installed(),{packageKey:'app_existing',version:'0.1.0'}];await assert.rejects(effects.authorize(),/INITIAL_REPAIR_SCOPE_INVALID/);
});

test('failed same-version repair restores the old signed runtime and preserves the recovery mode',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-initial-repair-rollback-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{initial:true,version:'0.1.0'}),schema={'apps/api/prisma/schema.prisma':'fixture schema'};
 const before=f.release(f.product.appKey,'0.1.0','0.0.0',{...schema,'server/main.mjs':'old runtime'});await f.install(before);const active=structuredClone(f.state.active(f.product.appKey));
 const candidate=f.release(f.product.appKey,'0.1.0','0.0.0',{...schema,'server/main.mjs':'broken runtime'}),archive=join(root,'repair.zip');await writeFile(archive,candidate.archive);
 const host={start:async()=>{},stop:async()=>{},health:async(_key,_version,digest)=>{if(digest===candidate.release.artifact.manifestSha256)throw Error('NEW_RUNTIME_NOT_READY')}};
 const id='initial_repair_rollback',effects=new NativeInitialRepairEffects(f.state,host,f.client,id,archive,initialRelease(candidate.release),before.release.artifact.manifestSha256);
 effects.runtime=()=>({platform:'linux',arch:'x64',node:'24.0.0'});effects.maintenance=async()=>{};effects.backup=async()=>({id:'backup-'+id,sha256:'a'.repeat(64),verified:true});
 const result=await new UpdateEngine(f.state.component(f.product.appKey),effects,true).execute(id);
 assert.equal(result.status,'rolled_back',JSON.stringify(result));assert.equal(result.mode,'initial-repair');assert.deepEqual(f.state.active(f.product.appKey).current,active.current);await f.state.verifyCurrent(f.product.appKey);
});
