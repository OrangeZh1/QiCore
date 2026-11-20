import {decorationOptions,visibleDecorationItems,galleryLayout} from './decoration-options.mjs';
export const singleDecorationTypes=['assets','orders','profile','membership','member-level','member-overview','search','float','wechat-ad'];
export function canAddDecoration(blocks,type){return blocks.length<30&&(!singleDecorationTypes.includes(type)||!blocks.some(b=>b.type===type))}
/** Content completeness is advisory; structural and authorization checks remain server-side. */
export function decorationWarnings(scheme){
 const warnings=[];
 for(const page of ['home','profile'])for(const [index,b] of scheme[page].blocks.entries()){
  if(!b.enabled)continue;const items=b.items.filter(i=>i.enabled!==false);let incomplete=false;
  if(b.type==='image')incomplete=!b.imageId;
  if(b.type==='gallery')incomplete=b.items.length<galleryLayout(b).count||b.items.some(i=>!i.imageId&&!i.builtin);
  if(b.type==='banner')incomplete=!items.length||items.some(i=>!i.imageId&&!i.builtin);
  if(b.type==='links')incomplete=!items.length||items.some(i=>!i.target);
  if(b.type==='notice')incomplete=b.items.length? !items.length||items.some(i=>!i.text?.trim()):!b.text?.trim();
  if(b.type==='button')incomplete=!b.title||!b.target;
  if(b.type==='hot-area')incomplete=!b.imageId||!items.length||items.some(i=>!i.target);
  if(b.type==='rich-text')incomplete=!b.html?.replace(/<[^>]*>|&nbsp;|\s/g,'')&&!b.html?.includes('<img ');
  if(['float','activity'].includes(b.type))incomplete=!items.length||items.some(i=>(!i.imageId&&!i.builtin&&!(b.type==='float'&&i.icon))||!i.target);
  if(b.type==='showcase')incomplete=!b.panels?.length||b.panels.some(p=>p.items.some(i=>(!i.imageId&&!i.builtin)||!i.target));
  if(b.type==='search-box')incomplete=!b.title||(!b.options?.searchInput&&!b.target);
  if(b.type==='search')incomplete=!b.target||(b.options?.showSearchBanner!==false&&(!items.length||items.some(i=>!i.imageId)))||(b.options?.showSearchTabs!==false&&(b.tabs||[]).some(i=>!i.target));
  if(incomplete)warnings.push(`${page==='home'?'首页':'个人中心'}第 ${index+1} 个组件的内容、图片或跳转目标尚未补全`);
 }
 return warnings;
}
/** @param {import('./decoration-types.js').DecorationBlock[]} blocks
 * @returns {{block:import('./decoration-types.js').DecorationBlock,membership?:import('./decoration-types.js').DecorationBlock}[]} */
