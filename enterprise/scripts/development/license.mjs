import {readFile,writeFile} from 'node:fs/promises';
import {generateKeyPairSync,createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function developmentLicense(root,state,applications){
 const {StateStore}=await import(pathToFileURL(join(root,'apps/api/dist/license/store.js')).href),{LicenseClient}=await import(pathToFileURL(join(root,'apps/api/dist/license/client.js')).href),{canonicalJson}=await import(pathToFileURL(join(root,'apps/api/dist/license/contracts.js')).href);
 const file=join(state,'development-signing.pem');let privateKey;
 try{privateKey=createPrivateKey(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;privateKey=generateKeyPairSync('ed25519').privateKey;await writeFile(file,privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600})}
 const der=createPublicKey(privateKey).export({format:'der',type:'spki'}),product={product:'qicore-local-development',name:'QiCore 本地开发',version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,appKey:'frm_local_development',componentType:'framework',deliveryKind:'archive',licenseApi:'https://development.invalid/api/v1/',receiptKeyId:'local-development',receiptPublicKey:der.toString('base64'),receiptPublicKeySha256:createHash('sha256').update(der.subarray(-32)).digest('hex')};
 const store=new StateStore(join(state,'license')),responses=new StateStore(state),client=new LicenseClient(store,product,'127.0.0.1'),identity=client.identity(true),receiptPath=join(state,'development-receipt.json');
 let revision=store.read('receipt.json')?.revision||0;
 async function renew(initial=false){const now=Date.now(),iso=offset=>new Date(now+offset).toISOString();revision++;
  const receipt={protocol:'license-api-v2',key_id:'local-development',issuer:'https://license.mcent.cn',audience:'qiadmin-runtime',license_id:'local-development-only',company_name:'本地开发环境',revision,product_id:product.appKey,instance_id:identity.instanceId,instance_public_key_sha256:identity.instanceId,authorized_domain:'127.0.0.1',authorized_server_ip:null,mode:'domain',domain_matched:true,server_ip_matched:null,decision:'allow',reason_code:'AUTHORIZED',decision_id:'development-'+revision,entitlements:[{packageKey:product.appKey,type:'framework',useExpiresAt:null,updatesExpiresAt:null,onlineUpdateEnabled:false,channel:'stable'},...applications.map(app=>({packageKey:app.packageKey,type:app.format==='qicore-plugin-v1'?'plugin':'app',useExpiresAt:null,updatesExpiresAt:null,onlineUpdateEnabled:false,tenantLimit:null,channel:'stable'}))],issued_at:iso(0),refresh_after:iso(300000),online_valid_until:iso(86400000),grace_until:iso(172800000),binding_directive:null};
  const bytes=Buffer.from(canonicalJson(receipt)),envelope={key_id:'local-development',payload:bytes.toString('base64url'),signature:sign(null,bytes,privateKey).toString('base64url')};responses.write('development-receipt.json',envelope);if(initial){client.acceptReceipt(envelope);store.write('authorization-check.json',{checkedAt:iso(0),error:null});store.write('update-check.json',{checkedAt:iso(0),state:'not_configured',label:'本地开发工作区',description:'源码由开发进程监听；正式安装与发行另行验收。'})}
 }
 await renew(true);const timer=setInterval(()=>void renew().catch(error=>console.error('Development receipt renewal failed: '+error.message)),240000);timer.unref();
 return{product,receiptPath,close(){clearInterval(timer)}};
}
