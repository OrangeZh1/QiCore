import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AdminAuth} from '../src/core/admin-auth.mjs';

test('delegation lasts with its parent session beyond 15 minutes and still enforces revocation and target scope',async t=>{
 const now=Date.parse('2026-10-26T00:00:00Z');t.mock.timers.enable({apis:['Date'],now});
 const token='a'.repeat(64),digest=value=>createHash('sha256').update(value).digest('hex');
 const platform={id:'platform',nickname:'平台',enabled:true,role:{portal:'admin',enabled:true,permissions:['accounts.write','tenants.read']},scopes:[]};
 const account={id:'owner',nickname:'租户',enabled:true,role:{portal:'tenant',enabled:true,permissions:['tenant:settings.read']},scopes:[{tenantId:'site',enabled:true}]};
 const tenant={id:'site',name:'租户',enabled:true,ownerAdminId:'owner',expiresAt:new Date(now-60000)},records=new Map(),audit=[];
 let parentRecord={tokenHash:digest(token),csrfHash:'b'.repeat(64),portal:'admin',expiresAt:new Date(now+8*3600000),admin:platform};
 const db={
  $transaction:fn=>fn(db),$queryRaw:async()=>parentRecord?[{tokenHash:parentRecord.tokenHash}]:[],
  adminSession:{findUnique:async({where})=>parentRecord?.tokenHash===where.tokenHash?parentRecord:null,deleteMany:async()=>{parentRecord=null}},
  adminAccount:{findFirst:async()=>account,findUnique:async()=>account},tenant:{findUnique:async()=>tenant},
  adminDelegation:{deleteMany:async({where})=>{for(const [key,row] of records)if(where.tokenHash===key||where.parentTokenHash===row.parentTokenHash)records.delete(key)},create:async({data})=>records.set(data.tokenHash,data),findUnique:async({where})=>records.get(where.tokenHash)},
  audit:{create:async({data})=>audit.push(data)}
 };
 const auth=new AdminAuth(db,{}, {origin:'https://console.test'});auth.csrfKey=Buffer.alloc(32);
 const platformCookie='qicore_admin_session='+token,parent=await auth.session(platformCookie,'admin');
 tenant.enabled=false;await assert.rejects(auth.startDelegation(parent,'site'),{code:'TENANT_UNAVAILABLE'});tenant.enabled=true;
 const issue=await auth.startDelegation(parent,'site'),cookie=platformCookie+'; '+issue.cookie.split(';')[0];
 assert.equal(issue.info.expiresAt.getTime(),parentRecord.expiresAt.getTime());assert.match(issue.cookie,/Max-Age=28800; Secure$/);
 assert.equal([...records.values()][0].expiresAt.getTime(),issue.info.expiresAt.getTime());assert.equal(audit[0].details.expiresAt,issue.info.expiresAt.toISOString());
 t.mock.timers.setTime(now+16*60000);
 const reads=[],originalTenant=db.tenant.findUnique,originalAccount=db.adminAccount.findUnique;
 let release;const gate=new Promise(resolve=>release=resolve);
 db.tenant.findUnique=async()=>{reads.push('tenant');await gate;return tenant};
 db.adminAccount.findUnique=async()=>{reads.push('account');await gate;return account};
 const pending=auth.delegatedSession(cookie);await new Promise(setImmediate);
 try{assert.deepEqual([...reads],['tenant','account'],'independent delegation reads must not serialize')}finally{release()}
 const session=await pending;db.tenant.findUnique=originalTenant;db.adminAccount.findUnique=originalAccount;
 assert.equal(session.delegated,true);assert.equal(session.impersonatedBy,'platform');assert.equal(session.tenantId,'site');
 for(const [target,key,value] of [[platform.role,'permissions',[]],[platform,'enabled',false],[account,'enabled',false],[account.role,'enabled',false],[tenant,'enabled',false],[tenant,'ownerAdminId','different']]){
  const old=target[key];target[key]=value;await assert.rejects(auth.delegatedSession(cookie),error=>['UNAUTHENTICATED','FORBIDDEN'].includes(error.code));target[key]=old;
 }
 t.mock.timers.setTime(now+8*3600000);await assert.rejects(auth.delegatedSession(cookie),{code:'UNAUTHENTICATED'});
 t.mock.timers.setTime(now+8*3600000-120000);
 const short=await auth.startDelegation(await auth.session(platformCookie,'admin'),'site');assert.match(short.cookie,/Max-Age=120; Secure$/);assert.equal(short.info.expiresAt.getTime(),parentRecord.expiresAt.getTime());
 const shortCookie=platformCookie+'; '+short.cookie.split(';')[0];await assert.rejects(auth.delegatedSession(cookie),{code:'UNAUTHENTICATED'},'switching delegation revokes the previous one');
 const shortSession=await auth.delegatedSession(shortCookie);assert.match(await auth.stopDelegation(shortSession),/Max-Age=0/);await assert.rejects(auth.delegatedSession(shortCookie),{code:'UNAUTHENTICATED'});
 const last=await auth.startDelegation(parent,'site');await auth.logout(parent);await assert.rejects(auth.delegatedSession(platformCookie+'; '+last.cookie.split(';')[0]),{code:'UNAUTHENTICATED'});
});
