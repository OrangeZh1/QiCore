import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fixture} from './fixtures/native-release.mjs';
import {NativeEffects} from '../dist/lifecycle/native-effects.js';

async function setup(t,{currentHistory=false,omitCurrentIndex=false}={}){
 const root=await mkdtemp(join(tmpdir(),'qicore-framework-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const baseline=JSON.parse(await readFile(new URL('../../../config/release-baselines/qicore-0.1.6.json',import.meta.url),'utf8'));
 const payload={'server/main.mjs':'export const ready=true'};
 for(const file of baseline.prismaFiles)payload[file.path]=await readFile(new URL('../../../'+file.path,import.meta.url));
 const targetPayload={...payload};for(const m of baseline.migrations){const source=baseline.prismaFiles.find(file=>file.path.endsWith('/migration.sql')&&file.sha256===m.sha256);targetPayload[m.path]=payload[source.path]}
 const currentPayload=currentHistory?{...targetPayload}:{...payload};if(omitCurrentIndex)delete currentPayload['apps/api/prisma/migrations/007_query_indexes/migration.sql'];
 const f=fixture(root,{frameworkKey:baseline.packageKey}),before=f.release(baseline.packageKey,'0.1.6',currentHistory?'0.1.5':'0.0.0',currentPayload,{migrations:currentHistory?baseline.migrations:[]});
 const from=await f.install(before);
 async function stage(migrations=baseline.migrations){
  const after=f.release(baseline.packageKey,'0.1.7','0.1.6',targetPayload,{migrations}),to=f.state.slot(after.release);
  f.state.component(baseline.packageKey).write('release-'+after.release.artifact.manifestSha256+'.json',after.release);
  const dir=f.state.path(baseline.packageKey,to);await mkdir(dir,{recursive:true});
  for(const [path,bytes] of Object.entries(after.files)){await mkdir(dirname(join(dir,path)),{recursive:true});await writeFile(join(dir,path),bytes)}
  return {from,to};
 }
 const target=await stage(),rows=baseline.migrations.map(m=>({migration_id:m.id,sha256:m.sha256,finished:true})),prisma=new Map();
 for(const m of baseline.migrations){const source=baseline.prismaFiles.find(file=>file.path.endsWith('/migration.sql')&&file.sha256===m.sha256);prisma.set(source.path.split('/').at(-2),[{checksum:m.sha256,finished_at:new Date(),rolled_back_at:null}])}
 const writes=[],database={async $queryRawUnsafe(sql,...args){if(sql.includes('information_schema'))return [{TABLE_NAME:'_qicore_migrations'}];if(sql.includes('FROM _qicore_migrations'))return rows;if(sql.includes('FROM _prisma_migrations'))return prisma.get(args[0])??[];throw Error('UNEXPECTED_QUERY')},async $executeRawUnsafe(sql){writes.push(sql);throw Error('HISTORICAL_SQL_REEXECUTED')},async $disconnect(){}};
 class Probe extends NativeEffects{runtime(){return{platform:'linux',arch:'x64',node:'24.0.0'}}assertGrant(){}database(){return database}}
 const effects=new Probe(f.state,{assertOpen(){}},f.client,baseline.packageKey,'framework-retry-fixture');
 return {effects,target,rows,prisma,writes,stage,baseline};
}

test('Prisma aliases retained after a candidate health rollback can retry without INSERT or DDL',async t=>{
 const e=await setup(t),before=structuredClone(e.rows);
 await e.effects.validateCandidate(e.target);await e.effects.migrate(e.target);
 assert.deepEqual(e.rows,before);assert.deepEqual(e.writes,[]);
 // Migration performs its own fresh proof, rather than trusting a previous compatibility result.
 e.prisma.get('007_query_indexes')[0].finished_at=null;
 await assert.rejects(e.effects.migrate(e.target),/FRAMEWORK_MIGRATION_HISTORY_MISMATCH/);assert.deepEqual(e.writes,[]);
});

test('unknown, unfinished and changed native aliases remain rejected',async t=>{
 const e=await setup(t),original=structuredClone(e.rows);
 for(const change of [{finished:false},{migration_id:'unknown_migration'},{sha256:'0'.repeat(64)}]){
  e.rows.splice(0,e.rows.length,...structuredClone(original));Object.assign(e.rows[0],change);
  await assert.rejects(e.effects.validateCandidate(e.target),/MIGRATION_HISTORY_MISMATCH/);
 }
 assert.deepEqual(e.writes,[]);
});

test('Prisma proof rejects wrong checksums, rolled-back-only rows and unresolved active failures',async t=>{
 const e=await setup(t),original=structuredClone(e.prisma.get('005_site_storage'));
 for(const history of [[{...original[0],checksum:'0'.repeat(64)}],[{...original[0],finished_at:null}],[{...original[0],rolled_back_at:new Date()}],[...original,{...original[0],finished_at:null}]]){
  e.prisma.set('005_site_storage',history);await assert.rejects(e.effects.validateCandidate(e.target),/FRAMEWORK_MIGRATION_HISTORY_MISMATCH/);
 }
 // A resolved earlier failure does not invalidate the single successful active row.
 e.prisma.set('005_site_storage',[...original,{...original[0],finished_at:null,rolled_back_at:new Date()}]);
 await e.effects.validateCandidate(e.target);assert.deepEqual(e.writes,[]);
});

test('a truly new SQL file absent from the current trusted tree cannot explain extra DB history',async t=>{
 const e=await setup(t,{omitCurrentIndex:true});await assert.rejects(e.effects.validateCandidate(e.target),/MIGRATION_HISTORY_MISMATCH/);assert.deepEqual(e.writes,[]);
});

test('declared current history still requires all rows and preserves native migration order',async t=>{
 const e=await setup(t,{currentHistory:true});e.rows.pop();await assert.rejects(e.effects.validateCandidate(e.target),/MIGRATION_HISTORY_MISMATCH/);
 const changed=structuredClone(e.baseline.migrations);[changed[0].order,changed[1].order]=[changed[1].order,changed[0].order];
 await assert.rejects(e.effects.validateCandidate(await e.stage(changed)),/MIGRATION_HISTORY_CHANGED/);
});
