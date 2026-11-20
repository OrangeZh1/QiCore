import {formValidationMessage,formFieldLabels} from '../core/form-validation.mjs';
import {createPrivateKey,createPublicKey,X509Certificate,sign,verify} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../core/errors.mjs';

const field=(pattern,max,rule)=>z.string().trim().max(max).refine(v=>!v||pattern.test(v),rule);
export const paymentProviders=['wechat','alipay','wechat-virtual'];
export const paymentLabels={wechat:'微信支付',alipay:'支付宝','wechat-virtual':'虚拟支付'};
export const paymentDefaults={wechat:{enabled:false,apiVersion:'V3',mchId:'',appId:'',serialNo:'',publicKeyId:''},alipay:{enabled:false,appId:'',sellerId:''},'wechat-virtual':{enabled:false,appId:'',offerId:'',env:1,subjectType:'business'}};
const schemas={wechat:z.object({enabled:z.boolean(),apiVersion:z.enum(['V2','V3']),
 mchId:field(/^\d{6,20}$/,20,'须为 6–20 位数字，可留空'),appId:field(/^wx[a-zA-Z0-9]{16}$/,18,'须以 wx 开头，后接 16 位英文字母或数字，可留空'),
 serialNo:field(/^[0-9A-Fa-f]{16,64}$/,64,'须为 16–64 位十六进制字符，可留空'),publicKeyId:field(/^PUB_KEY_ID_[a-zA-Z0-9_]{1,96}$/,108,'须以 PUB_KEY_ID_ 开头，后接 1–96 位英文字母、数字或下划线，可留空')}).strict(),
 alipay:z.object({enabled:z.boolean(),appId:field(/^\d{16}$/,16,'须为 16 位数字，可留空'),sellerId:field(/^2088\d{12}$/,16,'须为以 2088 开头的 16 位数字，可留空')}).strict()};
