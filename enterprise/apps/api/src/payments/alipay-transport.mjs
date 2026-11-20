import {sign,verify} from 'node:crypto';
import {GatewayError} from './wechat-transport.mjs';

const gateway='https://openapi.alipay.com/gateway.do';
const methods=new Set(['alipay.trade.query','alipay.trade.close','alipay.trade.refund','alipay.trade.fastpay.refund.query']);
export const alipayTime=date=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
export function alipayDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))throw new GatewayError('ALIPAY_TIME_INVALID');
 const date=new Date(value.replace(' ','T')+'+08:00');if(!Number.isFinite(date.getTime())||alipayTime(date)!==value)throw new GatewayError('ALIPAY_TIME_INVALID');return date.toISOString();
}
export function alipayCents(value){
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(value))throw new GatewayError('ALIPAY_AMOUNT_INVALID');
 const [whole,decimal='']=value.split('.'),n=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new GatewayError('ALIPAY_AMOUNT_INVALID');return Number(n);
}
export function alipayMoney(value){if(!Number.isSafeInteger(value)||value<0)throw new GatewayError('ALIPAY_AMOUNT_INVALID');return Math.trunc(value/100)+'.'+String(value%100).padStart(2,'0')}
export function alipaySignText(fields,notification=false){return Object.keys(fields).filter(k=>k!=='sign'&&(!notification||k!=='sign_type')&&fields[k]!==''&&fields[k]!=null).sort().map(k=>{if(typeof fields[k]!=='string')throw new GatewayError('ALIPAY_FIELDS_INVALID');return k+'='+fields[k]}).join('&')}

// Verify the exact bytes of the response object, not JSON.parse/stringify output.
// This also rejects duplicate envelope keys and ambiguous response envelopes.
export function alipayResponse(raw,method){
 const parsed=JSON.parse(raw),expected=method.replaceAll('.','_')+'_response',allowed=new Set([expected,'error_response','sign','alipay_cert_sn']),entries=new Map();let i=0;
 const ws=()=>{while(/\s/.test(raw[i]||'')&&i<raw.length)i++};
 const stringEnd=start=>{let n=start+1;for(;n<raw.length;n++){if(raw[n]==='\\'){n++;continue}if(raw[n]==='"')return n+1}throw new GatewayError('ALIPAY_RESPONSE_INVALID')};
 ws();if(raw[i++]!=='{')throw new GatewayError('ALIPAY_RESPONSE_INVALID');ws();
 while(raw[i]!=='}'){
  if(raw[i]!=='"')throw new GatewayError('ALIPAY_RESPONSE_INVALID');const end=stringEnd(i),key=JSON.parse(raw.slice(i,end));i=end;ws();if(raw[i++]!==':')throw new GatewayError('ALIPAY_RESPONSE_INVALID');ws();const start=i;
  if(raw[i]==='{'){let depth=0;for(;i<raw.length;i++){if(raw[i]==='"'){i=stringEnd(i)-1;continue}if(raw[i]==='{')depth++;if(raw[i]==='}'&&!--depth){i++;break}}if(depth)throw new GatewayError('ALIPAY_RESPONSE_INVALID')}
  else if(raw[i]==='"')i=stringEnd(i);else throw new GatewayError('ALIPAY_RESPONSE_INVALID');
  if(!allowed.has(key)||entries.has(key))throw new GatewayError('ALIPAY_RESPONSE_INVALID');entries.set(key,raw.slice(start,i));ws();if(raw[i]===','){i++;ws()}else if(raw[i]!=='}')throw new GatewayError('ALIPAY_RESPONSE_INVALID');
 }
 i++;ws();if(i!==raw.length||entries.has(expected)===entries.has('error_response')||typeof parsed.sign!=='string')throw new GatewayError('ALIPAY_RESPONSE_INVALID');
 const key=entries.has(expected)?expected:'error_response';if(!parsed[key]||typeof parsed[key]!=='object'||Array.isArray(parsed[key]))throw new GatewayError('ALIPAY_RESPONSE_INVALID');return{data:parsed[key],text:entries.get(key),signature:parsed.sign,isError:key==='error_response'};
}

