// Test-only preload for real controller/worker subprocesses. No external request is forwarded.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {canonicalJson} from '../../dist/license/contracts.js';

const original=globalThis.fetch,local=host=>['127.0.0.1','localhost','[::1]'].includes(host);
// Fault injection belongs to this external test preload, never to deployed code.
if(process.env.QICORE_PRODUCT&&JSON.parse(process.env.QICORE_PRODUCT).version===JSON.parse(readFileSync(process.env.QICORE_TRANSITION_NETWORK_FILE,'utf8')).failRuntimeVersion)throw Error('TEST_CANDIDATE_RUNTIME_FAILURE');
globalThis.fetch=async(input,options)=>{
 const url=new URL(input?.url||input);
 if(local(url.hostname))return original(input,options);
 assert.equal(url.hostname,'license.example','TEST_EXTERNAL_NETWORK_BLOCKED');
 const fixture=JSON.parse(readFileSync(process.env.QICORE_TRANSITION_NETWORK_FILE,'utf8'));
 if(!options?.body){
  assert.equal(url.pathname,fixture.release.artifact.downloadUrl);assert.equal(options.headers.authorization,'Bearer fixture_update.'+'a'.repeat(43));
  const bytes=readFileSync(fixture.archive);return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
 }
 const envelope=JSON.parse(options.body),body=envelope.payload,key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(fixture.publicKey,'base64url')]),format:'der',type:'spki'});
 assert.equal(envelope.instanceId,fixture.instanceId);
 const hash=createHash('sha256').update(canonicalJson(body)).digest('hex');
 assert.ok(verify(null,Buffer.from(`${envelope.instanceId}\n${envelope.timestamp}\n${envelope.nonce}\n${hash}`),key,Buffer.from(envelope.signature,'base64url')));
 if(url.pathname.endsWith('/license/renew'))return Response.json({receipt:fixture.receipt});
 if(url.pathname.endsWith('/license/installation/report'))return Response.json({accepted:true,attemptId:body.attemptId,sequence:body.sequence});
 if(url.pathname.endsWith('/access'))return Response.json({accessToken:'fixture_update.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()});
 if(url.pathname.endsWith('/updates/plan')){
  assert.ok(['native-full-v1','native-full-v2','native-full-v3'].includes(body.capability));assert.deepEqual(body.installed,fixture.installed);
  if(fixture.release.artifact.integrity&&(body.capability==='native-full-v1'||fixture.release.artifact.integrity.format==='id-photo-release-integrity-v1'&&body.capability!=='native-full-v3'))return Response.json({code:'NATIVE_UPDATER_TRANSITION_REQUIRED'},{status:409});
  const signedPlan=fixture.plans[body.capability];assert.ok(signedPlan,'fixture must explicitly authorize the requested capability');return Response.json({signedPlan});
 }
 throw Error('TEST_EXTERNAL_OPERATION_BLOCKED');
};
for(const module of [http,https])for(const method of ['request','get']){
 const old=module[method];module[method]=function(input,...args){
  const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';
  if(!local(host))throw Error('TEST_EXTERNAL_NETWORK_BLOCKED');return old.call(this,input,...args);
 };
}
syncBuiltinESMExports();
