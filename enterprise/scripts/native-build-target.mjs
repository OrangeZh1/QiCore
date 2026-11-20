import {nativeArchiveManifestSchema} from '../apps/api/dist/license/native-release.js';
import {canonicalJson} from '../apps/api/dist/license/contracts.js';
import {frameworkMigrationSources} from '../apps/api/dist/lifecycle/framework-migrations.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertSafeMigrationSql} from '../apps/api/dist/lifecycle/migration-safety.js';

const version=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function nativeBuildBaseline(input){
 if(input?.format==='qicore-update-baseline-v1'){
  if(!/^[a-z][a-z0-9_]{1,63}$/.test(input.packageKey)||!version.test(input.version)||!/^[a-f0-9]{64}$/.test(input.releaseManifestSha256))throw Error('UPDATE_BASELINE_MISMATCH');
  const files=nativeArchiveManifestSchema.shape.files.parse(input.prismaFiles);if(files.some(file=>!file.path.startsWith('apps/api/prisma/')))throw Error('UPDATE_BASELINE_MISMATCH');
  const migrations=nativeArchiveManifestSchema.shape.migrations.parse(input.migrations??[]);
  for(const m of migrations){
   const sources=files.filter(file=>/^apps\/api\/prisma\/migrations\/[A-Za-z0-9_-]+\/migration\.sql$/.test(file.path)&&file.sha256===m.sha256);
   if(sources.length!==1||m.path!=='migrations/'+m.id+'.sql')throw Error('UPDATE_BASELINE_MISMATCH');
   files.push({...sources[0],path:m.path});
  }
  if(new Set(migrations.map(m=>m.id)).size!==migrations.length||new Set(migrations.map(m=>m.order)).size!==migrations.length)throw Error('UPDATE_BASELINE_MISMATCH');
  return {package_key:input.packageKey,package_type:'framework_update',version:input.version,files,migrations};
 }
 return nativeArchiveManifestSchema.parse(input);
}
// A plan contains new migrations only. History comes from the installed release,
// including its exact order and flags, even when this release changes no schema.
export function nativeBuildMigrationSources({fromVersion='0.0.0',baseline,databasePlan}){
 if(fromVersion==='0.0.0'){if(databasePlan)throw Error('UPDATE_DATABASE_PLAN_MISMATCH');return []}
 if(!baseline)throw Error('UPDATE_BASELINE_REQUIRED');const before=nativeBuildBaseline(baseline),history=before.migrations||[];
 const sources=history.map(m=>{const source=before.files.filter(file=>/^apps\/api\/prisma\/migrations\/[A-Za-z0-9_-]+\/migration\.sql$/.test(file.path)&&file.sha256===m.sha256);if(source.length!==1)throw Error('UPDATE_BASELINE_MISMATCH');return {migration:{...m},sourcePath:source[0].path}});
 if(databasePlan&&!Array.isArray(databasePlan.migrations))throw Error('UPDATE_DATABASE_PLAN_MISMATCH');
 const nextOrder=Math.max(-1,...history.map(m=>m.order))+1;
 for(const [index,m] of (databasePlan?.migrations??[]).entries()){
  if(!/^apps\/api\/prisma\/migrations\/[A-Za-z0-9_-]+\/migration\.sql$/.test(m.sourcePath)||!/^\d{14}_[a-z0-9_]+$/.test(m.id)||sources.some(row=>row.migration.id===m.id))throw Error('UPDATE_DATABASE_PLAN_MISMATCH');
  sources.push({sourcePath:m.sourcePath,migration:{id:m.id,order:nextOrder+index,kind:'database',path:'migrations/'+m.id+'.sql',sha256:m.sha256,transactional:false,reversible:true}});
 }
 nativeArchiveManifestSchema.shape.migrations.parse(sources.map(row=>row.migration));return sources;
}
export async function materializeNativeBuildMigrations(tree,options){
 const sources=nativeBuildMigrationSources(options);
 for(const {migration:m,sourcePath} of sources){
  const sql=await readFile(join(tree,sourcePath));if(createHash('sha256').update(sql).digest('hex')!==m.sha256)throw Error('UPDATE_DATABASE_PLAN_MISMATCH');assertSafeMigrationSql(sql.toString('utf8'));
  const path=join(tree,m.path);await mkdir(join(tree,'migrations'),{recursive:true});
  const existing=await readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error});
  if(existing){if(!existing.equals(sql))throw Error('UPDATE_MIGRATION_HISTORY_CHANGED')}else await writeFile(path,sql,{flag:'wx'});
 }
 return sources.map(row=>row.migration);
}
export function nativeBuildOptions(args){
 const [output,...flags]=args;if(!output)throw Error('OUTPUT_DIRECTORY_REQUIRED');
 const options={fromVersion:'0.0.0'},seen=new Set();
 for(let i=0;i<flags.length;i+=2){const key=flags[i],value=flags[i+1];if(!value||!['--from-version','--baseline-manifest','--database-plan'].includes(key))throw Error('BUILD_ARGUMENT_INVALID');if(seen.has(key))throw Error('BUILD_ARGUMENT_DUPLICATED');seen.add(key);options[{'--from-version':'fromVersion','--baseline-manifest':'baselineManifest','--database-plan':'databasePlan'}[key]]=value;}
 if(!version.test(options.fromVersion)||options.fromVersion!=='0.0.0'&&!options.baselineManifest)throw Error('UPDATE_BASELINE_REQUIRED');
 return {output,options};
}
export function assertNativeBuildTarget({packageKey,targetVersion,fromVersion='0.0.0',files,baseline,databasePlan,migrations=[]}){
 if(!version.test(fromVersion)||!version.test(targetVersion))throw Error('BUILD_VERSION_INVALID');
 if(fromVersion==='0.0.0')return;
 const from=fromVersion.split('.').map(Number),to=targetVersion.split('.').map(Number),changed=from.findIndex((value,index)=>value!==to[index]);
 if(changed<0||to[changed]<from[changed])throw Error('UPDATE_VERSION_NOT_NEWER');
 if(!baseline)throw Error('UPDATE_BASELINE_REQUIRED');
 const before=nativeBuildBaseline(baseline);
 if(before.package_key!==packageKey||before.version!==fromVersion||before.package_type!=='framework_update')throw Error('UPDATE_BASELINE_MISMATCH');
 for(const old of before.migrations||[]){
  const next=migrations.find(m=>m.id===old.id),source=before.files.find(file=>file.path===old.path),target=files.find(file=>file.path===old.path);
  if(!next||canonicalJson(next)!==canonicalJson(old)||!source||!target||source.size!==target.size||source.sha256!==target.sha256)throw Error('UPDATE_MIGRATION_HISTORY_CHANGED');
 }
 const added=migrations.filter(m=>!(before.migrations||[]).some(old=>old.id===m.id));
 // This patch builder does not invent a migration plan from a changed Prisma tree.
 // A schema-changing release needs explicit native migrations and separate acceptance.
 const prisma=rows=>rows.filter(row=>row.path.startsWith('apps/api/prisma/')).sort((a,b)=>a.path.localeCompare(b.path));
 const oldSchema=before.files.find(row=>row.path==='apps/api/prisma/schema.prisma'),newSchema=files.find(row=>row.path==='apps/api/prisma/schema.prisma');
 if(!oldSchema)throw Error('UPDATE_DATABASE_PLAN_REQUIRED');
 if(canonicalJson(prisma(before.files))===canonicalJson(prisma(files))&&!added.length&&!databasePlan)return;
 if(databasePlan?.format!=='qicore-database-plan-v1'||databasePlan.packageKey!==packageKey||databasePlan.fromVersion!==fromVersion||databasePlan.version!==targetVersion||databasePlan.beforeSchemaSha256!==oldSchema.sha256||databasePlan.afterSchemaSha256!==newSchema?.sha256)throw Error('UPDATE_DATABASE_PLAN_REQUIRED');
 const sources=frameworkMigrationSources(before.files,files,added);
 if(!Array.isArray(databasePlan.migrations)||sources.length!==databasePlan.migrations.length||sources.some(source=>!databasePlan.migrations.some(m=>m.id===source.id&&m.sourcePath===source.path&&m.sha256===source.sha256)))throw Error('UPDATE_DATABASE_PLAN_MISMATCH');
}