export function decorationRenderGroups(blocks){
 const groups=[];
 for(const block of blocks){const previous=groups[groups.length-1];if(block.type==='assets'&&block.enabled&&block.options?.assetMergeMembership&&previous?.block.enabled&&!previous.membership&&['membership','member-level','member-overview'].includes(previous.block.type)){groups.pop();groups.push({block,membership:previous.block})}else groups.push({block})}
 return groups;
}
export function hotspotStyle(item){return {left:(item.left??0)+'%',top:(item.top??0)+'%',width:(item.width??25)+'%',height:(item.height??25)+'%'}}
export function floatStyle(block,hasNavigation=true,preview=false){const o=decorationOptions(block),bottom=o.floatPosition.startsWith('bottom');return {position:preview?'absolute':'fixed',zIndex:20,[bottom?'bottom':'top']:bottom?'calc('+(o.floatOffset+80)+'px + env(safe-area-inset-bottom))':o.floatOffset+50+'px',[o.floatPosition.endsWith('left')?'left':'right']:o.floatSide+'px'}}
export function itemSurface(item){return {color:item.color||'#303133',background:'linear-gradient(135deg,'+(item.background||'#fff8f2')+','+(item.backgroundEnd||item.background||'#ffffff')+')'}}
export function subtitleStyle(block){const o=decorationOptions(block);return {color:o.subtitleColor,fontSize:o.subtitleSize+'px'}}
export function dividerStyle(block){const o=decorationOptions(block);return {borderTop:o.lineWidth+'px '+o.lineStyle+' '+block.color}}
/** Runtime identity is never stored in a decoration draft or replaced by sample member data. */
export function decorationProfile(profile){return {name:profile?(profile.nickname||'用户'):'点击登录',avatar:profile?.avatar||profile?.defaultAvatar||'',account:profile?.account||'',memberNumber:profile?.memberNumber||''}}
/** Compact level benefits only. Legacy subscription balances are never combined into assets. */
export function memberCardContent(block,member){
 return {title:['','套餐权益','会员概览'].includes(block.title)?'会员权益':block.title,
 subtitle:block.text==='会员额度与普通积分'?'':block.text,
 levelName:!member?'未登录':member.level===undefined?'等级待获取':member.level?.name||'未设置等级',
 action:block.options?.buttonText||(block.type==='member-level'?'查看等级':'查看权益'),target:block.target||member?.levelTarget||'system:member-levels'};
}
export function accountAssetItems(member,block={}){
 const assets=member?.accountAssets,o=decorationOptions(block);
 return [{key:'points',icon:'coins',label:o.assetPointsLabel||'积分',value:(assets?.points??0).toLocaleString(),action:'积分充值',target:'member'},
 {key:'balance',icon:'wallet',label:o.assetBalanceLabel||'余额（元）',value:((assets?.balanceCents??0)/100).toFixed(2),action:'余额充值',target:'system:recharge'}].filter(item=>item.key==='points'?o.assetPoints:o.assetBalance);
}
export function accountAssetStyle(block,primary){
 const o=decorationOptions(block),accent=o.assetTheme?primary:o.assetAccent;
 return {'--asset-unit':'1px','--asset-accent':accent,'--asset-surface':o.assetTheme?accent+'08':o.assetSurface,'--asset-soft':accent+'12','--asset-border':accent+'1a','--asset-text':o.assetTheme?'var(--client-text,#203450)':o.assetText,'--asset-muted':o.assetTheme?'var(--client-muted,#718198)':o.assetMuted,'--asset-value-size':o.assetValueSize+'px','--asset-label-size':o.assetLabelSize+'px','--asset-gap':o.assetGap+'px','--asset-radius':o.assetRadius+'px'};
}
export function memberCardStyle(block,primary){
 const o=decorationOptions(block),accent=o.memberTheme?primary:o.memberAccent;
 const rgb=o.memberSurface.slice(1).match(/../g).map(value=>parseInt(value,16)/255),dark=rgb.reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0)<.45;
 return {'--member-surface':o.memberSurface,'--member-elevated':dark?'#ffffff08':'#ffffff85','--member-elevated-border':dark?'#ffffff16':'#ffffffb3','--member-glow':dark?'#ffffff03':'#ffffff55','--member-icon-filter':dark?'brightness(0) invert(.85) sepia(.4)':'none','--member-accent':accent,'--member-soft':accent+'0d','--member-line':accent+'18','--member-muted':o.memberMuted,background:o.memberSurface,color:o.memberText,borderRadius:o.memberRadius+'px'};
}
export function searchBanner(block){return {...block,type:'banner',items:visibleDecorationItems(block)}}
export function richMediaHtml(html,imageUrl){return (html||'').replace(/\/decoration-media\/([0-9a-f-]{36})/gi,(_,id)=>String(imageUrl(id)||'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'))}
/** Same 375px design units: CSS container units in the editor, rpx in WeChat. */
export function decorationUnitStyle(style,mini=false){return Object.fromEntries(Object.entries(style).map(([key,value])=>[key,typeof value==='string'?value.replace(/(-?\d*\.?\d+)px\b/g,(_,n)=>mini?Number(n)*2+'rpx':'calc(var(--diy-unit, 1px) * '+n+')'):value]))}
export function immersiveDecoration(scheme,page){const first=scheme[page].blocks.find(b=>b.enabled);return first?.type==='banner'&&first.options?.sameScreen===true}

/** @param {import('./decoration-types.ts').DecorationBlock} block @param {import('./decoration-types.ts').DecorationApplicationComponent[]} [sources] @returns {import('./decoration-types.ts').DecorationApplicationComponent} */
export function collectionContent(block,sources=[]){
 const source=sources.find(item=>item.type===(block.options?.collectionSource||block.type));
 if(source)return source;
 return{type:'collection',label:'卡片列表',pages:['home','profile'],renderer:'collection',description:'',emptyText:block.options?.collectionSource?'当前数据来源暂无内容':'暂无内容',defaultBlock:block,items:block.options?.collectionSource?[]:block.items.filter(item=>item.enabled!==false).map(item=>({id:item.id,title:item.label,text:item.text||'',image:item.imageId||item.builtin||'',target:item.target}))};
}

/** @param {import('./decoration-types.ts').DecorationBlock} block @param {import('./decoration-types.ts').DecorationApplicationComponent} component */
export function collectionItems(block,component,query=''){
 const term=query.trim().toLocaleLowerCase(),limit=block.options?.collectionLimit??6;
 return component.items.filter(item=>!term||[item.title,item.text,item.searchText||''].join(' ').toLocaleLowerCase().includes(term)).slice(0,Number.isInteger(limit)&&limit>=1&&limit<=50?limit:6);
}
