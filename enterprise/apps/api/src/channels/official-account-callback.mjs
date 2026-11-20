import {createHash,createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';
import {fail} from '../core/errors.mjs';
const invalid=()=>fail('OFFICIAL_CALLBACK_INVALID','公众号回调校验失败',403);
export const officialSignature=(...values)=>createHash('sha1').update(values.sort().join('')).digest('hex');
function verify(expected,actual){if(typeof actual!=='string'||!/^[a-f0-9]{40}$/.test(actual)||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))invalid()}
const cdata=value=>'<![CDATA['+String(value).replaceAll(']]>',']]]]><![CDATA[>')+']]>';
// WeChat callback messages use a flat XML envelope. Reject declarations, entities and nested structures.
export function officialXml(xml){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>65536||/<!DOCTYPE|<!ENTITY|<\?/.test(xml))invalid();const body=/^\s*<xml>\s*([\s\S]*?)\s*<\/xml>\s*$/.exec(xml)?.[1];if(body===undefined)invalid();const result={};let offset=0;
 const fields=/<([A-Za-z][A-Za-z0-9_]*)>([\s\S]*?)<\/\1>/g;for(const match of body.matchAll(fields)){if(body.slice(offset,match.index).trim()||Object.hasOwn(result,match[1]))invalid();const raw=match[2];if(raw.startsWith('<![CDATA[')&&raw.endsWith(']]>'))result[match[1]]=raw.slice(9,-3).replaceAll(']]]]><![CDATA[>',']]>');else{if(/[<&]/.test(raw))invalid();result[match[1]]=raw}offset=match.index+match[0].length}if(body.slice(offset).trim())invalid();return result;
}
export function officialEncrypt(xml,appId,encodingAESKey){
 const key=Buffer.from(encodingAESKey+'=','base64');if(key.length!==32)invalid();const length=Buffer.alloc(4);length.writeUInt32BE(Buffer.byteLength(xml));const body=Buffer.concat([randomBytes(16),length,Buffer.from(xml),Buffer.from(appId)]),padding=32-body.length%32,cipher=createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);return Buffer.concat([cipher.update(Buffer.concat([body,Buffer.alloc(padding,padding)])),cipher.final()]).toString('base64');
}
export function officialDecrypt(value,appId,encodingAESKey){
 try{if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value))invalid();const key=Buffer.from(encodingAESKey+'=','base64'),cipher=createDecipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);const padded=Buffer.concat([cipher.update(Buffer.from(value,'base64')),cipher.final()]),padding=padded.at(-1);if(padding<1||padding>32||!padded.subarray(-padding).every(v=>v===padding))invalid();const body=padded.subarray(0,-padding),length=body.readUInt32BE(16);if(length>65536||body.length<20+length||body.subarray(20+length).toString()!==appId)invalid();return body.subarray(20,20+length).toString()}catch{invalid()}
}
export function officialCallback(config,secrets,query,body,{now=Date.now(),onReply}={}){
 const {timestamp,nonce}=query;if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||typeof nonce!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(nonce))invalid();
 const encrypted=query.encrypt_type==='aes';if(body!==undefined&&(config.messageMode==='safe'&&!encrypted||config.messageMode==='plain'&&encrypted))invalid();
 let xml;if(encrypted){const ciphertext=body===undefined?query.echostr:officialXml(body).Encrypt;verify(officialSignature(secrets.token,timestamp,nonce,ciphertext||''),query.msg_signature);xml=officialDecrypt(ciphertext,config.appId,secrets.encodingAESKey)}else{verify(officialSignature(secrets.token,timestamp,nonce),query.signature);xml=body===undefined?query.echostr:body}
 if(body===undefined){if(typeof xml!=='string'||xml.length>4096)invalid();return xml}
 const message=officialXml(xml);if(config.originalId&&message.ToUserName!==config.originalId||!message.FromUserName||message.FromUserName.length>128||!message.ToUserName)invalid();
 let selected;const rules=config.replies;
 if(message.MsgType==='event'&&message.Event==='subscribe'&&rules.welcome.enabled)selected=rules.welcome;
 if(message.MsgType==='text')selected=rules.keywords.find(r=>r.enabled&&(r.match==='exact'?message.Content===r.keyword:message.Content?.includes(r.keyword)))||(rules.fallback.enabled?rules.fallback:null);
 if(!selected&&message.MsgType!=='event'&&rules.fallback.enabled)selected=rules.fallback;
 if(!selected)return'success';if(onReply){onReply(message,selected);return'success'}const text=selected.text;if(selected.type&&selected.type!=='text')return'success';if(!text)return'success';
 const reply='<xml><ToUserName>'+cdata(message.FromUserName)+'</ToUserName><FromUserName>'+cdata(message.ToUserName)+'</FromUserName><CreateTime>'+Math.floor(now/1000)+'</CreateTime><MsgType><![CDATA[text]]></MsgType><Content>'+cdata(text)+'</Content></xml>';
 if(!encrypted)return reply;const encryptedReply=officialEncrypt(reply,config.appId,secrets.encodingAESKey),signature=officialSignature(secrets.token,timestamp,nonce,encryptedReply);return'<xml><Encrypt>'+cdata(encryptedReply)+'</Encrypt><MsgSignature>'+cdata(signature)+'</MsgSignature><TimeStamp>'+timestamp+'</TimeStamp><Nonce>'+cdata(nonce)+'</Nonce></xml>';
}
