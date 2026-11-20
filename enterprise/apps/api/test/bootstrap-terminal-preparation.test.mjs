import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/native-release.mjs';
import {seedTerminalTransitionHistory} from './fixtures/terminal-transition-history.mjs';

test('bootstrap derivation rejects a changed original before creating any candidate',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-terminal-pins-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'changed.zip'),output=join(root,'candidate');await writeFile(source,'not the pinned bootstrap');
 const helper=fileURLToPath(new URL('../../../scripts/bootstrap-terminal-archive.py',import.meta.url));
 const result=spawnSync(process.platform==='win32'?'python':'python3',[helper,'derive',source,join(root,'unread-check.mjs'),output],{encoding:'utf8',windowsHide:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,/PINNED_ARCHIVE_CHANGED/);await assert.rejects(access(output),/ENOENT/);
});

test('terminal history evidence distinguishes untouched transition files from later appended tasks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-terminal-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(root),key=f.product.appKey,history=seedTerminalTransitionHistory(f.state,[key]);
 history.assertFilesUnchanged();history.assertPreserved();assert.equal(history.report.records,4);
 const store=f.state.component(key),records=store.read('tasks.json');
 store.write('tasks.json',[...records,{id:'later-task-00000001',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'succeeded',step:'COMPLETE'}]);
 assert.throws(()=>history.assertFilesUnchanged());history.assertPreserved();
 records[0].code='CHANGED_HISTORY';store.write('tasks.json',records);assert.throws(()=>history.assertPreserved());
});
