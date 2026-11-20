import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapChallengePublisher} from '../dist/lifecycle/bootstrap-challenge.js';
import {LicenseClient} from '../dist/license/client.js';
import {fixture} from './fixtures/native-release.mjs';

function setup(t){
 const root=mkdtempSync(join(tmpdir(),'qicore-static-challenge-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const web=join(root,'site'),bootstrap=join(web,'bootstrap'),control=join(root,'control');mkdirSync(bootstrap,{recursive:true});mkdirSync(control);
 return {root,web,bootstrap,control,target:join(web,'.well-known/qilicense-challenge')};
}
test('BaoTa static challenge is public only during verified binding and stays outside the integrity tree',async t=>{
 const x=setup(t),f=fixture(join(x.root,'fixture'),{initial:true}),receipt=f.client.status().receipt,token='fixture_challenge_1234567890';let phase=0;
 const publish=bootstrapChallengePublisher(x.web,x.bootstrap,x.control);
 const client=new LicenseClient(f.client.store,f.product,'127.0.0.1',async url=>{
  if(String(url).endsWith('license/bootstrap'))return Response.json({instanceId:client.identity().instanceId,status:'binding_required',challenge:{domain:client.domain,path:'/.well-known/qilicense-challenge',token,expiresAt:new Date(Date.now()+60000).toISOString()}});
  phase++;assert.deepEqual(JSON.parse(readFileSync(x.target)),{token});assert.equal(existsSync(join(x.bootstrap,'.well-known')),false);
  if(process.platform!=='win32')assert.equal(statSync(x.target).mode&0o777,0o644);
  return Response.json({receipt:f.envelope({...receipt,revision:receipt.revision+1,issued_at:new Date(Date.now()+1000).toISOString()})});
 },false,publish);
 assert.equal((await client.activate()).state,'active');assert.equal(phase,1);assert.equal(existsSync(x.target),false);assert.equal(existsSync(join(x.control,'domain-challenge-file.json')),false);
});
test('binding failure cleans its own challenge, while changed or preexisting customer files are preserved',async t=>{
 const x=setup(t),publish=bootstrapChallengePublisher(x.web,x.bootstrap,x.control),remove=await publish({token:'fixture_challenge_1234567890'},Date.now()+60000);
 writeFileSync(x.target,'customer change');assert.throws(remove,/DOMAIN_CHALLENGE_FILE_CONFLICT/);assert.equal(readFileSync(x.target,'utf8'),'customer change');
 const other=setup(t);mkdirSync(join(other.web,'.well-known'));writeFileSync(other.target,'existing customer file');
 const next=bootstrapChallengePublisher(other.web,other.bootstrap,other.control);await assert.rejects(next({token:'fixture_challenge_1234567890'},Date.now()+60000),/DOMAIN_CHALLENGE_FILE_CONFLICT/);assert.equal(readFileSync(other.target,'utf8'),'existing customer file');
});
test('restart cleans a recognized interrupted proof and never uses the signed bootstrap directory as web root',async t=>{
 const x=setup(t);await bootstrapChallengePublisher(x.web,x.bootstrap,x.control)({token:'fixture_challenge_1234567890'},Date.now()+60000);assert.equal(existsSync(x.target),true);
 bootstrapChallengePublisher(x.web,x.bootstrap,x.control);assert.equal(existsSync(x.target),false);
 assert.throws(()=>bootstrapChallengePublisher(x.bootstrap,x.bootstrap,x.control),/BAOTA_PROJECT_DIRECTORY_REQUIRED/);
});
test('an online binding error still disposes the temporary proof and does not create an accepted receipt',async t=>{
 const x=setup(t),f=fixture(join(x.root,'fixture'),{initial:true}),before=readFileSync(f.client.store.path('receipt.json'),'utf8');
 const client=new LicenseClient(f.client.store,f.product,'127.0.0.1',async url=>{
  if(String(url).endsWith('license/bootstrap'))return Response.json({instanceId:client.identity().instanceId,status:'binding_required',challenge:{domain:client.domain,path:'/.well-known/qilicense-challenge',token:'fixture_challenge_1234567890',expiresAt:new Date(Date.now()+60000).toISOString()}});
  assert.equal(existsSync(x.target),true);throw Error('fixture network unavailable');
 },false,bootstrapChallengePublisher(x.web,x.bootstrap,x.control));
 await assert.rejects(client.activate(),/LICENSE_NETWORK_ERROR/);assert.equal(existsSync(x.target),false);assert.equal(readFileSync(f.client.store.path('receipt.json'),'utf8'),before);
});
