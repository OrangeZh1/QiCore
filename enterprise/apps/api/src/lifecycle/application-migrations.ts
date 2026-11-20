import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';
import type {NativeRelease} from '../license/native-updates.js';
import {assertSafeMigrationSql} from './migration-safety.js';
import {sha256} from '../license/native-updates.js';

export async function applicationMigrations(url:string,release:NativeRelease,path:string,execute=false){
 const scripts=release.migrations.map(m=>{const sql=readFileSync(join(path,m.path),'utf8');if(sha256(sql)!==m.sha256)throw Error('MIGRATION_DIGEST_MISMATCH');return {...m,statements:assertSafeMigrationSql(sql)}}).sort((a,b)=>a.order-b.order);
 const db=new PrismaClient({datasources:{db:{url}}});
 try{
  const tables=await db.$queryRawUnsafe<any[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='_qicore_migrations'");
  const rows=tables.length?await db.$queryRawUnsafe<any[]>('SELECT migration_id,sha256,finished FROM _qicore_migrations WHERE package_key=?',release.manifest.packageKey):[];
  if(rows.some(row=>!row.finished||!scripts.some(m=>m.id===row.migration_id&&m.sha256===row.sha256)))throw Error('MIGRATION_HISTORY_MISMATCH');
  const pending=scripts.filter(m=>!rows.some(row=>row.migration_id===m.id));if(!execute||!pending.length)return;
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS _qicore_migrations (package_key VARCHAR(64) NOT NULL, migration_id VARCHAR(128) NOT NULL, sha256 CHAR(64) NOT NULL, finished BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(package_key,migration_id))');
  for(const m of pending){
   await db.$executeRawUnsafe('INSERT INTO _qicore_migrations(package_key,migration_id,sha256,finished) VALUES(?,?,?,FALSE)',release.manifest.packageKey,m.id,m.sha256);
   for(const sql of m.statements)await db.$executeRawUnsafe(sql);
   await db.$executeRawUnsafe('UPDATE _qicore_migrations SET finished=TRUE WHERE package_key=? AND migration_id=?',release.manifest.packageKey,m.id);
  }
 }finally{await db.$disconnect()}
}