schemas['wechat-virtual']=z.object({enabled:z.boolean(),appId:field(/^wx[a-zA-Z0-9]{16}$/,18,'须以 wx 开头，后接 16 位英文字母或数字，可留空'),offerId:field(/^\d{1,32}$/,32,'须为 1–32 位数字，可留空'),env:z.union([z.literal(0),z.literal(1)],{error:'须选择正式环境（0）或沙箱环境（1）'}),subjectType:z.enum(['unknown','business','personal']).default('business')}).strict().refine(c=>c.subjectType!=='personal'||c.env===0,{path:['env'],message:'个人主体仅支持正式环境'});
export const secretFields=config=>config.provider==='wechat-virtual'?['appKey','sandboxAppKey','callbackToken','encodingAESKey']:config.provider==='alipay'?['privateKey','publicKey']:config.apiVersion==='V2'?['apiV2Key','privateKey','merchantCertificate']:['apiV3Key','privateKey','publicKey'];
export const requiredSecretFields=config=>config.provider==='wechat-virtual'?[config.env===0?'appKey':'sandboxAppKey',...(config.subjectType==='personal'?['callbackToken','encodingAESKey']:[])]:secretFields(config);
export function paymentConfigured(provider,config,secretNames=[]){if(provider==='wechat-virtual'&&config.subjectType==='unknown')return false;const fields=provider==='wechat-virtual'?['appId','offerId']:provider==='alipay'?['appId','sellerId']:config.apiVersion==='V2'?['mchId','appId']:['mchId','appId','serialNo','publicKeyId'];return fields.every(k=>!!config[k])&&requiredSecretFields({...config,provider}).every(k=>secretNames.includes(k))}
export function paymentConfig(provider,input){if(!paymentProviders.includes(provider))fail('PAYMENT_PROVIDER_INVALID','不支持的支付渠道');const result=schemas[provider].safeParse(input);if(!result.success)fail('PAYMENT_INPUT_INVALID',formValidationMessage(result.error,{appId:provider==='alipay'?'支付宝应用ID':'微信AppID'}));return result.data}
function rsaPem(text,privatePart){
 const label=privatePart?'PRIVATE KEY':'PUBLIC KEY',value=text.trim(),pem=value.startsWith('-----BEGIN ')?value:'-----BEGIN '+label+'-----\n'+value.replace(/\s/g,'').match(/.{1,64}/g)?.join('\n')+'\n-----END '+label+'-----';
 if(!(privatePart?/^-----BEGIN (RSA )?PRIVATE KEY-----/:/^-----BEGIN (RSA )?PUBLIC KEY-----/).test(pem))fail('PAYMENT_KEY_INVALID',privatePart?'请填写有效的 RSA 私钥':'请填写支付平台提供的 RSA 公钥');
 try{const key=privatePart?createPrivateKey(pem):createPublicKey(pem);if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength!==2048)throw Error();return key}catch{fail('PAYMENT_KEY_INVALID',(privatePart?'私钥':'平台公钥')+'必须为有效的 RSA 2048 位密钥')}
}
export function validatePaymentKeys(provider,config,input,complete=false){
 const fields=secretFields({...config,provider}),keys=Object.fromEntries(fields.filter(name=>input[name]).map(name=>[name,input[name].trim()]));
 if(provider==='wechat-virtual'){
  for(const [name,value] of Object.entries(keys))if(!/^[\x21-\x7e]{1,256}$/.test(value))fail('PAYMENT_KEY_INVALID',formFieldLabels[name]+'须为 1–256 位可见 ASCII 字符，不能包含空格');
  if(keys.callbackToken&&!/^[A-Za-z0-9]{3,32}$/.test(keys.callbackToken))fail('PAYMENT_KEY_INVALID','消息Token须为 3–32 位英文字母或数字');
  if(keys.encodingAESKey&&(!/^[A-Za-z0-9+/]{43}$/.test(keys.encodingAESKey)||Buffer.from(keys.encodingAESKey+'=','base64').length!==32))fail('PAYMENT_KEY_INVALID','EncodingAESKey须为 43 位有效的 Base64 密钥');
  const missing=config.subjectType==='unknown'?'subjectType':['appId','offerId'].find(name=>!config[name])||requiredSecretFields({...config,provider}).find(name=>!keys[name]);
  if(complete&&missing)fail('PAYMENT_CONFIG_INCOMPLETE','请填写'+formFieldLabels[missing]);
  return keys;
 }
 for(const name of ['apiV2Key','apiV3Key'])if(keys[name]&&!/^[\x21-\x7e]{32}$/.test(keys[name]))fail('PAYMENT_KEY_INVALID',formFieldLabels[name]+'须为 32 位可见 ASCII 字符，不能包含空格');
 let privateKey,publicKey;
 if(keys.privateKey){privateKey=rsaPem(keys.privateKey,true);keys.privateKey=privateKey.export({type:'pkcs8',format:'pem'});const probe=Buffer.from('payment-config-self-check');if(!verify('RSA-SHA256',probe,createPublicKey(privateKey),sign('RSA-SHA256',probe,privateKey)))fail('PAYMENT_KEY_INVALID','私钥签名自检未通过')}
 if(keys.publicKey){publicKey=rsaPem(keys.publicKey,false);keys.publicKey=publicKey.export({type:'spki',format:'pem'});if(privateKey&&keys.publicKey===createPublicKey(privateKey).export({type:'spki',format:'pem'}))fail('PAYMENT_KEY_INVALID','验签公钥应来自支付平台，不能填写自己的应用或商户公钥')}
 if(keys.merchantCertificate){try{const cert=new X509Certificate(keys.merchantCertificate),now=Date.now();if(now<Date.parse(cert.validFrom)||now>=Date.parse(cert.validTo)||!cert.subject.split('\n').some(v=>v==='CN='+config.mchId)||privateKey&&!cert.checkPrivateKey(privateKey))throw Error();keys.merchantCertificate=cert.toString()}catch{fail('PAYMENT_KEY_INVALID','商户证书无效、已到期或与商户号/私钥不匹配')}}
 const requiredConfig=provider==='alipay'?['appId','sellerId']:config.apiVersion==='V2'?['mchId','appId']:['mchId','appId','serialNo','publicKeyId'];
 const missing=requiredConfig.find(name=>!config[name])||fields.find(name=>!keys[name]);
 if(complete&&missing)fail('PAYMENT_CONFIG_INCOMPLETE','请填写'+formFieldLabels[missing]);
 return keys;
}
