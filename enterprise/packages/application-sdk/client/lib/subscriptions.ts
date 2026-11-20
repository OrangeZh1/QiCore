import {api,identityScope,isDevelopmentLogin,isH5,ApiError} from './api'
export type SubscriptionOptions={targetId:string;attempt:number;version:number;templateIds:string[];recorded:boolean;choices:Record<string,string>;terminal:boolean}
export const subscriptionOptions=(id:string)=>isDevelopmentLogin||isH5?Promise.resolve(null):api<SubscriptionOptions>('/subscriptions/'+encodeURIComponent(id))
export function subscribeToJob(options:SubscriptionOptions):Promise<{recorded:boolean;choices:Record<string,string>}>{
 const identity=identityScope(),storageKey='zjz-subscription:'+identity+':'+options.targetId+':'+options.attempt
 const assertIdentity=()=>{if(identityScope()!==identity)throw new ApiError('SUBSCRIPTION_IDENTITY_CHANGED','登录身份已变化，请重新进入任务',409)}
 const persist=async(body:{version:number;attempt:number;choices:Record<string,string>})=>{assertIdentity();uni.setStorageSync(storageKey,body);const result=await api<{recorded:boolean;choices:Record<string,string>}>('/subscriptions/'+encodeURIComponent(options.targetId),'POST',body);assertIdentity();uni.removeStorageSync(storageKey);return result}
 const pending=uni.getStorageSync(storageKey)
 if(pending?.attempt===options.attempt)return persist(pending)
 if(isDevelopmentLogin||isH5||!options.templateIds.length||options.templateIds.length>3)return Promise.reject(new ApiError('SUBSCRIPTION_UNAVAILABLE','当前任务没有可订阅的通知',409))
 // Invoke the SDK directly in the click handler, before awaiting network requests.
 return new Promise<Record<string,string>>((resolve,reject)=>uni.requestSubscribeMessage({tmplIds:options.templateIds,success:result=>resolve(Object.fromEntries(options.templateIds.map(id=>[id,String((result as unknown as Record<string,unknown>)[id])]))),fail:()=>reject(new ApiError('SUBSCRIPTION_NOT_COMPLETED','订阅未完成，可继续查看制作结果',400))})).then(choices=>persist({version:options.version,attempt:options.attempt,choices}))
}
