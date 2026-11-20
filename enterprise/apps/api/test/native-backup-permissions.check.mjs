import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,chownSync,chmodSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/native-release.mjs';
import {NativeEffects,nativeBackups} from '../dist/lifecycle/native-effects.js';

assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
const uid=Number(process.env.QICORE_TEST_RUNTIME_UID),gid=Number(process.env.QICORE_TEST_RUNTIME_GID);
assert.ok(Number.isSafeInteger(uid)&&uid>0&&Number.isSafeInteger(gid)&&gid>0);

test('root update writer leaves only private runtime-owned backup records, locks and references readable by the non-root API',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-backup-owner-'));chmodSync(root,0o755);
 t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/qicore-backup-owner-'));rmSync(root,{recursive:true,force:true})});
 const f=fixture(root);Object.assign(f.state.config,{runtimeUid:uid,runtimeGid:gid});
 for(const path of [f.state.config.backupRoot,f.state.config.backupKeyRoot,f.state.config.dataRoot]){mkdirSync(path,{mode:0o700});chownSync(path,uid,gid)}
 const key=join(f.state.config.backupKeyRoot,'backup.key');writeFileSync(key,Buffer.alloc(32,1),{mode:0o600});chownSync(key,uid,gid);
 const taskId=randomUUID(),backupId='backup-'+taskId,b=nativeBackups(f.state);b.init();
 const effects=new NativeEffects(f.state,{},f.client,'frm_fixture',taskId);
 await effects.maintenance(true);b.trackChild('operation.lock',null);
 b.save({id:backupId,schema:'zjz-backup-v2',source:'update',status:'completed',actorId:'system-updater'});
 const archive=b.file(backupId,'.zbackup');writeFileSync(archive,'ownership fixture',{mode:0o600});b.protect(archive);
 for(const path of [archive,b.file(backupId,'.json'),b.store.path('operation.lock')]){const stat=lstatSync(path);assert.equal(stat.uid,uid);assert.equal(stat.gid,gid);assert.equal(stat.mode&0o777,0o600)}
 const readAsRuntime=paths=>{const result=spawnSync(process.execPath,['--input-type=module','-e',"import{readFileSync}from'node:fs';for(const path of JSON.parse(process.argv[1]))readFileSync(path);",JSON.stringify(paths)],{uid,gid,encoding:'utf8'});assert.equal(result.status,0,result.stderr)};
 readAsRuntime([archive,b.file(backupId,'.json'),b.store.path('operation.lock'),key]);
 f.state.component('frm_fixture').write('tasks.json',[{id:taskId,status:'succeeded',backup:{id:backupId}}]);
 f.state.component('frm_fixture').write('active.json',{recoveryReferences:[backupId]});
 await effects.maintenance(false);
 const references=b.store.path('update-references.json');assert.equal(lstatSync(references).uid,uid);assert.equal(lstatSync(references).mode&0o777,0o600);readAsRuntime([references]);
 assert.deepEqual(JSON.parse(readFileSync(references)).ids,[backupId]);assert.equal(b.operation(),null);
});
