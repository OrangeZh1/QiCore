import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,openSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {migrationFingerprint} from '../dist/backups/archive.mjs';
import {Restoration} from '../dist/backups/restoration.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';

const prisma=[{migration_name:'001_framework_initial',checksum:'a'.repeat(64),finished_at:new Date(),rolled_back_at:null}];
const native=(id='first',sha256='b'.repeat(64),finished=true)=>({package_key:'app_fixture',migration_id:id,sha256,finished});
function database(rows,framework=prisma){return {$queryRawUnsafe:async sql=>{
 if(sql.includes('FROM _prisma_migrations'))return framework;
 if(sql.includes('information_schema.TABLES'))return rows===null?[]:[{TABLE_NAME:'_qicore_migrations'}];
 assert.match(sql,/FROM _qicore_migrations ORDER BY package_key,migration_id/);return rows;
}}}

test('backup fingerprints cover native migrations, reject unfinished history, and retain empty-framework compatibility',async()=>{
 const legacy=createHash('sha256').update(JSON.stringify(prisma.map(r=>[r.migration_name,r.checksum]))).digest('hex');
 assert.equal(await migrationFingerprint(database(null)),legacy);
 assert.equal(await migrationFingerprint(database([])),legacy);
 const first=await migrationFingerprint(database([native()]));assert.notEqual(first,legacy);
 assert.notEqual(await migrationFingerprint(database([native(),native('second')])),first);
 assert.notEqual(await migrationFingerprint(database([native('first','c'.repeat(64))])),first);
 assert.notEqual(await migrationFingerprint(database([{...native(),package_key:'app_other'}])),first);
 await assert.rejects(migrationFingerprint(database([native('second','c'.repeat(64),false)])),/BACKUP_MIGRATIONS_DIRTY/);
 await assert.rejects(migrationFingerprint(database([],[{...prisma[0],finished_at:null}])),/BACKUP_MIGRATIONS_DIRTY/);
});

test('restore preflight refuses old native schema and legacy hashes before issuing a restore plan',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qicore-backup-check-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})});
 const file=join(root,'verified-fixture');writeFileSync(file,'fixture');
 let savedHash=await migrationFingerprint(database([native()]));
 const current=database([native(),native('second')]),backups={db:current,allow(){},readLock:()=>()=>{},version:()=> '0.1.0',archive:{
  key:()=>Buffer.alloc(32),read:()=>({status:'completed'}),openVerified:async()=>({fd:openSync(file,'r'),sha256:'d'.repeat(64),header:{database:'fixture',version:'0.1.0',migrationHash:savedHash}})
 }};
 const restore=new Restoration(backups);restore.config=async()=>({database:'fixture'});
 const preview=()=>restore.preview({id:'admin'},'backup-fixture',{requestId:randomUUID()});
 await assert.rejects(preview(),{code:'BACKUP_RESTORE_INCOMPATIBLE'});
 savedHash=await migrationFingerprint(database(null));await assert.rejects(preview(),{code:'BACKUP_RESTORE_INCOMPATIBLE'});
 savedHash=await migrationFingerprint(current);assert.ok((await preview()).token);
});

test('MySQL native migration history participates in backup compatibility and unfinished migrations block backup',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t),initial=await migrationFingerprint(db);
 await db.$executeRawUnsafe('CREATE TABLE _qicore_migrations (package_key VARCHAR(64) NOT NULL, migration_id VARCHAR(128) NOT NULL, sha256 CHAR(64) NOT NULL, finished BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(package_key,migration_id))');
 assert.equal(await migrationFingerprint(db),initial);
 await db.$executeRawUnsafe('INSERT INTO _qicore_migrations VALUES(?,?,?,TRUE)','app_fixture','first','a'.repeat(64));
 const first=await migrationFingerprint(db);assert.notEqual(first,initial);
 await db.$executeRawUnsafe('INSERT INTO _qicore_migrations VALUES(?,?,?,FALSE)','app_fixture','second','b'.repeat(64));
 await assert.rejects(migrationFingerprint(db),/BACKUP_MIGRATIONS_DIRTY/);
 await db.$executeRawUnsafe('UPDATE _qicore_migrations SET finished=TRUE WHERE migration_id=?','second');
 assert.notEqual(await migrationFingerprint(db),first);
});
