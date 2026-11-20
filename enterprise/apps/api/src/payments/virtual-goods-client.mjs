import {createHmac} from 'node:crypto';
import {WechatMiniIdentity} from '../channels/wechat-mini.mjs';
import {fail} from '../core/errors.mjs';

const methods=['start_upload_goods','query_upload_goods','start_publish_goods','query_publish_goods','query_order','refund_order','notify_provide_goods'];
export function virtualPaymentParameters(config,signData,sessionKey){
  return{mode:'short_series_goods',signData,paySig:createHmac('sha256',config.appKey).update('requestVirtualPayment&'+signData).digest('hex'),signature:createHmac('sha256',sessionKey).update(signData).digest('hex')};
}
export class VirtualGoodsClient {
  constructor({fetcher=fetch,identity=new WechatMiniIdentity(fetcher)}={}){this.fetcher=fetcher;this.identity=identity}
  async call(credentials,method,payload){
    if(!methods.includes(method)||![0,1].includes(payload.env)||payload.env!==credentials.env)fail('VIRTUAL_REQUEST_INVALID','虚拟商品请求无效');
    const accessToken=await this.identity.token(credentials),path='/xpay/'+method,body=JSON.stringify(payload);
    const paySig=createHmac('sha256',credentials.appKey).update(path+'&'+body).digest('hex');
    let data;
    try{
      const response=await this.fetcher('https://api.weixin.qq.com'+path+'?'+new URLSearchParams({access_token:accessToken,...(method==='notify_provide_goods'?{}:{pay_sig:paySig})}),{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok||!response.body)throw Error();let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>1048576)throw Error();chunks.push(Buffer.from(chunk))}data=JSON.parse(Buffer.concat(chunks).toString());
      if(!data||!Number.isInteger(data.errcode))throw Error();
    }catch{fail('VIRTUAL_RESULT_UNKNOWN','微信接口结果未确认，请查询原任务进度',503)}
    if(data.errcode!==0){const error=new Error('微信虚拟商品接口拒绝请求');error.code='VIRTUAL_PROVIDER_REJECTED';error.providerCode=data.errcode;throw error}
    return data;
  }
}
