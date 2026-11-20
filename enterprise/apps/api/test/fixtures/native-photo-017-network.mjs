// Test-only, multi-component counterpart of native-transition-network.mjs.
import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash,createPublicKey,verify,randomUUID} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {canonicalJson} from '../../dist/license/contracts.js';
const local=host=>['127.0.0.1','localhost','[::1]'].includes(host);
export const photoTransitionRequired='NATIVE_UPDATER_TRANSITION_REQUIRED';

export function photo017Fetch(read,localFetch,readArchive=path=>readFileSync(path),record=()=>{}){
 return async(input,options)=>{
  const url=new URL(input?.url||input);
  if(local(url.hostname))return localFetch(input,options);
  assert.equal(url.origin,'https://license.example','TEST_EXTERNAL_NETWORK_BLOCKED');
  const fixture=read();
  if(!options?.body){
   const item=fixture.releases.find(item=>item.release.artifact.downloadUrl===url.pathname);assert.ok(item,'only pinned test artifacts may be downloaded');
   assert.equal(options?.headers?.authorization,'Bearer fixture_update.'+'a'.repeat(43));
   const bytes=readArchive(item.archive);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.release.artifact.sha256);
   return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
  }
  const envelope=JSON.parse(options.body),body=envelope.payload,key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(fixture.publicKey,'base64url')]),format:'der',type:'spki'});
  assert.equal(envelope.instanceId,fixture.instanceId);
  const digest=createHash('sha256').update(canonicalJson(body)).digest('hex');
  assert.ok(verify(null,Buffer.from(`${envelope.instanceId}\n${envelope.timestamp}\n${envelope.nonce}\n${digest}`),key,Buffer.from(envelope.signature,'base64url')));
  // Only this fixed allowlist is recorded; no envelopes, signatures, tokens or instance identities.
  const exchange=endpoint=>{
   const event={exchangeId:randomUUID(),endpoint,capability:body.capability,packageKey:fixture.targetPackageKey,operation:endpoint==='/updates/lifecycle/plan'?body.operation:null};
   record({...event,phase:'request'});
   return(status,value)=>{const response=Response.json(value,{status});record({...event,phase:'response',status,code:value.code??null,planIssued:!!value.signedPlan});return response};
  };
  if(url.pathname.endsWith('/license/renew'))return Response.json({receipt:fixture.receipt});
  if(url.pathname.endsWith('/license/installation/report'))return Response.json({accepted:true,attemptId:body.attemptId,sequence:body.sequence});
  if(url.pathname.endsWith('/access')){
   assert.ok(fixture.releases.some(item=>url.pathname===item.release.artifact.downloadUrl+'/access'));
   return Response.json({accessToken:'fixture_update.'+'a'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()});
  }
  if(url.pathname.endsWith('/updates/lifecycle/plan')){
   assert.equal(body.operation,fixture.lifecycleOperation);assert.equal(body.packageKey,fixture.applicationKey);assert.deepEqual(body.installed,fixture.installed);
   assert.ok(['native-lifecycle-v1','native-lifecycle-v2'].includes(body.capability));
   const respond=exchange('/updates/lifecycle/plan');
   if(body.capability==='native-lifecycle-v1'&&fixture.targetIntegrityFormat==='id-photo-release-integrity-v1')return respond(409,{code:photoTransitionRequired});
   assert.ok(fixture.lifecyclePlans[body.capability],'matching lifecycle plan required');return respond(200,{signedPlan:fixture.lifecyclePlans[body.capability]});
  }
  if(url.pathname.endsWith('/updates/plan')){
   assert.ok(['native-full-v1','native-full-v2','native-full-v3'].includes(body.capability));assert.deepEqual(body.installed,fixture.installed);assert.deepEqual(body.targetPackageKeys,[fixture.targetPackageKey]);
   const respond=exchange('/updates/plan');
   if(fixture.targetIntegrityFormat&&(body.capability==='native-full-v1'||fixture.targetIntegrityFormat==='id-photo-release-integrity-v1'&&body.capability!=='native-full-v3'))return respond(409,{code:photoTransitionRequired});
   // Deliberately return the signed target even when incompatible: the real updater must reject it.
   assert.ok(fixture.plans[body.capability],'matching update plan required');return respond(200,{signedPlan:fixture.plans[body.capability]});
  }
  throw Error('TEST_EXTERNAL_OPERATION_BLOCKED');
 };
}

export function assertLegacyPhotoTransition(apiResult,events,packageKey){
 assert.deepEqual({...apiResult,checkedAt:'checked'}, {state:'unavailable',label:'检查未完成',description:'无法完成可信版本检查',currentVersion:'0.1.6',latestVersion:null,checkedAt:'checked',code:'LICENSE_NETWORK_ERROR',canCheck:true});
 assert.equal(new Date(apiResult.checkedAt).toISOString(),apiResult.checkedAt);
 assert.equal(events.length,2,'one verified request and one explicit refusal are required');
 const [request,response]=events;assert.match(request.exchangeId,/^[a-f0-9-]{36}$/);
 const expected={exchangeId:request.exchangeId,endpoint:'/updates/plan',capability:'native-full-v1',packageKey,operation:null};
 assert.deepEqual(request,{...expected,phase:'request'});
 assert.deepEqual(response,{...expected,phase:'response',status:409,code:photoTransitionRequired,planIssued:false});
 return {requestCapability:request.capability,responseStatus:response.status,responseCode:response.code,planIssued:false,legacyApiCode:apiResult.code};
}

export function assertPhoto017Runtime(setup,env=process.env){
 const product=env.QICORE_PRODUCT?JSON.parse(env.QICORE_PRODUCT):null;
 if(setup.failRuntimeVersion&&product?.version===setup.failRuntimeVersion)throw Error('TEST_CANDIDATE_RUNTIME_FAILURE');
 const components=env.QICORE_COMPONENTS?JSON.parse(env.QICORE_COMPONENTS):{};
 if(setup.failApplicationVersion&&components[setup.applicationKey]?.version===setup.failApplicationVersion)throw Error('TEST_CANDIDATE_APPLICATION_FAILURE');
}
if(process.env.QICORE_PHOTO_017_NETWORK_FILE){
 const read=()=>JSON.parse(readFileSync(process.env.QICORE_PHOTO_017_NETWORK_FILE,'utf8'));
 assertPhoto017Runtime(read());
 const events=process.env.QICORE_PHOTO_017_NETWORK_EVENTS;
 if(!events)throw Error('TEST_NETWORK_EVIDENCE_REQUIRED');
 globalThis.fetch=photo017Fetch(read,globalThis.fetch,undefined,event=>appendFileSync(events,JSON.stringify(event)+'\n'));
 for(const module of [http,https])for(const method of ['request','get']){
  const original=module[method];module[method]=function(input,...args){
   const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';
   if(!local(host))throw Error('TEST_EXTERNAL_NETWORK_BLOCKED');return original.call(this,input,...args);
  };
 }
 syncBuiltinESMExports();
}
