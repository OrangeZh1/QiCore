declare const __QICORE_APPLICATION_KEY__: string
// Resolve server image references only for display; forms keep the original reference for saving.
export function clientImageUrl(value:string|null|undefined){
 return value?.startsWith('/api/v1/')?runtimeConfig().apiBase.replace(/\/$/,'')+value.slice('/api/v1'.length):value||''
}
// mp-html resolves root-relative media against this domain; H5 keeps same-origin paths.
export function clientImageDomain(){return runtimeConfig().apiBase.replace(/\/api\/v1\/?$/,'')}
// License injects this file after compilation; never import runtime.json into the bundle.
export function runtimeConfig(){
 if(import.meta.env.UNI_PLATFORM==='h5'){
  let value:any;try{value=JSON.parse(document.getElementById('qicore-h5-runtime')?.textContent||'')}catch{throw Error('H5 站点配置缺失，请从站点入口重新打开')}
  if(value.applicationKey!==__QICORE_APPLICATION_KEY__||value.apiBase!=='/api/v1'||!/^[a-zA-Z0-9_-]{1,64}$/.test(value.tenantId||'')||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.applicationKey||'')||!/^\/(?:h5\/[a-zA-Z0-9_-]{1,64}\/)?$/.test(value.basePath||''))throw Error('H5 站点配置无效')
  return{...value,appId:''} as {apiBase:string;tenantId:string;applicationKey:string;appId:string;basePath:string;siteName:string;homeTitle:string;profileTitle:string;titles:Record<string,string>;registration:{passwordLoginEnabled:boolean;autoRegister:boolean}}
 }
 if(import.meta.env.DEV){
  let appId='';try{appId=uni.getAccountInfoSync().miniProgram.appId}catch{}
  if(!/^wx[a-f0-9]{16}$/i.test(appId)||appId==='wx0000000000000000')appId=''
  return{apiBase:import.meta.env.VITE_API_BASE||'http://127.0.0.1:3500/api/v1',tenantId:import.meta.env.VITE_TENANT_ID||'',applicationKey:__QICORE_APPLICATION_KEY__,appId}
 }
 let value:any
 try{value=JSON.parse(String(uni.getFileSystemManager().readFileSync('static/runtime.json','utf8')))}catch{throw new Error('小程序发布配置缺失，请从后台重新上传')}
 if(!/^wx[a-f0-9]{16}$/i.test(value.appId||'')||value.appId==='wx0000000000000000'||!/^[a-zA-Z0-9_-]{1,64}$/.test(value.siteId||'')||!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}\/?$/i.test(value.apiDomain||'')||/\.(invalid|localhost|local|internal|test|example|lan|home|arpa)\/?$/i.test(value.apiDomain))throw new Error('小程序发布配置无效，请从后台重新上传')
 if(uni.getAccountInfoSync().miniProgram.appId!==value.appId)throw new Error('当前小程序与发布配置不一致，请重新上传')
 return{apiBase:value.apiDomain.replace(/\/$/,'')+'/api/v1',tenantId:value.siteId,applicationKey:__QICORE_APPLICATION_KEY__,appId:value.appId}
}
