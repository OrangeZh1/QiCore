import {timingSafeEqual} from 'node:crypto';
import {officialXml,officialSignature,officialDecrypt} from '../channels/official-account-callback.mjs';
import {fail} from '../core/errors.mjs';
const invalid=()=>fail('VIRTUAL_NOTICE_INVALID','虚拟支付通知校验失败',403);

// A bounded XML subset: elements + text/CDATA only, no attributes, DTD,
// processing instructions, duplicate keys or prototype-bearing field names.
export function virtualXml(xml){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>65536||/<!DOCTYPE|<!ENTITY|<\?/.test(xml))invalid();let at=0,count=0;
 const ws=()=>{while(/\s/.test(xml[at]||'')&&at<xml.length)at++};
 function element(depth){
  ws();const start=/^<([A-Za-z][A-Za-z0-9_]*)>/.exec(xml.slice(at));if(!start||depth>4||++count>80||['__proto__','constructor','prototype'].includes(start[1]))invalid();const name=start[1];at+=start[0].length;const children=Object.create(null);let value='',nested=false;
  for(;;){if(at>=xml.length)invalid();if(xml.startsWith('</'+name+'>',at)){at+=name.length+3;if(nested&&value.trim())invalid();return[name,nested?children:value]}
   if(xml.startsWith('<![CDATA[',at)){const end=xml.indexOf(']]>',at+9);if(end<0)invalid();value+=xml.slice(at+9,end);at=end+3;continue}
   if(xml[at]==='<'){const [key,child]=element(depth+1);if(Object.hasOwn(children,key))invalid();children[key]=child;nested=true;continue}
   const end=xml.indexOf('<',at);if(end<0)invalid();const text=xml.slice(at,end);if(/&/.test(text))invalid();value+=text;at=end;
  }
 }
 const [root,result]=element(0);ws();if(root!=='xml'||at!==xml.length||typeof result!=='object')invalid();return result;
}

export function virtualCallback(config,keys,query,raw){
 const {timestamp,nonce,msg_signature}=query;if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||typeof nonce!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(nonce)||!keys.callbackToken||!keys.encodingAESKey)invalid();
 if(raw===undefined&&!msg_signature){const {signature,echostr}=query;if(typeof signature!=='string'||!/^[a-f0-9]{40}$/.test(signature)||typeof echostr!=='string'||echostr.length>4096||!timingSafeEqual(Buffer.from(signature),Buffer.from(officialSignature(keys.callbackToken,timestamp,nonce))))invalid();return echostr}
 if(typeof msg_signature!=='string'||!/^[a-f0-9]{40}$/.test(msg_signature))invalid();
 if(raw!==undefined&&query.encrypt_type!=='aes')invalid();const encrypted=raw===undefined?query.echostr:officialXml(raw).Encrypt;
 if(typeof encrypted!=='string'||!timingSafeEqual(Buffer.from(msg_signature),Buffer.from(officialSignature(keys.callbackToken,timestamp,nonce,encrypted))))invalid();
 const text=officialDecrypt(encrypted,config.appId,keys.encodingAESKey);if(raw===undefined){if(text.length>4096)invalid();return text}
 return virtualXml(text);
}
