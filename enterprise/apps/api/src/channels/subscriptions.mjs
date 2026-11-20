import {formValidationMessage} from '../core/form-validation.mjs';
import {z} from 'zod';
import {fail} from '../core/errors.mjs';
import {WechatMiniIdentity} from './wechat-mini.mjs';

export const subscriptionTemplate=z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/,'须为 1–128 个英文字母、数字、下划线或短横线');
export const subscriptionConfigured=value=>!!value?.templateId&&value?.fields?.length>=2;
export function subscriptionConfig(input,events){
 const schema=z.object({enabled:z.boolean(),templateId:z.union([z.literal(''),subscriptionTemplate]),fields:z.array(z.object({key:z.string().regex(/^(thing|phrase|character_string|time)[1-9][0-9]*$/,'须为 thing、phrase、character_string 或 time 加正整数编号，例如 thing1'),source:z.string()}).strict()).max(5)}).strict();
 const p=schema.safeParse(input);if(!p.success)fail('SUBSCRIPTION_INPUT_INVALID',formValidationMessage(p.error));const q=p.data,keys=new Set();
 q.fields.forEach((field,index)=>{
  if(keys.has(field.key))fail('SUBSCRIPTION_FIELDS_INVALID',`字段映射 / 第${index+1}项 / 字段名称不能重复`);
  keys.add(field.key);
  if(!events.fields.some(source=>source.value===field.source&&(source.type===field.key.replace(/\d+$/,'')||field.key.startsWith('phrase')&&field.source==='status')))fail('SUBSCRIPTION_FIELDS_INVALID',`字段映射 / 第${index+1}项 / 业务内容须与模板字段类型匹配`);
 });
 q.enabled=subscriptionConfigured(q);return q;
}
export function subscriptionData(fields,values){return Object.fromEntries(fields.map(({key,source})=>{const value=values[source];if(typeof value!=='string'||!value||[...value].length>(key.startsWith('thing')?20:key.startsWith('phrase')?5:key.startsWith('time')?19:32))fail('SUBSCRIPTION_PAYLOAD_INVALID','订阅消息字段超出模板限制');return[key,{value}]}))}
export class SubscriptionTransport {
 constructor(fetcher=fetch){this.fetcher=fetcher;this.identity=new WechatMiniIdentity(fetcher)}
 token(credentials){return this.identity.token(credentials)}
 async request(path,token,body){
  const response=await this.fetcher('https://api.weixin.qq.com'+path+(path.includes('?')?'&':'?')+'access_token='+encodeURIComponent(token),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(8000)});
  const reader=response.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw Error('WECHAT_TEMPLATE_RESPONSE_INVALID')}chunks.push(value)}const data=JSON.parse(Buffer.concat(chunks).toString());if(!response.ok||!data||data.errcode!==undefined&&data.errcode!==0)throw Error('WECHAT_TEMPLATE_REQUEST_FAILED');return data;
 }
 async templates(token){const r=await this.request('/wxaapi/newtmpl/gettemplate',token);if(!Array.isArray(r.data)||r.data.some(x=>typeof x?.priTmplId!=='string'||!subscriptionTemplate.safeParse(x.priTmplId).success||typeof x.title!=='string'||typeof x.content!=='string'||!Number.isSafeInteger(x.type)))throw Error('WECHAT_TEMPLATE_RESPONSE_INVALID');return r.data}
 async categories(token){const r=await this.request('/wxaapi/newtmpl/getcategory',token);if(!Array.isArray(r.data)||r.data.some(x=>!Number.isSafeInteger(x?.id)||x.id<1||typeof x.name!=='string'))throw Error('WECHAT_TEMPLATE_RESPONSE_INVALID');return r.data}
 async titles(token,ids,guard=async()=>{}){
  const deadline=Date.now()+60000,page=async start=>{await guard();if(Date.now()>deadline)throw Error('WECHAT_SELECTION_TIMEOUT');const r=await this.request('/wxaapi/newtmpl/getpubtemplatetitles?'+new URLSearchParams({ids:ids.join(','),start:String(start),limit:'30'}),token);if(!Number.isSafeInteger(r.count)||r.count<0||!Array.isArray(r.data))throw Error('WECHAT_TEMPLATE_RESPONSE_INVALID');const items=r.data.map(x=>({...x,categoryId:typeof x.categoryId==='string'&&/^\d+$/.test(x.categoryId)?Number(x.categoryId):x.categoryId}));if(items.some(x=>!Number.isSafeInteger(x.tid)||x.tid<1||!Number.isSafeInteger(x.categoryId)||x.categoryId<1||typeof x.title!=='string'||!Number.isSafeInteger(x.type)))throw Error('WECHAT_TEMPLATE_RESPONSE_INVALID');return{count:r.count,items}};
  const first=await page(0),rows=first.items;for(let start=30;start<first.count;start+=180){const pages=await Promise.all(Array.from({length:Math.min(6,Math.ceil((first.count-start)/30))},(_,i)=>page(start+i*30)));for(const p of pages)rows.push(...p.items)}return rows;
 }
 async keywords(token,tid){const r=await this.request('/wxaapi/newtmpl/getpubtemplatekeywords?tid='+tid,token);if(!Array.isArray(r.data)||r.data.some(x=>!Number.isSafeInteger(x?.kid)||x.kid<1||typeof x.name!=='string'||typeof x.rule!=='string'))throw Error('WECHAT_TEMPLATE_RESPONSE_INVALID');return r.data}
 async add(token,tid,kidList,sceneDesc){const r=await this.request('/wxaapi/newtmpl/addtemplate',token,{tid:String(tid),kidList,sceneDesc:[...sceneDesc].slice(0,15).join('')});if(!subscriptionTemplate.safeParse(r.priTmplId).success)throw Error('WECHAT_TEMPLATE_ADD_UNKNOWN');return r.priTmplId}
 async send(token,payload){
  const response=await this.fetcher('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,lang:'zh_CN'}),redirect:'error',signal:AbortSignal.timeout(8000)});
  const reader=response.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error('SUBSCRIPTION_UNCONFIRMED')}chunks.push(value)}
  const data=JSON.parse(Buffer.concat(chunks).toString());if(!response.ok||!Number.isSafeInteger(data.errcode))throw Error('SUBSCRIPTION_UNCONFIRMED');return{accepted:data.errcode===0,code:String(data.errcode)};
 }
}
