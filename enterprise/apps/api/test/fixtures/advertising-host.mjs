import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sign} from 'node:crypto';
import {StateStore} from '../../dist/license/store.js';
import {LicenseClient} from '../../dist/license/client.js';
import {describeBundle,compositionFilename} from '../../dist/applications/standalone-bundle.js';
import {fixtureProduct,signedFixture} from './standalone-product.mjs';
import {canonicalJson} from '../../dist/license/contracts.js';
import {passwordHash} from '../../dist/core/admin-auth.mjs';
import {decorationBlock} from '../../dist/core/decoration-contract.mjs';
import {miniAdDefaults} from '../../dist/core/tenant-mini-ads.mjs';

// Exercises the host's actual loader and HTTP/SSR entry points with a business-free application.
export async function verifyAdvertisingHost({root,db,base,origin,uiOrigin,startApi,enterpriseId,licensePath,ownerHeaders}){
 const key='ads-fixture',packageKey='app_fixture',appId='wx1234567890abcdef',version='1.0.0';
 const bundle=join(root,'ads-product'),path=join(bundle,'components',packageKey);
 await mkdir(path,{recursive:true});await mkdir(join(bundle,'server'),{recursive:true});
 await writeFile(join(bundle,'server/start.mjs'),'// isolated runtime catalog fixture\n');
 await writeFile(join(bundle,'product.json'),JSON.stringify({version,frameworkVersion:'0.1.0'}));
 await writeFile(join(path,'application.json'),JSON.stringify({format:'qicore-application-v1',key,packageKey,version,name:'广告验收应用',pendingTasks:[]}));
 await writeFile(join(path,'entry.mjs'),`export function createApplication(sdk){const d=sdk.modules['core/decoration-contract.mjs'];return{format:'qicore-application-v1',version:'1.0.0',definition:{key:'${key}',name:'广告验收应用',licensePackageKey:'${packageKey}',permissions:['settings.read','settings.write'],wechatMini:true,decoration:{...d.basicDecoration,defaults:()=>d.defaultDecoration()},defaultConfig:()=>({}),validateConfig:v=>v},createRuntime:()=>({key:'${key}',consumerPaths:[],connect(){},async initialize(){},async tick(){},async admin(){return null},async consumer(){return null},async health(){return true},async close(){}})}}`);
 const {product,privateKey,receiptKeys}=fixtureProduct(packageKey,version);
 const configFile=join(root,'ads-public-product.json'),releaseFile=join(root,'ads-signed-release.json');
 await writeFile(configFile,JSON.stringify(product));
 await writeFile(join(bundle,compositionFilename),JSON.stringify(await describeBundle(bundle,product)));
 await writeFile(releaseFile,JSON.stringify(await signedFixture(bundle,privateKey,packageKey,version)));
 const store=new StateStore(licensePath),client=new LicenseClient(store,product,'127.0.0.1'),identity=client.identity(true),now=Date.now(),iso=n=>new Date(now+n).toISOString();
 const receipt={protocol:'license-api-v2',key_id:'receipt',issuer:'https://license.mcent.cn',audience:'qiadmin-runtime',license_id:'ads-fixture',company_name:'QA',revision:1,product_id:packageKey,instance_id:identity.instanceId,instance_public_key_sha256:identity.instanceId,authorized_domain:'127.0.0.1',authorized_server_ip:null,mode:'domain',domain_matched:true,server_ip_matched:null,decision:'allow',reason_code:'AUTHORIZED',decision_id:'isolated-fixture',entitlements:[{packageKey,type:'app',useExpiresAt:null,updatesExpiresAt:iso(86400000),channel:'stable',onlineUpdateEnabled:false}],issued_at:iso(0),refresh_after:iso(300000),online_valid_until:iso(3600000),grace_until:iso(7200000),binding_directive:null};
 const bytes=Buffer.from(canonicalJson(receipt));client.acceptReceipt({key_id:'receipt',payload:bytes.toString('base64url'),signature:sign(null,bytes,receiptKeys.privateKey).toString('base64url')});
 const native={QICORE_STANDALONE_BUNDLE_ROOT:bundle,QICORE_STANDALONE_RELEASE_FILE:releaseFile,QICORE_STANDALONE_PRODUCT_FILE:configFile};
 await startApi(native);
 const builtin=await db.adminRole.findUnique({where:{systemCode:'tenant-admin'}});
 assert.ok(builtin.permissions.includes(key+':settings.read'),'an existing empty installation must grant the newly loaded app to its built-in tenant administrators');
 assert.ok(builtin.permissions.includes(key+':settings.write'));
 const grantSync=await db.audit.findFirstOrThrow({where:{scope:'tenant',tenantId:enterpriseId,action:'role.application-grants.sync'},orderBy:{createdAt:'desc'}});
 assert.ok(grantSync.details.added.includes(key+':settings.write'));
 await db.tenantApplication.updateMany({where:{tenantId:enterpriseId,activeSlot:1},data:{activeSlot:null,enabled:false}});
 await db.tenantApplication.create({data:{tenantId:enterpriseId,applicationKey:key,config:{marker:'retained'}}});
 await db.tenantMiniProgramSetting.create({data:{tenantId:enterpriseId,applicationKey:key,config:{appId},version:3}});

 const role=await db.adminRole.create({data:{id:'ads-admin-role',name:'广告管理员',portal:'tenant',permissions:[key+':settings.read',key+':settings.write']}}),password='fixture-only-password';
 await db.adminAccount.create({data:{id:'ads-admin',username:'adsadmin',nickname:'广告管理员',passwordHash:await passwordHash(password),roleId:role.id,scopes:{create:{tenantId:enterpriseId}}}});
 const login=await fetch(base+'/api/v1/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'adsadmin',password,portal:'tenant'})});assert.equal(login.status,200);const session=(await login.json()).data,cookie=login.headers.getSetCookie().find(c=>c.startsWith('qicore_enterprise_session=')).split(';')[0],headers={origin,cookie,'x-console-portal':'tenant','x-csrf-token':session.csrfToken,'content-type':'application/json'};
 const endpoint='/api/v1/admin/tenants/'+enterpriseId+'/mini-program/'+key+'/ads',request=(url,method='GET',body,override={})=>fetch(base+url,{method,headers:{...headers,...override},...(body?{body:JSON.stringify(body)}:{})});
 const updatesUrl=base+'/api/v1/admin/updates';
 const status=await fetch(updatesUrl,{headers:ownerHeaders});
 assert.equal(status.status,200);assert.equal((await status.json()).data.packageKey,packageKey);
 assert.equal((await fetch(uiOrigin+'/admin/updates',{headers:{cookie:ownerHeaders.cookie}})).status,200);
 assert.equal((await fetch(updatesUrl,{headers})).status,403);
 assert.equal((await fetch(updatesUrl+'/check',{method:'POST',headers:{...ownerHeaders,'x-csrf-token':''},body:'{}'})).status,403);
 for(const path of ['/updates/check','/license/check']){
   const response=await fetch(base+'/api/v1/admin'+path,{method:'POST',headers:ownerHeaders,body:JSON.stringify(path==='/license/check'?{kind:'updates'}:{})});
   assert.equal(response.status,200,path);
 }
 assert.equal((await fetch(updatesUrl+'/applications/execute',{method:'POST',headers:ownerHeaders,body:'{}'})).status,404);
 assert.equal((await fetch(base+endpoint)).status,401);const initial=await request(endpoint);assert.equal(initial.status,200);const old=(await initial.json()).data;assert.equal(old.version,0);assert.equal(old.canWrite,true);
 const config={...miniAdDefaults(),mode:'manual',homeBanner:'adunit-home00001',rewarded:'adunit-reward001'},input={version:0,appId,config};
 assert.equal((await request(endpoint,'PUT',input,{'x-csrf-token':'wrong'})).status,403);assert.equal((await request(endpoint,'PUT',input,{origin:'https://outside.invalid'})).status,403);assert.equal((await request(endpoint.replace(enterpriseId,'another-enterprise'),'PUT',input)).status,403);
 const saved=await request(endpoint,'PUT',input);assert.equal(saved.status,200);assert.equal((await saved.json()).data.version,1);assert.equal((await request(endpoint,'PUT',input)).status,409);
 const query='/api/v1/public/mini-ads?tenantId='+enterpriseId+'&applicationKey='+key+'&appId='+appId,published=await fetch(base+query);assert.match(published.headers.get('cache-control'),/no-store/);const publicView=(await published.json()).data;assert.equal(publicView.homeBanner,config.homeBanner);assert.equal(publicView.rewarded.adUnitId,config.rewarded);assert.equal(publicView.rewarded.grantsReward,false);assert.equal(publicView.rewarded.verification,'client-event');
 assert.equal((await fetch(base+query.replace(appId,'wxabcdef1234567890'))).status,403);assert.equal((await fetch(base+query.replace(enterpriseId,'another-enterprise'))).status,403);
 for(const url of ['/api/v1/reward-ads/sessions','/api/v1/ads','/api/v1/apps/'+key+'/ads'])assert.equal((await request(url,'POST',{completed:true,isEnded:true})).status,404,'framework must not grant rewards');
 const decorationEndpoint='/api/v1/admin/tenants/'+enterpriseId+'/decoration',d=(await(await request(decorationEndpoint)).json()).data,current=d.current,scheme=structuredClone(current.scheme);scheme.home.blocks.unshift(decorationBlock('wechat-ad','ad-position'));const decor=await request(decorationEndpoint+'/'+key,'PUT',{version:d.version,action:'save',id:current.id,name:current.name,scheme});assert.equal(decor.status,200,await decor.text());
 const snapshot=await db.tenantMiniAdSetting.findMany(),decorationSnapshot=await db.tenantDecoration.findMany();await startApi(native);assert.deepEqual(await db.tenantMiniAdSetting.findMany(),snapshot);assert.deepEqual(await db.tenantDecoration.findMany(),decorationSnapshot);assert.equal((await(await fetch(base+query)).json()).data.homeBanner,config.homeBanner);
 for(let n=0;n<2;n++){const ui=await fetch(uiOrigin+'/admin/mini-program?tab=ads',{headers:{cookie}});assert.equal(ui.status,200);const html=await ui.text();assert.match(html,/<title>微信小程序 · QiCore<\/title>/);assert.ok(html.includes('adunit-home00001'));assert.ok(html.includes('id="ad-rewarded"'));assert.doesNotMatch(html,/DCloud AppID|云端桥接地址/)}
 await db.adminRole.update({where:{id:role.id},data:{permissions:[key+':settings.read']}});assert.equal((await(await request(endpoint)).json()).data.canWrite,false);assert.equal((await request(endpoint,'PUT',{...input,version:1})).status,403);
 await db.tenantApplication.update({where:{tenantId_applicationKey:{tenantId:enterpriseId,applicationKey:key}},data:{enabled:false}});assert.equal((await fetch(base+query)).status,403);
 const disabledPage=await fetch(uiOrigin+'/admin/mini-program?tab=ads',{headers:{cookie}});assert.equal(disabledPage.status,200);const disabledHtml=await disabledPage.text();assert.ok(disabledHtml.includes('没有可查看的应用'));assert.ok(disabledHtml.includes('重试'),'failed direct ad-tab entry must keep the error and recovery control visible');
 await db.tenantApplication.update({where:{tenantId_applicationKey:{tenantId:enterpriseId,applicationKey:key}},data:{enabled:true}});
 // Removing the app from the trusted startup inventory must not erase its configuration.
 await startApi();assert.equal((await fetch(base+query)).status,404);assert.equal((await request(endpoint)).status,403);assert.deepEqual(await db.tenantMiniAdSetting.findMany(),snapshot);assert.deepEqual(await db.tenantDecoration.findMany(),decorationSnapshot);
 assert.deepEqual((await db.adminRole.findUnique({where:{id:role.id}})).permissions,[key+':settings.read'],'custom grants must survive restart and unload unchanged');
 assert.ok((await db.adminRole.findUnique({where:{id:builtin.id}})).permissions.includes(key+':settings.write'),'unload retains historical grants for reinstall');
 const tables=await db.$queryRawUnsafe('SHOW TABLES');assert.ok(!tables.some(row=>['Work','Unlock','AdSession','RewardAdSession'].includes(Object.values(row)[0])));
}
