import {fail,Fault} from '../core/errors.mjs';
export class WechatMiniIdentity {
 constructor(fetcher=fetch){this.fetcher=fetcher}
 async token({appId,appSecret}){
  let retryable=true;
  try{
   const response=await this.fetcher('https://api.weixin.qq.com/cgi-bin/stable_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:appId,secret:appSecret,force_refresh:false}),redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!response.ok){retryable=response.status===429||response.status>=500;throw Error()}
   const reader=response.body.getReader(),chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){retryable=false;await reader.cancel();throw Error()}chunks.push(value)}
   retryable=false;const data=JSON.parse(Buffer.concat(chunks).toString());retryable=data?.errcode===-1;
   if(typeof data?.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0||data.errcode)throw Error();return data.access_token;
  }catch{throw Object.assign(new Fault('WECHAT_CHECK_UNAVAILABLE','凭据验证未通过，请检查已保存的 AppID、AppSecret 和微信接口访问配置',503),{retryable})}
 }
 async check(credentials){await this.token(credentials);return true}
 async phone(credentials,code,openId){
  let data;
  try{
   const token=await this.token(credentials),response=await this.fetcher('https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,openid:openId}),redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error();const reader=response.body.getReader(),chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error()}chunks.push(value)}
   data=JSON.parse(Buffer.concat(chunks).toString());
  }catch{fail('WECHAT_PHONE_UNAVAILABLE','微信手机号授权暂时不可用，请联系管理员核对小程序能力开通及凭据配置',503)}
  if([40029,40163].includes(data?.errcode))fail('WECHAT_PHONE_CODE_INVALID','手机号授权已失效，请重新点击微信授权',400);
  if(data?.errcode!==0)fail('WECHAT_PHONE_UNAVAILABLE','当前小程序暂时无法使用微信手机号授权，请联系管理员核对该能力的开通状态',503);
  const phone=data.phone_info;
  if(phone?.watermark?.appid!==credentials.appId)fail('WECHAT_PHONE_INVALID','微信手机号校验未通过，请重新授权',400);
  if(String(phone.countryCode)!=='86'||typeof phone.purePhoneNumber!=='string'||!/^1[3-9]\d{9}$/.test(phone.purePhoneNumber))fail('WECHAT_PHONE_UNSUPPORTED','当前仅支持中国大陆手机号，请选择可用号码',400);
  return phone.purePhoneNumber;
 }
 async exchange({appId,appSecret},code){
  // Same fixed WeChat endpoint as school-shop; no client-provided host or identity.
  let data;
  try{const query=new URLSearchParams({appid:appId,secret:appSecret,js_code:code,grant_type:'authorization_code'}),response=await this.fetcher('https://api.weixin.qq.com/sns/jscode2session?'+query,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();const reader=response.body.getReader();let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error()}chunks.push(value)}data=JSON.parse(Buffer.concat(chunks).toString())}catch{fail('WECHAT_LOGIN_UNAVAILABLE','微信登录暂时不可用，请重新登录后重试',503)}
  if(data?.errcode===40029||data?.errcode===40163)fail('WECHAT_CODE_INVALID','微信登录凭证已失效，请重新登录',401);
  if(data?.errcode!==undefined&&data.errcode!==0||typeof data?.openid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.openid)||typeof data?.session_key!=='string'||!data.session_key)fail('WECHAT_LOGIN_UNAVAILABLE','微信身份验证未通过，请重新登录后重试',503);
  if(!/^[A-Za-z0-9+/]{22}==$/.test(data.session_key)||Buffer.from(data.session_key,'base64').length!==16)fail('WECHAT_LOGIN_UNAVAILABLE','微信会话验证未通过，请重新登录后重试',503);
  // Only the server auth flow receives this key; never include it in a public response.
  return{openId:data.openid,sessionKey:data.session_key};
 }
}