export class AlipayTransport {
 constructor({fetcher=fetch,clock=()=>new Date()}={}){this.fetcher=fetcher;this.clock=clock}
 verify(text,signature,configs){if(typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)||signature.length>1024||!configs.some(c=>{try{return verify('RSA-SHA256',Buffer.from(text),c.publicKey,Buffer.from(signature,'base64'))}catch{return false}}))throw new GatewayError('ALIPAY_SIGNATURE_INVALID')}
 parameters(config,method,biz,extra={}){const fields={app_id:config.appId,method,format:'JSON',charset:'utf-8',sign_type:'RSA2',timestamp:alipayTime(this.clock()),version:'1.0',...extra,biz_content:JSON.stringify(biz)};return{...fields,sign:sign('RSA-SHA256',Buffer.from(alipaySignText(fields)),config.privateKey).toString('base64')}}
 cashier(config,{id,amount,description,expiresAt,returnUrl,notifyUrl}){return gateway+'?'+new URLSearchParams(this.parameters(config,'alipay.trade.wap.pay',{out_trade_no:id,total_amount:alipayMoney(amount),subject:Array.from(description).slice(0,40).join(''),product_code:'QUICK_WAP_WAY',seller_id:config.sellerId,time_expire:alipayTime(expiresAt),quit_url:returnUrl},{return_url:returnUrl,notify_url:notifyUrl})).toString()}
 async request(config,method,biz){
  if(!methods.has(method))throw new GatewayError('ALIPAY_METHOD_INVALID');let response;
  try{response=await this.fetcher(gateway,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=utf-8','Accept':'application/json'},body:new URLSearchParams(this.parameters(config,method,biz)).toString()})}catch{throw new GatewayError('ALIPAY_NETWORK_UNCONFIRMED')}
  const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.length;if(size>2*1024*1024)throw new GatewayError('ALIPAY_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk))}
  let receipt;try{receipt=alipayResponse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),method)}catch{throw new GatewayError('ALIPAY_RESPONSE_INVALID')}
  this.verify(receipt.text,receipt.signature,config.trusted||[config]);
  if(!response.ok||receipt.isError||receipt.data.code!=='10000'){const error=new GatewayError(receipt.data.code==='40004'&&receipt.data.sub_code==='ACQ.TRADE_NOT_EXIST'?'ALIPAY_TRADE_NOT_EXIST':'ALIPAY_REQUEST_REJECTED',response.status);error.authenticated=true;throw error}
  return receipt.data;
 }
 query(config,id){return this.request(config,'alipay.trade.query',{out_trade_no:id})}
 close(config,id){return this.request(config,'alipay.trade.close',{out_trade_no:id})}
 refund(config,p,r){return this.request(config,'alipay.trade.refund',{out_trade_no:p.id,trade_no:p.transactionId,out_request_no:r.id,refund_amount:alipayMoney(r.amount??p.amount),refund_reason:r.reason})}
 queryRefund(config,p,r){return this.request(config,'alipay.trade.fastpay.refund.query',{out_trade_no:p.id,trade_no:p.transactionId,out_request_no:r.id,query_options:['gmt_refund_pay']})}
 notification(raw,config){
  if(!Buffer.isBuffer(raw)||raw.length>262144)throw new GatewayError('ALIPAY_NOTICE_INVALID');const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),fields=Object.create(null);
  for(const pair of text.split('&')){const index=pair.indexOf('=');if(index<1)throw new GatewayError('ALIPAY_NOTICE_INVALID');const decode=v=>decodeURIComponent(v.replaceAll('+',' ')),key=decode(pair.slice(0,index)),value=decode(pair.slice(index+1));if(!/^[a-z_][a-z0-9_]{0,63}$/.test(key)||Object.hasOwn(fields,key))throw new GatewayError('ALIPAY_NOTICE_INVALID');fields[key]=value}
  if(fields.sign_type!=='RSA2'||fields.charset?.toLowerCase()!=='utf-8')throw new GatewayError('ALIPAY_NOTICE_INVALID');this.verify(alipaySignText(fields,true),fields.sign,config.trusted||[config]);return fields;
 }
}
