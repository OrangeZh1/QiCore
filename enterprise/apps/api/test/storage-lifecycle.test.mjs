import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {PlatformStorage} from '../src/storage/service.mjs';
import {objectPath} from '../src/storage/local.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';
import {applicationCatalog} from '../src/applications/registry.mjs';

test('an empty framework sweeps only declared expiry files; app ownership survives unload and protects other applications',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db}=await isolatedDatabase(t),root=await mkdtemp(join(tmpdir(),'qicore-storage-lifecycle-'));
 t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'qicore-storage-lifecycle-'));await rm(root,{recursive:true,force:true})});
 assert.deepEqual(applicationCatalog(),[]);assert.ok(!(await db.$queryRawUnsafe('SHOW TABLES')).some(row=>Object.values(row).includes('Work')));
 const storage=new PlatformStorage(db,{root:join(root,'files'),keyRoot:join(root,'keys')});await storage.init();
 const scope={tenantId:'same-tenant',userId:'same-user'},first=storage.forApplication('first-app'),second=storage.forApplication('second-app');
 const revision=await first.uploadTarget(scope),future=new Date(Date.now()+60000),past=new Date(Date.now()-60000);
 const put=(client,value,retention)=>client.put(revision,scope,Buffer.from(value),'png','image/png',future,{retention});
 const protectedRefs=[];for(let n=0;n<55;n++)protectedRefs.push(await put(first,'protected-'+n,'application'));
 const expired=await put(first,'expired','expiry'),other=await put(second,'other-expired','expiry'),live=await put(first,'live','expiry');
 const onDisk=ref=>objectPath(storage.root,storage.reference(ref).objectKey);
 assert.notEqual(storage.reference(expired).objectKey.split('/')[3],storage.reference(other).objectKey.split('/')[3]);
 await assert.rejects(second.get(live,scope),/STORAGE_SCOPE_INVALID/);
 await assert.rejects(first.get(live,{...scope,userId:'other-user'}),/STORAGE_SCOPE_INVALID/);
 await assert.rejects(first.get(live,{...scope,tenantId:'other-tenant'}),/STORAGE_SCOPE_INVALID/);
 assert.throws(()=>first.get(live,{...scope,applicationKey:'second-app'}),/STORAGE_SCOPE_INVALID/);
 await assert.rejects(storage.get(live,scope),/STORAGE_SCOPE_INVALID/);
 await assert.rejects(first.get(join(storage.root,'old.png'),scope),/STORAGE_REFERENCE_INVALID/);
 await db.storageObject.updateMany({where:{objectKey:{not:storage.reference(live).objectKey}},data:{expiresAt:past}});
 await first.sweep();
 await assert.rejects(readFile(onDisk(expired)),{code:'ENOENT'});assert.equal((await readFile(onDisk(other))).toString(),'other-expired');
 for(const ref of protectedRefs)assert.ok(await readFile(onDisk(ref)));
 // A fresh host with no application runtime still honors persisted ownership.
 const restarted=new PlatformStorage(db,{root:storage.root,keyRoot:join(root,'keys')});await restarted.sweep();
 await assert.rejects(readFile(onDisk(other)),{code:'ENOENT'});assert.equal((await first.get(live,scope)).toString(),'live');
 assert.equal(await db.storageObject.count({where:{retention:'application',deletedAt:null}}),55);
 const originalRemove=storage.providers.remove.bind(storage.providers);let attempts=0;
 storage.providers.remove=async(...args)=>{attempts++;if(attempts===1)throw Error('fixture storage unavailable');return originalRemove(...args)};
 await assert.rejects(first.remove(protectedRefs[0],scope),/fixture storage unavailable/);
 await storage.sweep();assert.equal(attempts,1,'future retries must not run early');
 await db.storageObject.updateMany({where:storage.reference(protectedRefs[0]),data:{deleteRetryAt:past}});
 await storage.sweep();assert.equal(attempts,2);await storage.sweep();assert.equal(attempts,2,'completed deletion is idempotent');
 await first.remove(protectedRefs[1],scope);assert.equal(await db.storageObject.count({where:{retention:'application',deletedAt:null}}),53);
});

test('additive ownership migration preserves legacy objects; only exact references with unambiguous bindings can be claimed',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db,prisma}=await isolatedDatabase(t,{migrate:false});
 for(const name of ['001_framework_initial','002_mini_ad_settings']){prisma(['db','execute','--file','prisma/migrations/'+name+'/migration.sql']);prisma(['migrate','resolve','--applied',name])}
 const id=randomUUID(),revisionId=randomUUID(),objectKey='tenants/legacy/private.png',expiresAt=new Date(Date.now()-60000);
 await db.$executeRawUnsafe('INSERT INTO StorageObject(id,revisionId,objectKey,tenantId,userId,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?)',id,revisionId,objectKey,'legacy-tenant','same-user',expiresAt,new Date());
 const before=(await db.$queryRawUnsafe('SELECT * FROM StorageObject WHERE id=?',id))[0];prisma(['migrate','deploy']);
 const after=await db.storageObject.findUnique({where:{id}});for(const [key,value] of Object.entries(before))assert.deepEqual(after[key],value);
 assert.equal(after.applicationKey,null);assert.equal(after.retention,'legacy');
 const storage=new PlatformStorage(db,{root:tmpdir(),keyRoot:tmpdir()}),ref='storage:'+revisionId+':'+objectKey,scope={tenantId:'legacy-tenant',userId:'same-user'};
 await storage.sweep();assert.equal((await db.storageObject.findUnique({where:{id}})).deletedAt,null);
 const first=storage.forApplication('first-app'),second=storage.forApplication('second-app');
 await assert.rejects(first.claimLegacy(ref,scope,'application'),/STORAGE_LEGACY_OWNER_AMBIGUOUS/);
 await db.tenant.create({data:{id:scope.tenantId,name:'legacy fixture',applications:{create:{applicationKey:'first-app',config:{}}}}});
 await assert.rejects(db.tenantApplication.create({data:{tenantId:scope.tenantId,applicationKey:'second-app',config:{}}}),{code:'P2002'});
 await assert.rejects(second.claimLegacy(ref,scope,'application'),/STORAGE_LEGACY_OWNER_AMBIGUOUS/);
 assert.equal(await first.claimLegacy(ref,scope,'application'),true);assert.equal(await first.claimLegacy(ref,scope,'expiry'),false,'replay must not downgrade application retention');
 await assert.rejects(second.claimLegacy(ref,scope,'application'),/STORAGE_SCOPE_INVALID/);
 prisma(['migrate','deploy']);const claimed=await db.storageObject.findUnique({where:{id}});assert.equal(claimed.applicationKey,'first-app');assert.equal(claimed.retention,'application');assert.equal(claimed.deletedAt,null);
});
