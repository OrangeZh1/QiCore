import {formValidationMessage,formFieldLabels} from '../core/form-validation.mjs';
import {z} from 'zod';
import {buildAliyunSmsRequest,buildTencentSmsRequest} from './sms-requests.mjs';
import {fail} from '../core/errors.mjs';

export const smsProviders=['aliyun','tencent'];
export const smsLabels={aliyun:'阿里云短信',tencent:'腾讯云短信'};
export const smsPurposes={login:'用户登录',register:'用户注册',reset:'找回密码'};
export const smsContentDefaults={login:'您的登录验证码为{code}，请勿泄露给他人。',register:'您的注册验证码为{code}，请勿泄露给他人。',reset:'您的找回密码验证码为{code}，请勿泄露给他人。'};
export function smsContent(value){
 if(typeof value!=='string'||!value.trim()||value.trim().length>500||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(value.match(/\{code\}/g)||[]).length!==1||/[{}]/.test(value.replace('{code}','')))fail('SMS_CONTENT_INVALID','短信内容须为500字以内的文本，并包含一个 {code} 验证码变量');
 return value.trim();
}
export const templateFields={login:'loginTemplate',register:'registerTemplate',reset:'resetTemplate'};
export const smsDefaults={enabled:false,signature:'',appId:'',region:'ap-guangzhou',loginTemplate:'',registerTemplate:'',resetTemplate:'',intervalSeconds:60,phoneDailyLimit:10,ipHourlyLimit:20};
const text=z.string().trim().max(100).refine(v=>!/[<>\u0000-\u001f\u007f]/.test(v),'不能包含尖括号或控制字符');
const schema=z.object({enabled:z.boolean(),signature:text,appId:z.string().trim().max(32).regex(/^\d*$/,'只能包含数字，可留空'),region:z.string().trim().max(50).regex(/^(?:[a-z]+(?:-[a-z0-9]+)+)?$/,'须为服务商地域标识，例如 ap-guangzhou，可留空'),loginTemplate:text,registerTemplate:text,resetTemplate:text,intervalSeconds:z.number().int().min(30).max(600),phoneDailyLimit:z.number().int().min(1).max(100),ipHourlyLimit:z.number().int().min(1).max(500)}).strict();
export function smsConfig(provider,input){
 if(!smsProviders.includes(provider))fail('SMS_PROVIDER_INVALID','不支持的短信服务商');const parsed=schema.safeParse(input);if(!parsed.success)fail('SMS_INPUT_INVALID',formValidationMessage(parsed.error,{appId:'短信SDK AppID'}));const value=parsed.data;
 for(const field of Object.values(templateFields))if(value[field]&&!(provider==='aliyun'?/^SMS_[A-Za-z0-9]{1,90}$/:/^\d{1,32}$/).test(value[field]))fail('SMS_TEMPLATE_INVALID',formFieldLabels[field]+(provider==='aliyun'?'须以 SMS_ 开头，后接 1–90 位英文字母或数字':'须为 1–32 位数字'));
 return value;
}
export const smsConfigured=(provider,config,credentials)=>!!credentials.accessKeyId&&!!credentials.secret&&!!config.signature&&(provider!=='tencent'||!!config.appId&&!!config.region);
export function validateSmsCredentials(provider,config,credentials,complete=false){
 if(credentials.accessKeyId&&!/^[A-Za-z0-9_-]{8,200}$/.test(credentials.accessKeyId))fail('SMS_KEYS_INVALID','访问密钥ID须为 8–200 位英文字母、数字、下划线或短横线');
 if(credentials.secret&&!/^[\x21-\x7e]{1,512}$/.test(credentials.secret))fail('SMS_KEYS_INVALID','访问密钥须为 1–512 位可见 ASCII 字符，不能包含空格');
 const missing=['accessKeyId','secret'].find(name=>!credentials[name])||['signature',...(provider==='tencent'?['appId','region']:[])].find(name=>!config[name]);
 if(complete&&missing)fail('SMS_CONFIG_INCOMPLETE','请填写'+(missing==='appId'?'短信SDK AppID':formFieldLabels[missing]));
}
export class SmsProviderError extends Error {constructor(code){super('短信服务商拒绝请求');this.code='SMS_PROVIDER_REJECTED';this.providerCode=typeof code==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(code)?code:'INVALID_PROVIDER_RESPONSE'}}
export class SmsTransport {
 constructor(fetcher=fetch){this.fetcher=fetcher}
 request(provider,config,credentials,phone,purpose,code){
  if(!smsProviders.includes(provider)||!Object.hasOwn(templateFields,purpose)||!/^1[3-9]\d{9}$/.test(phone)||!/^\d{6}$/.test(code))fail('SMS_INPUT_INVALID','短信请求参数无效');
  const templateId=config[templateFields[purpose]];if(!templateId)fail('SMS_TEMPLATE_REQUIRED','当前用途尚未配置短信模板');
  return(provider==='aliyun'?buildAliyunSmsRequest:buildTencentSmsRequest)({...config,...credentials,templateId},phone,code);
 }
 async send(provider,config,credentials,phone,purpose,code){
  const request=this.request(provider,config,credentials,phone,purpose,code);let response,data;
  try{response=await this.fetcher(request.url,{method:'POST',headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.body)throw Error();const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw Error();chunks.push(Buffer.from(chunk))}data=JSON.parse(Buffer.concat(chunks).toString());if(!data||typeof data!=='object')throw Error()}catch{fail('SMS_RESULT_UNKNOWN','短信发送结果未确认，请先核对发送记录和服务商记录',503)}
  if(provider==='aliyun'){
   if(typeof data.Code==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(data.Code)&&data.Code!=='OK')throw new SmsProviderError(data.Code);
   if(!response.ok||data.Code!=='OK'||typeof data.BizId!=='string'||!data.BizId||data.BizId.length>128)fail('SMS_RESULT_UNKNOWN','服务商受理结果不完整，请先核对发送记录',503);
   return data.BizId;
  }
  const errorCode=data.Response?.Error?.Code;if(typeof errorCode==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(errorCode))throw new SmsProviderError(errorCode);const statuses=data.Response?.SendStatusSet;
  if(!Array.isArray(statuses)||statuses.length!==1||!statuses[0]||statuses[0].PhoneNumber&&statuses[0].PhoneNumber!=='+86'+phone)fail('SMS_RESULT_UNKNOWN','服务商返回的接收号码或结果不匹配',503);
  if(typeof statuses[0].Code==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(statuses[0].Code)&&statuses[0].Code.toLowerCase()!=='ok')throw new SmsProviderError(statuses[0].Code);
  const receipt=statuses?.[0]?.SerialNo;
  if(!response.ok||statuses?.length!==1||String(statuses[0].Code).toLowerCase()!=='ok'||typeof receipt!=='string'||!receipt||receipt.length>128)fail('SMS_RESULT_UNKNOWN','服务商受理结果不完整，请先核对发送记录',503);
  return receipt;
 }
}
