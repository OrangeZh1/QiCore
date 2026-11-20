import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/native-release.mjs';
import {discoverBaoTaDeployment} from '../dist/lifecycle/bootstrap-baota.js';
import {deploymentSchema,applyDeployment,resolveBootstrapDeployment,synchronizeDeployment} from '../dist/lifecycle/bootstrap-deployment.js';

const fixturePorts=new Set();
async function freePort(){for(;;){const s=createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const port=s.address().port;await new Promise(ok=>s.close(ok));if(!fixturePorts.has(port)){fixturePorts.add(port);return port}}}
async function setup(t,legacy=false){
 const root=mkdtempSync(join(tmpdir(),'qicore-deployment-'));let db;t.after(()=>{db?.close();rmSync(root,{recursive:true,force:true})});
 const f=fixture(join(root,'fixture'),{initial:true}),bootstrap=join(root,'bundle/bootstrap'),panel=join(root,'panel'),privateRoot=join(root,'private');
 for(const dir of [bootstrap,join(panel,'data'),privateRoot,join(root,'controller')])mkdirSync(dir,{recursive:true});
 const {migrationUrl,...native}=f.state.config;
 native.healthUrl=`http://127.0.0.1:${await freePort()}/health`;native.loginUrl=`http://127.0.0.1:${await freePort()}/admin/login`;native.maintenancePort=await freePort();
 const config={native,...(legacy?{}:{publicPort:await freePort()}),controlRoot:join(root,'controller'),nativeConfigFile:join(privateRoot,'native.json'),archive:join(root,'runtime.zip'),releaseFile:join(root,'release.json'),adminOrigin:'https://qicore.mcent.cn',redisUrl:'redis://127.0.0.1:6379/0'};
 const configPath=join(privateRoot,'bootstrap.json');writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const dbPath=join(panel,'data/default.db');db=new DatabaseSync(dbPath);db.exec('CREATE TABLE sites (path TEXT,project_type TEXT,project_config TEXT)');
 const put=(changes={})=>{db.exec('DELETE FROM sites');db.prepare('INSERT INTO sites VALUES (?,?,?)').run(dirname(bootstrap),'Node',JSON.stringify({project_cwd:dirname(bootstrap),project_file:join(bootstrap,'start.mjs'),domains:['qisaas.vipui.cn:80'],port:config.publicPort??Number(new URL(config.native.loginUrl).port),...changes}))};
 return {root,f,bootstrap,panel,dbPath,db,put,config,configPath,migrationUrl,privateRoot,writeOverrides:value=>writeFileSync(join(root,'bundle/deployment.json'),JSON.stringify(value))};
}

test('BaoTa discovery reads only the matching project and never chooses another customer',async t=>{
 const x=await setup(t);x.put();const before=readFileSync(x.dbPath);
 assert.deepEqual(await discoverBaoTaDeployment(x.bootstrap,x.panel),{domains:['qisaas.vipui.cn'],adminPort:x.config.publicPort,webRoot:dirname(x.bootstrap)});
 assert.deepEqual(readFileSync(x.dbPath),before);
 x.put({project_file:join(x.root,'other/start.mjs')});assert.equal(await discoverBaoTaDeployment(x.bootstrap,x.panel),null);
 x.put();x.db.prepare('INSERT INTO sites SELECT * FROM sites').run();await assert.rejects(discoverBaoTaDeployment(x.bootstrap,x.panel),/BAOTA_PROJECT_AMBIGUOUS/);
 x.put();x.db.prepare('UPDATE sites SET project_config=?').run('{broken');await assert.rejects(discoverBaoTaDeployment(x.bootstrap,x.panel),/BAOTA_PROJECT_CONFIG_INVALID/);
});
test('automatic customer origin and ports override the issuer defaults, while ambiguity fails closed',async t=>{
 const x=await setup(t);x.put({port:await freePort()});
 const selected=await resolveBootstrapDeployment(x.bootstrap,x.config,undefined,x.panel);
 assert.equal(selected.adminOrigin,'https://qisaas.vipui.cn');assert.equal(selected.apiPort,Number(new URL(x.config.native.healthUrl).port));assert.equal(selected.maintenancePort,x.config.native.maintenancePort);
 assert.notEqual(selected.adminPort,Number(new URL(x.config.native.loginUrl).port));
 x.put({domains:['qisaas.vipui.cn','second.example']});await assert.rejects(resolveBootstrapDeployment(x.bootstrap,x.config,undefined,x.panel),/DOMAIN_AMBIGUOUS/);
 x.writeOverrides({adminOrigin:'https://qisaas.vipui.cn'});assert.equal((await resolveBootstrapDeployment(x.bootstrap,x.config,undefined,x.panel)).adminOrigin,'https://qisaas.vipui.cn');
 x.writeOverrides({adminOrigin:'https://unbound.example'});await assert.rejects(resolveBootstrapDeployment(x.bootstrap,x.config,undefined,x.panel),/DOMAIN_MISMATCH/);
 x.writeOverrides({adminPort:1024});await assert.rejects(resolveBootstrapDeployment(x.bootstrap,x.config,undefined,x.panel),/PORT_MISMATCH/);
});
test('fresh instances use fixed defaults and reject conflicts without silently choosing another port',async t=>{
 const x=await setup(t);x.put({port:3501});
 assert.deepEqual(deploymentSchema.parse({adminOrigin:'https://customer.example'}),{adminOrigin:'https://customer.example',adminPort:3500,apiPort:3501,uiPort:3502});
 await assert.rejects(resolveBootstrapDeployment(x.bootstrap,undefined,undefined,x.panel),/DEPLOYMENT_PORT_CONFLICT/);
 for(const invalid of [{adminOrigin:'https://customer.example/path'},{adminPort:0},{adminPort:65536},{adminOrigin:'https://user:password@customer.example'},{adminOrigin:'https://evil;domain.example'},{apiPort:3500}])assert.equal(deploymentSchema.safeParse({adminOrigin:'https://customer.example',...invalid}).success,false);
});

