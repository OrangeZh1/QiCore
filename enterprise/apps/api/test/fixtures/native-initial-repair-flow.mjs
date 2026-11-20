import assert from 'node:assert/strict';
import {cp,readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {canonicalJson} from '../../dist/license/contracts.js';
import {hash,initialRelease} from './native-release.mjs';

export async function verifyInitialRepair({f,host,db,pkg,root,manifest}){
 const key=f.state.config.frameworkKey,before=structuredClone(f.state.active(key)),current=f.state.path(key,before.current);
 const {NativeInitialRepairEffects}=await import(pathToFileURL(join(current,'apps/api/dist/lifecycle/native-initial-repair.js')).href);
 const {UpdateEngine}=await import(pathToFileURL(join(current,'apps/api/dist/lifecycle/update-engine.js')).href);
 const source=join(root,'initial-repair-source');await cp(join(pkg,'runtime'),source,{recursive:true});
 const marker='same-version repair acceptance';await writeFile(join(source,'repair-evidence.txt'),marker);
 const repaired={...manifest,files:[...manifest.files,{path:'repair-evidence.txt',size:Buffer.byteLength(marker),sha256:hash(marker)}]};
 await writeFile(join(source,'release-manifest.json'),canonicalJson(repaired)+'\n');
 const archive=join(root,'initial-repair.zip'),packed=spawnSync('zip',['-q','-X','-9',archive,'-@'],{cwd:source,input:[...repaired.files.map(file=>file.path),'release-manifest.json'].join('\n')+'\n',encoding:'utf8'});assert.equal(packed.status,0,packed.stderr);
 const release=initialRelease(f.signArchive(repaired,await readFile(archive))),id=randomUUID(),count=await db.adminAccount.count();
 const effects=new NativeInitialRepairEffects(f.state,host,f.client,id,archive,release,f.state.release(key,before.current).artifact.manifestSha256);
 const task=await new UpdateEngine(f.state.component(key),effects,true).execute(id,{packageKey:key,targetVersion:release.version,manifestSha256:release.artifact.manifestSha256});
 assert.equal(task.status,'succeeded',JSON.stringify(task));assert.equal(f.state.active(key).current.version,before.current.version);assert.notEqual(f.state.active(key).current.image,before.current.image);assert.equal(f.state.active(key).previous,null);await assert.rejects(access(current));assert.equal((await readdir(join(f.state.directory(key),'releases'))).length,1);assert.equal(await db.adminAccount.count(),count);
 await host.stop();await host.start();await host.health(key,release.version,release.artifact.manifestSha256);
 await writeFile(join(pkg,'initial-repair-report.json'),JSON.stringify({status:'passed',version:release.version,sameVersion:true,databaseSchemaUnchanged:true,databaseDataPreserved:true,backupVerified:!!task.backup,previousVersionRetained:false,currentOnly:true,restart:'passed',productionSigning:false},null,2)+'\n');
}
