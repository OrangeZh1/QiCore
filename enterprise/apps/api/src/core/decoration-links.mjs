import {decorationActions} from './decoration-framework.mjs';
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[<>\u0000-\u001f\u007f]/.test(v);
function exact(value,keys){return Object.keys(value).every(k=>keys.includes(k))}
/** Pure link contract shared by the selector and server. No arbitrary code or server-side URL fetches. */
export function normalizeDecorationLink(value,targets){
 if(typeof value==='string'){if(!value||Object.prototype.hasOwnProperty.call(decorationActions,value)||targets.some(t=>t.key===value))return value;throw Error('请选择当前应用中可用的页面')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('链接格式无效');
 if(value.type==='url'&&exact(value,['type','label','url'])){
  if(!text(value.label,30)||!value.label.trim()||!text(value.url,2048))throw Error('请填写链接名称和有效地址');const url=value.url.trim();
  if(url.startsWith('/')){if(!targets.some(t=>t.path===url))throw Error('站内路径须与已注册页面路径一致');return {type:'url',label:value.label.trim(),url}}
  let parsed;try{parsed=new URL(url)}catch{throw Error('请输入有效的 HTTPS 地址')}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||!parsed.hostname||!isDecorationWebUrl(parsed.href))throw Error('网页链接须为不带账号信息的 HTTPS 地址');
  return {type:'url',label:value.label.trim(),url:parsed.href};
 }
 if(value.type==='mini'&&exact(value,['type','appId','path'])){
  if(typeof value.appId!=='string'||!/^wx[a-zA-Z0-9]{16}$/.test(value.appId)||!text(value.path,512))throw Error('请填写有效的小程序 AppID 和路径');
  const path=value.path.trim().replace(/^\//,'');if(path&&(path.includes('..')||! /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+(?:\?[^\s<>#]*)?$/.test(path)))throw Error('请输入有效的小程序页面路径，留空打开其首页');
  return {type:'mini',appId:value.appId,path};
 }
 if(value.type==='phone'&&exact(value,['type','number'])){
  if(!text(value.number,30))throw Error('电话号码无效');const number=value.number.replace(/[ -]/g,'');if(!/^\+?\d{5,20}$/.test(number))throw Error('请输入手机号或固定电话号码');return {type:'phone',number};
 }
 throw Error('不支持的链接类型');
}
export function decorationLinkLabel(value,targets=[]){if(typeof value==='string')return targets.find(t=>t.key===value)?.label||decorationActions[value]||(value?'页面已失效':'不跳转');if(value?.type==='url')return value.label;if(value?.type==='mini')return '跳转小程序';if(value?.type==='phone')return '拨打电话';return '不跳转'}
export function decorationLinkDetail(value,targets=[]){if(typeof value==='string')return targets.find(t=>t.key===value)?.path||'';if(value?.type==='url')return value.url;if(value?.type==='mini')return value.appId+(value.path?' / '+value.path:'');if(value?.type==='phone')return value.number;return ''}

// Small runtime guard also works in mini-program runtimes without the browser URL global.
export function isDecorationWebUrl(value){return typeof value==='string'&&value.length<=2048&&/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\s<>\\]*)?$/.test(value)&&!/[\u0000-\u001f\u007f]/.test(value)}
