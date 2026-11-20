import {fail} from './errors.mjs';

// Read-only development entry: never activates, renews or changes an installation.
export function installationPreviewAuthorization(runtime,{mode=process.env.NODE_ENV,remoteAddress='',origin='',adminOrigin=process.env.ADMIN_ORIGIN||'http://127.0.0.1:3400'}={}){
 if(mode!=='development'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remoteAddress))fail('NOT_FOUND','接口不存在',404);
 if(origin&&origin!==adminOrigin)fail('ORIGIN_REJECTED','请求来源不允许',403);
 const domain=new URL(adminOrigin).hostname;
 const result={domain,state:'unavailable',allowed:false,source:'verified-local-receipt',checkedAt:null};
 try{
  const view=runtime.view(),{license}=view;result.checkedAt=license.checkedAt||null;
  if(view.integration==='free_framework') return {...result,state:'free_framework',source:'standalone-edition',allowed:true};
  if(license.domain!==domain)return{...result,state:'domain_mismatch'};
  if(['SIGNATURE_INVALID','LICENSE_VERIFICATION_FAILED','RECEIPT_IDENTITY_MISMATCH','RECEIPT_BINDING_MISMATCH','RECEIPT_TIME_INVALID'].includes(license.reason))return{...result,state:'verification_failed'};
  if(license.state==='active'&&license.verified&&!license.lastCheckFailed)return{...result,state:'active',allowed:true};
  return{...result,state:['expired','suspended','unlicensed','grace'].includes(license.state)?license.state:'unavailable'};
 }catch{return result}
}
