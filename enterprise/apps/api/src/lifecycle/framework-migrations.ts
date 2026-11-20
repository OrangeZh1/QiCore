import {chmodSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import type {NativeArchiveManifest} from '../license/native-release.js';

type Files=NativeArchiveManifest['files'];
type Migrations=NativeArchiveManifest['migrations'];
const schema='apps/api/prisma/schema.prisma';
const same=(a:Files[number],b:Files[number]|undefined)=>!!b&&a.size===b.size&&a.sha256===b.sha256;

// Framework SQL is bound twice: to the public migration list and to the Prisma
// tree actually executed by the signed package's bundled CLI.
export function frameworkMigrationSources(before:Files,after:Files,migrations:Migrations){
 const original=before.filter(file=>file.path.startsWith('apps/api/prisma/'));
 if(!original.some(file=>file.path===schema)||!after.some(file=>file.path===schema))throw Error('FRAMEWORK_MIGRATION_TREE_REQUIRED');
 for(const file of original)if(file.path!==schema&&!same(file,after.find(next=>next.path===file.path)))throw Error('FRAMEWORK_MIGRATION_HISTORY_CHANGED');
 const additions=after.filter(file=>file.path.startsWith('apps/api/prisma/')&&file.path!==schema&&!original.some(old=>old.path===file.path));
 if(!additions.length&&!same(original.find(file=>file.path===schema)!,after.find(file=>file.path===schema)))throw Error('FRAMEWORK_MIGRATION_PLAN_REQUIRED');
 const sources=migrations.map(m=>{
  const bound=after.filter(file=>/^apps\/api\/prisma\/migrations\/[A-Za-z0-9_-]+\/migration\.sql$/.test(file.path)&&file.sha256===m.sha256&&same({...file,path:m.path},after.find(entry=>entry.path===m.path)));
  if(bound.length!==1)throw Error('FRAMEWORK_MIGRATION_NOT_BOUND');
  const file=bound[0]!,name=file.path.split('/').at(-2)!;
  return {name,id:m.id,sha256:file.sha256,path:file.path};
 });
 if(new Set(sources.map(source=>source.path)).size!==sources.length||additions.some(file=>!sources.some(source=>source.path===file.path)))throw Error('FRAMEWORK_MIGRATION_NOT_BOUND');
 return sources;
}

export function deployFrameworkMigrations(target:string,databaseUrl:string){
 const engine=join(target,'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x');chmodSync(engine,0o755);
 const cache=mkdtempSync(join(tmpdir(),'qicore-update-migration-'));
 try{
  const result=spawnSync(process.execPath,[join(target,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',join(target,schema)],{cwd:target,env:{...process.env,DATABASE_URL:databaseUrl,PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_QUERY_ENGINE_LIBRARY:join(target,'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node'),XDG_CACHE_HOME:cache,CACHE_DIR:cache,JITI_FS_CACHE:'0',CHECKPOINT_DISABLE:'1'},timeout:120000,stdio:'pipe'});
  if(result.status!==0)throw Error('FRAMEWORK_MIGRATION_FAILED');
 }finally{if(!resolve(cache).startsWith(resolve(tmpdir())+'/qicore-update-migration-'))throw Error('MIGRATION_CACHE_PATH_INVALID');rmSync(cache,{recursive:true,force:true})}
}
