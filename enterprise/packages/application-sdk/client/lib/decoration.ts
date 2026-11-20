import {api,apiUrl,ApiError,ensureSession,getToken,identityScope,isH5,isClientPreview,isSignedOut,consumerLogin} from './api'
import {decorationActions} from '@qicore/application-sdk/browser/decoration-framework.mjs'
import {runtimeConfig} from './runtime-config'
import {readWallet} from './wallet'
import {decorationImageIds,decorationTargets,normalizeDecorationScheme} from '@qicore/application-sdk/browser/decoration-contract.mjs'
import {isDecorationWebUrl} from '@qicore/application-sdk/browser/decoration-links.mjs'
import type {CustomerServiceConfig,DecorationApplicationAssets,DecorationApplicationComponent,DecorationLink,DecorationScheme,DecorationRoute,DecorationMember,DecorationProfile} from '@qicore/application-sdk/browser/decoration-types'
function siteScope(){const r=runtimeConfig();return [r.apiBase,r.tenantId,r.applicationKey].join('|')}
export function decorationScope(){return [siteScope(),identityScope(),getToken(),isSignedOut()].join('|')}
export async function loadDecoration(page:'home'|'profile'='home'){
 const site=siteScope(),base=runtimeConfig().apiBase
 let scope=decorationScope(),token=getToken()
 const assertCurrent=()=>{if(scope!==decorationScope())throw new ApiError('SESSION_CHANGED','登录或站点状态已变化，请重新读取页面',token&&!getToken()?401:409)}
 if((!isClientPreview||isSignedOut())&&!getToken()){
  try{
  const runtime=runtimeConfig(),query='tenantId='+encodeURIComponent(runtime.tenantId)+'&applicationKey='+encodeURIComponent(runtime.applicationKey),value=await api<{defaultAvatar?:string|null;imageUrls?:Record<string,string>;customerService?:CustomerServiceConfig;assets?:DecorationApplicationAssets;components?:DecorationApplicationComponent[];scheme:DecorationScheme;configured:boolean;targets:DecorationRoute[];version:string;member:null;profile:null}>('/public/client/decoration?'+query),scheme=normalizeDecorationScheme(value.scheme),images:Record<string,string>={};
  for(const [name,asset] of Object.entries(value.assets||{}))images[name]=isH5?new URL(asset.web,location.origin).href:asset.client;
  assertCurrent();for(const id of decorationImageIds({...scheme,[page==='home'?'profile':'home']:{blocks:[]}}))images[id]=value.imageUrls?.[id]||base+'/public/client/images/'+encodeURIComponent(id)+'?'+query;
  for(const block of [...scheme.home.blocks,...scheme.profile.blocks])if(block.type==='profile')block.target='login';
  return{...value,member:null,profile:null,scope,scheme,images,sharing:{title:scheme[page].title,imageUrl:undefined as string|undefined}};
  }catch(e){assertCurrent();throw e}
 }
 await ensureSession({redirect:false});if(site!==siteScope())throw new ApiError('SESSION_CHANGED','站点已变化，请重新读取页面',409);scope=decorationScope();token=getToken()
 try{
 const data=await api<{defaultAvatar?:string|null;imageUrls?:Record<string,string>;customerService?:CustomerServiceConfig;assets?:DecorationApplicationAssets;components?:DecorationApplicationComponent[];scheme:DecorationScheme;member?:DecorationMember|null;profile?:DecorationProfile|null;version:string;configured:boolean;targets:DecorationRoute[]}>('/decoration'),images:Record<string,string>={};
 for(const [name,asset] of Object.entries(data.assets||{}))images[name]=isH5?new URL(asset.web,location.origin).href:asset.client;
 assertCurrent();if(data.member&&data.scheme[page].blocks.some(block=>block.enabled&&block.type==='assets')){const wallet=await readWallet();assertCurrent();data.member.accountAssets={points:wallet.points.amount,balanceCents:wallet.balance.amount};}
 const share=await api<{title:string;imagePath:string|null}>('/sharing/'+page).catch(()=>null);assertCurrent();const sharing={title:share?.title||data.scheme[page].title,imageUrl:share?.imagePath?base+share.imagePath:undefined};
 const ids=decorationImageIds({...data.scheme,[page==='home'?'profile':'home']:{blocks:[]}});
 for(let offset=0;offset<ids.length;offset+=6){assertCurrent();await Promise.all(ids.slice(offset,offset+6).map(id=>new Promise<void>(resolve=>{
  if(data.imageUrls?.[id]){images[id]=data.imageUrls[id]!;resolve();return}
  uni.downloadFile({url:apiUrl('/decoration/images/'+encodeURIComponent(id)),header:{Authorization:'Bearer '+token},success:r=>{if(r.statusCode===200)images[id]=r.tempFilePath;resolve()},fail:()=>resolve()})
 })))}
 assertCurrent();
 const scheme=normalizeDecorationScheme(data.scheme);for(const block of [...scheme.home.blocks,...scheme.profile.blocks])if(block.type==='profile'&&!block.target)block.target='system:profile';
 return {...data,scope,scheme,images,sharing};
 }catch(e){assertCurrent();throw e}
}
export function navigateDecoration(target:DecorationLink,current:string,targets:DecorationRoute[]=decorationTargets,root=false){
 if(!target||target===current)return;
 const fail=()=>uni.showToast({title:'暂时无法打开，请稍后重试',icon:'none'});
 const open=(url:string,replace=root)=>replace?uni.reLaunch({url,fail}):uni.navigateTo({url,fail});
 // Saved layouts can still contain the old logical entry; there is only one profile page.
 if(target==='settings'){open('/pages/personal/index');return}
 if(['member','system:recharge'].includes(String(target))){const pages:Record<string,string>={'member':'member','system:recharge':'recharge'};open('/pages/'+pages[String(target)]+'/index');return}
 if(target==='system:member-levels'){open('/pages/levels/index');return}
 if(target==='system:profile'){open('/pages/personal/index');return}
 if(target==='login'){consumerLogin();return}
 if(typeof target==='object'){
  if(target.type==='phone'){if(/^\+?\d{5,20}$/.test(target.number))uni.makePhoneCall({phoneNumber:target.number,fail});return}
  if(target.type==='mini'){if(/^wx[a-zA-Z0-9]{16}$/.test(target.appId)&&(!target.path||!target.path.includes('..')&&/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+(?:\?[^\s<>#]*)?$/.test(target.path)))uni.navigateToMiniProgram({appId:target.appId,path:target.path,fail});return}
  if(target.type!=='url')return;
  const registered=targets.find(r=>r.path===target.url);
  if(registered){navigateDecoration(registered.key,current,targets,root);return}
  if(isDecorationWebUrl(target.url)){if(isH5)location.assign(target.url);else open('/pages/webview/index?url='+encodeURIComponent(target.url))}return;
 }
 // The host maps public page keys to actual routes; the renderer never knows application paths.
 const path=targets.find(r=>r.key===target)?.path;
 if(!path&&Object.prototype.hasOwnProperty.call(decorationActions,target)){uni.showToast({title:'当前应用尚未接入此功能',icon:'none'});return}
 if(path&&/^\/pages\/[a-zA-Z0-9/_-]+(?:\?[a-zA-Z0-9_-]+=[a-zA-Z0-9_%.-]*(?:&[a-zA-Z0-9_-]+=[a-zA-Z0-9_%.-]*)*)?$/.test(path))open(path,root||['home','profile'].includes(target));
}
