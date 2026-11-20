import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,initialRelease,hash} from './fixtures/native-release.mjs';
import {StateStore} from '../dist/license/store.js';

const port=()=>new Promise(ok=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const value=s.address().port;s.close(()=>ok(value))})});
test('final packaged installer opens with stale saved database credentials and keeps direct-entry and refresh titles',{timeout:90000},async t=>{
 assert.equal(process.platform,'linux');const source=resolve(process.env.QICORE_INSTALLER_BOOTSTRAP),root=mkdtempSync(join(tmpdir(),'qicore-reviewed-bootstrap-')),bootstrap=join(root,'bundle/bootstrap'),file=join(root,'config/bootstrap.json');
 cpSync(source,bootstrap,{recursive:true});const f=fixture(join(root,'signing'),{initial:true,frameworkKey:'frm_cdm43f43e7yhk5jd',version:'0.1.8'}),archive=f.release(f.product.appKey,'0.1.8','0.0.0'),incoming=join(root,'bundle/incoming');mkdirSync(incoming);
 writeFileSync(join(incoming,'qicore-0.1.8-linux-x64.zip'),archive.archive);writeFileSync(join(incoming,'release.json'),JSON.stringify(initialRelease(archive.release)));
 const delivery={format:'qicore-bootstrap-delivery-v1',product:f.product,archive:'qicore-0.1.8-linux-x64.zip',privateRoot:join(root,'private'),backupRoot:join(root,'backups'),runtimeUser:userInfo().username},bytes=JSON.stringify(delivery);writeFileSync(join(bootstrap,'delivery.json'),bytes);
 const inventory=JSON.parse(readFileSync(join(bootstrap,'bootstrap-manifest.json')));inventory.files=inventory.files.filter(f=>f.path!=='delivery.json');inventory.files.push({path:'delivery.json',size:Buffer.byteLength(bytes),sha256:hash(bytes)});writeFileSync(join(bootstrap,'bootstrap-manifest.json'),JSON.stringify(inventory));
 const adminPort=await port(),origin='http://127.0.0.1:'+adminPort;writeFileSync(join(root,'bundle/deployment.json'),JSON.stringify({adminOrigin:origin,adminPort,apiPort:await port(),uiPort:await port()}));
 let child,output='';
 function owned(){return readdirSync('/proc').filter(name=>/^\d+$/.test(name)).flatMap(name=>{try{const base='/proc/'+name,args=readFileSync(base+'/cmdline','utf8').split('\0'),status=readFileSync(base+'/stat','utf8');if(statSync(base).uid!==process.getuid()||!args.slice(1).some(arg=>arg.startsWith(bootstrap+'/')))return [];return [{pid:Number(name),start:status.slice(status.lastIndexOf(')')+2).split(/\s+/)[19]}]}catch{return []}})}
 async function stop(){if(!child)return;const current=child;child=null;let failure,timer;if(current.exitCode===null){const done=once(current,'exit');current.kill('SIGTERM');try{await Promise.race([done,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('FIXTURE_STOP_TIMEOUT')),20000)})])}catch(error){failure=error}finally{clearTimeout(timer)}}const left=owned();for(const p of left)try{process.kill(p.pid,'SIGTERM')}catch{}for(let i=0;i<50&&owned().length;i++)await delay(100);for(const p of owned())if(left.some(old=>old.pid===p.pid&&old.start===p.start))try{process.kill(p.pid,'SIGKILL')}catch{}if(failure)throw failure;assert.equal(current.exitCode,0,output);assert.equal(left.length,0,'a complete controller shutdown must not leave installer descendants');}
 t.after(async()=>{try{await stop()}finally{assert.ok(root.startsWith(join(tmpdir(),'qicore-reviewed-bootstrap-')));rmSync(root,{recursive:true,force:true})}});
 async function start(){output='';child=spawn(process.execPath,[join(bootstrap,'start.mjs'),file],{stdio:['ignore','pipe','pipe']});for(const s of [child.stdout,child.stderr])s.on('data',b=>output=(output+b.toString()).slice(-12000));for(let i=0;i<160;i++){assert.equal(child.exitCode,null,output);try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).stage==='installation'&&output.includes('QiCore installation link'))return}catch{}await delay(100)}throw Error('FIXTURE_UI_NOT_READY')}
 await start();const title=/<title>安装须知 · 安装引导 · QiCore<\/title>/;for(let i=0;i<2;i++){const r=await fetch(origin+'/install');assert.equal(r.status,200);assert.match(await r.text(),title)}await stop();
 const config=JSON.parse(readFileSync(file));new StateStore(join(root,'config')).write('native.json',{...config.native,migrationUrl:'mysql://fixture:stale-fixture@127.0.0.1:1/fresh'});new StateStore(config.controlRoot).write('request.json',{id:'failed-before-migration',status:'failed',code:'INSTALL_FAILED',hash:'preserve'});
 await start();const r=await fetch(origin+'/install');assert.equal(r.status,200);assert.match(await r.text(),title);assert.doesNotMatch(output,/INSTALL_DATABASE_UNREACHABLE/);await stop();
});
