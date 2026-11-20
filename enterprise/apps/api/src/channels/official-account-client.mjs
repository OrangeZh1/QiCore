import {WechatMiniIdentity} from './wechat-mini.mjs';
import {fail} from '../core/errors.mjs';
export class OfficialAccountClient {
 constructor(fetcher=fetch){this.fetcher=fetcher;this.identity=new WechatMiniIdentity(fetcher)}
 token(credentials){return this.identity.token(credentials)}
 async call(path,token,body,params={}){
  let data;try{const response=await this.fetcher('https://api.weixin.qq.com/cgi-bin/'+path+'?'+new URLSearchParams({access_token:token,...params}),{method:'POST',body:body instanceof FormData?body:JSON.stringify(body),...(body instanceof FormData?{}:{headers:{'Content-Type':'application/json'}}),redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok||!response.body)throw Error();let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>65536)throw Error();chunks.push(Buffer.from(chunk))}data=JSON.parse(Buffer.concat(chunks).toString())}catch{fail('OFFICIAL_RESULT_UNKNOWN','微信请求结果未确认，请先核对微信后台',503)}
  if(data?.errcode){const error=new Error('微信拒绝请求');error.code='OFFICIAL_PROVIDER_REJECTED';error.providerCode=String(data.errcode).slice(0,30);throw error}return data;
 }
 async upload(token,kind,bytes,mime){const form=new FormData();form.append('media',new Blob([bytes],{type:mime}),kind==='video'?'video.mp4':'image.jpg');const data=await this.call('media/upload',token,form,{type:kind});if(typeof data?.media_id!=='string'||!data.media_id)fail('OFFICIAL_RESULT_UNKNOWN','微信素材上传结果未确认',503);return data.media_id}
 async imageUrl(token,bytes,mime){const form=new FormData();form.append('media',new Blob([bytes],{type:mime}),'image.jpg');const data=await this.call('media/uploadimg',token,form);if(typeof data?.url!=='string'||!/^https?:\/\//.test(data.url))fail('OFFICIAL_RESULT_UNKNOWN','微信图片上传结果未确认',503);return data.url}
 async send(token,payload){const data=await this.call('message/custom/send',token,payload);if(data?.errcode!==0)fail('OFFICIAL_RESULT_UNKNOWN','微信消息发送结果未确认',503)}
 async menu(token,payload){const data=await this.call('menu/create',token,payload);if(data?.errcode!==0)fail('OFFICIAL_RESULT_UNKNOWN','微信菜单发布结果未确认',503)}
}
