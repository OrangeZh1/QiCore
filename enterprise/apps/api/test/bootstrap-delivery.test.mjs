import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,statSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {fixture,initialRelease} from './fixtures/native-release.mjs';
import {bootstrapDeliverySchema,initialBootstrapConfig,verifyBootstrapDelivery,initializeBootstrapConfig,synchronizeInitialDelivery,runtimeIdentity} from '../dist/lifecycle/bootstrap-delivery.js';
import {canonicalJson} from '../dist/license/contracts.js';
import {StateStore} from '../dist/license/store.js';

function setup(t){
 const root=mkdtempSync(join(tmpdir(),'qicore-bootstrap-delivery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=fixture(join(root,'fixture'),{initial:true,version:'0.1.0'}),release=f.release(f.product.appKey,'0.1.0','0.0.0');
 release.release=initialRelease(release.release);
 const bootstrap=join(root,'bundle/bootstrap'),incoming=join(root,'bundle/incoming'),configPath=join(root,'credentials/bootstrap.json');mkdirSync(bootstrap,{recursive:true});mkdirSync(incoming,{recursive:true});
 const delivery=bootstrapDeliverySchema.parse({format:'qicore-bootstrap-delivery-v1',product:f.product,archive:'qicore-0.1.0-linux-x64.zip',adminOrigin:'https://customer.example',privateRoot:join(root,'private'),backupRoot:join(root,'backups'),runtimeUser:process.platform==='linux'&&process.getuid()>0?userInfo().username:'www'});
 writeFileSync(join(bootstrap,'delivery.json'),JSON.stringify(delivery));writeFileSync(join(incoming,delivery.archive),release.archive);writeFileSync(join(incoming,'release.json'),JSON.stringify(release.release));
 return{root,f,release,bootstrap,incoming,configPath,delivery};
}
test('bootstrap derives only isolated private paths from the signed delivery and rejects tampering',async t=>{
 const f=setup(t),identity={uid:10001,gid:10001};const verified=await verifyBootstrapDelivery(f.bootstrap,f.configPath,identity);
 assert.doesNotThrow(()=>canonicalJson(verified.config));assert.equal('maintenancePort' in verified.config.native,false);assert.equal('challengeRoot' in verified.config,false);
 assert.equal(verified.config.adminOrigin,'https://customer.example');assert.equal(verified.config.native.environmentFile,join(dirname(f.configPath),'runtime.env'));assert.equal(verified.config.native.runtimeUid,10001);
 assert.throws(()=>initialBootstrapConfig({...f.delivery,privateRoot:dirname(f.bootstrap)},f.bootstrap,f.configPath,identity),/BOOTSTRAP_LAYOUT_INVALID/);
 assert.throws(()=>bootstrapDeliverySchema.parse({...f.delivery,adminOrigin:'http://customer.example'}));
 writeFileSync(join(f.incoming,f.delivery.archive),Buffer.concat([f.release.archive,Buffer.from('changed')]));await assert.rejects(verifyBootstrapDelivery(f.bootstrap,f.configPath,identity),/BOOTSTRAP_ARCHIVE_INVALID/);
});
test('bootstrap refuses untrusted release keys and root runtime identities',async t=>{
 const f=setup(t),release=f.release.release;release.artifact.signatureEnvelope.key_id='unknown';writeFileSync(join(f.incoming,'release.json'),JSON.stringify(release));
 await assert.rejects(verifyBootstrapDelivery(f.bootstrap,f.configPath,{uid:10001,gid:10001}));
 assert.throws(()=>runtimeIdentity('www','www:x:0:0::/:/bin/sh'),/BOOTSTRAP_RUNTIME_USER_REQUIRED/);assert.deepEqual(runtimeIdentity('www','www:x:1000:1000::/:/bin/sh'),{uid:1000,gid:1000});
});
test('first startup creates private configuration once and preserves existing or unexplained state',{skip:process.platform!=='linux'||process.getuid()===0},async t=>{
 const f=setup(t);const oldMask=process.umask(0o077);t.after(()=>process.umask(oldMask));
 assert.deepEqual(await initializeBootstrapConfig(f.bootstrap,f.configPath),{created:true});
 const config=JSON.parse(readFileSync(f.configPath,'utf8'));assert.equal(statSync(f.configPath).mode&0o777,0o600);assert.deepEqual(readdirSync(config.native.licenseStateRoot),[]);assert.deepEqual(readdirSync(config.native.dataRoot),[]);
 assert.equal(JSON.parse(readFileSync(join(config.controlRoot,'bootstrap-init.json'),'utf8')).status,'complete');assert.deepEqual(await initializeBootstrapConfig(f.bootstrap,f.configPath),{created:false});
 const other=setup(t);mkdirSync(other.delivery.privateRoot);mkdirSync(join(other.delivery.privateRoot,'data'));writeFileSync(join(other.delivery.privateRoot,'data/customer-upload'),'keep');await assert.rejects(initializeBootstrapConfig(other.bootstrap,other.configPath),/BOOTSTRAP_RECOVERY_REQUIRED/);assert.equal(readFileSync(join(other.delivery.privateRoot,'data/customer-upload'),'utf8'),'keep');
});

test('existing uninstalled configuration follows a verified re-extracted delivery and recreates only its missing code directory',{skip:process.platform!=='linux'||process.getuid()===0},async t=>{
 const f=setup(t);await initializeBootstrapConfig(f.bootstrap,f.configPath);const old=JSON.parse(readFileSync(f.configPath));
 old.archive=join(f.incoming,'qicore-0.0.9-linux-x64.zip');old.native.product.version='0.0.9';new StateStore(dirname(f.configPath)).write('bootstrap.json',old);rmSync(old.native.root,{recursive:true});
 await synchronizeInitialDelivery(f.bootstrap,f.configPath);const repaired=JSON.parse(readFileSync(f.configPath));assert.equal(repaired.archive,join(f.incoming,f.delivery.archive));assert.equal(repaired.native.product.version,'0.1.0');assert.ok(existsSync(old.native.root));assert.equal(statSync(old.native.root).mode&0o777,0o755);
 new StateStore(join(old.native.stateRoot,old.native.frameworkKey)).write('installation.json',{status:'recovery_required',phase:'migration'});
 writeFileSync(join(f.incoming,f.delivery.archive),'damaged');const before=readFileSync(f.configPath,'utf8');await synchronizeInitialDelivery(f.bootstrap,f.configPath);assert.equal(readFileSync(f.configPath,'utf8'),before,'recovery uses its own source instead of adopting the newly extracted delivery');
});

test('an unchanged source keeps the installer reachable when saved database credentials no longer connect',{skip:process.platform!=='linux'||process.getuid()===0},async t=>{
 const f=setup(t);await initializeBootstrapConfig(f.bootstrap,f.configPath);const config=JSON.parse(readFileSync(f.configPath));new StateStore(dirname(config.nativeConfigFile)).write('native.json',{...config.native,migrationUrl:'mysql://fixture:stale-fixture@127.0.0.1:1/fresh'});new StateStore(config.controlRoot).write('request.json',{status:'failed',code:'INSTALL_FAILED'});
 const before=readFileSync(config.nativeConfigFile,'utf8');await synchronizeInitialDelivery(f.bootstrap,f.configPath);assert.equal(readFileSync(config.nativeConfigFile,'utf8'),before);assert.equal(existsSync(join(dirname(f.configPath),'initial-source-repair.json')),false);
});