test('an occupied persisted internal port fails without changing the instance or choosing a different proxy target',async t=>{
 const x=await setup(t);x.put();const occupied=createServer();await new Promise(ok=>occupied.listen(Number(new URL(x.config.native.healthUrl).port),'127.0.0.1',ok));t.after(()=>new Promise(ok=>occupied.close(ok)));
 const before=readFileSync(x.configPath,'utf8');await assert.rejects(synchronizeDeployment(x.bootstrap,x.configPath,x.panel),/DEPLOYMENT_INTERNAL_PORT_UNAVAILABLE/);assert.equal(readFileSync(x.configPath,'utf8'),before);assert.equal(existsSync(join(x.privateRoot,'deployment-sync.json')),false);
});
test('preinstallation correction synchronizes origin and ports without creating Nginx files; restart is idempotent',async t=>{
 const x=await setup(t);x.put({port:await freePort()});writeFileSync(join(x.config.controlRoot,'access.json'),JSON.stringify({secret:'old-session'}));
 const updated=await synchronizeDeployment(x.bootstrap,x.configPath,x.panel);
 assert.equal(updated.adminOrigin,'https://qisaas.vipui.cn');assert.equal(JSON.parse(readFileSync(x.configPath)).adminOrigin,updated.adminOrigin);
 assert.notEqual(JSON.parse(readFileSync(join(x.config.controlRoot,'access.json'))).secret,'old-session');
 assert.equal(existsSync(join(x.privateRoot,'nginx.generated.conf')),false);assert.notEqual(updated.publicPort,Number(new URL(updated.native.loginUrl).port));
 const saved=readFileSync(x.configPath,'utf8');await synchronizeDeployment(x.bootstrap,x.configPath,x.panel);assert.equal(readFileSync(x.configPath,'utf8'),saved);
 assert.equal(JSON.parse(readFileSync(join(x.privateRoot,'deployment-sync.json'))).status,'complete');
});
test('installed port changes preserve private values and synchronize both configurations and runtime env',async t=>{
 const x=await setup(t);x.config.adminOrigin='https://qisaas.vipui.cn';writeFileSync(x.configPath,JSON.stringify(x.config));
 writeFileSync(x.config.nativeConfigFile,JSON.stringify({...x.config.native,migrationUrl:x.migrationUrl}));
 writeFileSync(x.config.native.environmentFile,'DATABASE_URL="mysql://test:secret@127.0.0.1/fixture"\nREDIS_URL="redis://:secret@127.0.0.1:6379/1"\nCUSTOM_SETTING="keep"\n');
 x.put({port:await freePort()});const next=await synchronizeDeployment(x.bootstrap,x.configPath,x.panel),saved=JSON.parse(readFileSync(x.config.nativeConfigFile)),env=parseEnv(readFileSync(x.config.native.environmentFile,'utf8'));
 assert.equal(saved.loginUrl,next.native.loginUrl);assert.equal(saved.healthUrl,next.native.healthUrl);assert.equal(saved.migrationUrl,x.migrationUrl);
 assert.equal(env.ADMIN_PORT,new URL(next.native.loginUrl).port);assert.equal(env.API_PORT,new URL(next.native.healthUrl).port);assert.equal(env.ADMIN_ORIGIN,next.adminOrigin);assert.equal(env.LICENSE_DOMAIN,'qisaas.vipui.cn');assert.equal(env.CUSTOM_SETTING,'keep');assert.ok(env.REDIS_URL.includes('secret'));
 if(process.platform!=='win32')assert.equal(statSync(x.config.native.environmentFile).mode&0o777,0o600);
 x.put({domains:['other.example']});await assert.rejects(synchronizeDeployment(x.bootstrap,x.configPath,x.panel),/INSTALLED_DOMAIN_CHANGE_REQUIRES_MIGRATION/);
 assert.equal(JSON.parse(readFileSync(x.configPath)).adminOrigin,'https://qisaas.vipui.cn');
});
test('legacy instances need no new file, and recovery or unrelated configuration mismatches block changes',async t=>{
 const x=await setup(t,true),before=readFileSync(x.configPath,'utf8');
 assert.deepEqual(await synchronizeDeployment(x.bootstrap,x.configPath,x.panel),x.config);assert.equal(readFileSync(x.configPath,'utf8'),before);assert.equal(existsSync(join(x.privateRoot,'nginx.generated.conf')),false);
 x.put();writeFileSync(join(x.config.controlRoot,'request.json'),JSON.stringify({status:'recovery_required'}));await assert.rejects(synchronizeDeployment(x.bootstrap,x.configPath,x.panel),/DEPLOYMENT_RECOVERY_PENDING/);assert.equal(readFileSync(x.configPath,'utf8'),before);
 rmSync(join(x.config.controlRoot,'request.json'));writeFileSync(x.config.nativeConfigFile,JSON.stringify({...x.config.native,migrationUrl:x.migrationUrl,dataRoot:join(x.root,'unexpected')}));await assert.rejects(synchronizeDeployment(x.bootstrap,x.configPath,x.panel),/INSTALL_CONFIG_CHANGED/);
});
test('an interrupted synchronization resumes exact pending bytes and rejects concurrent edits',async t=>{
 const x=await setup(t);x.put();const settings=await resolveBootstrapDeployment(x.bootstrap,x.config,undefined,x.panel),next=applyDeployment(x.config,settings),sessionPath=join(x.config.controlRoot,'access.json');
 const changes=[{path:resolve(x.configPath),before:readFileSync(x.configPath,'utf8'),after:JSON.stringify(next)},{path:resolve(sessionPath),before:null,after:JSON.stringify({secret:'new-fixture-only-session'})}].map(change=>({...change,temporary:change.path+'.'+randomUUID()+'.deployment-tmp'}));
 const journal=join(x.privateRoot,'deployment-sync.json');writeFileSync(journal,JSON.stringify({status:'pending',settings,changes}));writeFileSync(x.configPath,changes[0].after);
 writeFileSync(changes[1].temporary,changes[1].after.slice(0,10));
 await synchronizeDeployment(x.bootstrap,x.configPath,x.panel);assert.equal(readFileSync(sessionPath,'utf8'),changes[1].after);assert.equal(JSON.parse(readFileSync(journal)).status,'complete');
 assert.equal(existsSync(changes[1].temporary),false);
 writeFileSync(journal,JSON.stringify({status:'pending',settings,changes}));writeFileSync(sessionPath,'unrelated edit');await assert.rejects(synchronizeDeployment(x.bootstrap,x.configPath,x.panel),/DEPLOYMENT_SYNC_CONFLICT/);assert.equal(readFileSync(sessionPath,'utf8'),'unrelated edit');
});

test('legacy recovery keeps its original listeners and defers the shared entry without rewriting private configuration',async t=>{
 const x=await setup(t,true);x.put({domains:['qicore.mcent.cn']});writeFileSync(join(x.config.controlRoot,'request.json'),JSON.stringify({status:'recovery_required'}));
 const before=readFileSync(x.configPath,'utf8');assert.deepEqual(await synchronizeDeployment(x.bootstrap,x.configPath,x.panel),x.config);assert.equal(readFileSync(x.configPath,'utf8'),before);
});

test('new instances without legacy maintenance or static challenge settings remain serializable and restartable',async t=>{
 const x=await setup(t);delete x.config.native.maintenancePort;writeFileSync(x.configPath,JSON.stringify(x.config));x.writeOverrides({adminOrigin:x.config.adminOrigin});
 const next=await synchronizeDeployment(x.bootstrap,x.configPath,x.panel);assert.equal('maintenancePort' in next.native,false);assert.equal('challengeRoot' in next,false);assert.equal(next.publicPort,x.config.publicPort);
 assert.deepEqual(await synchronizeDeployment(x.bootstrap,x.configPath,x.panel),next);
});
