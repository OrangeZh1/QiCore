import {levelProgress} from './member-level-progress.mjs';
// Framework presentation only. Applications resolve these actions to their own workflows.
export const decorationActions={
 'system:profile':'个人资料','system:security':'账号安全','system:privacy':'隐私协议','system:about':'关于我们',
 'system:membership':'会员权益','system:orders':'全部订单','system:orders-unpaid':'待付款',
 'system:orders-unshipped':'待发货','system:orders-unreceived':'待收货','system:orders-refund':'售后/退款',
};
export const decorationIconGroups=[{"label":"常用","items":[{"value":"house","label":"首页"},{"value":"layout-grid","label":"应用"},{"value":"user-round","label":"用户"},{"value":"users","label":"用户组"},{"value":"settings","label":"设置"},{"value":"search","label":"搜索"},{"value":"menu","label":"菜单"},{"value":"info","label":"说明"},{"value":"circle-help","label":"帮助"},{"value":"bell","label":"通知"},{"value":"bookmark","label":"收藏夹"},{"value":"heart","label":"喜欢"}]},{"label":"交易","items":[{"value":"wallet","label":"钱包"},{"value":"credit-card","label":"支付"},{"value":"shopping-cart","label":"购物车"},{"value":"shopping-bag","label":"购物袋"},{"value":"store","label":"店铺"},{"value":"package","label":"包裹"},{"value":"truck","label":"运输"},{"value":"receipt-text","label":"订单"},{"value":"rotate-ccw","label":"退款"},{"value":"circle-x","label":"取消"},{"value":"ticket","label":"优惠券"},{"value":"gift","label":"礼物"},{"value":"coins","label":"积分"}]},{"label":"会员","items":[{"value":"crown","label":"会员"},{"value":"badge-check","label":"认证"},{"value":"star","label":"收藏"},{"value":"award","label":"奖励"},{"value":"medal","label":"勋章"},{"value":"gem","label":"钻石"},{"value":"user-plus","label":"添加用户"},{"value":"contact","label":"联系人"},{"value":"log-in","label":"登录"},{"value":"log-out","label":"退出"},{"value":"shield-check","label":"安全认证"},{"value":"lock-keyhole","label":"安全"}]},{"label":"内容","items":[{"value":"image","label":"图片"},{"value":"images","label":"相册"},{"value":"camera","label":"拍照"},{"value":"video","label":"视频"},{"value":"file-text","label":"协议"},{"value":"folder","label":"文件夹"},{"value":"book-open","label":"阅读"},{"value":"newspaper","label":"资讯"},{"value":"palette","label":"装修"},{"value":"paintbrush","label":"绘画"},{"value":"scan","label":"扫描"},{"value":"qr-code","label":"二维码"}]},{"label":"服务","items":[{"value":"phone","label":"电话"},{"value":"mail","label":"邮件"},{"value":"message-circle","label":"消息"},{"value":"headphones","label":"客服"},{"value":"map-pin","label":"位置"},{"value":"calendar-days","label":"日历"},{"value":"clock","label":"时间"},{"value":"globe","label":"网站"},{"value":"cloud","label":"云服务"},{"value":"download","label":"下载"},{"value":"upload","label":"上传"},{"value":"share-2","label":"分享"}]},{"label":"方向","items":[{"value":"arrow-right","label":"前往"},{"value":"arrow-left","label":"返回"},{"value":"arrow-up","label":"向上"},{"value":"arrow-down","label":"向下"},{"value":"chevron-right","label":"右箭头"},{"value":"chevron-left","label":"左箭头"},{"value":"chevron-up","label":"上箭头"},{"value":"chevron-down","label":"下箭头"},{"value":"external-link","label":"外部链接"},{"value":"refresh-cw","label":"刷新"},{"value":"plus","label":"添加"},{"value":"check","label":"完成"}]}];
export const decorationIcons=decorationIconGroups.flatMap(group=>group.items.map(item=>item.value));
export const decorationIconLabels=Object.fromEntries(decorationIconGroups.flatMap(group=>group.items.map(item=>[item.value,item.label])));
// Keep older SDK callers compatible while using files accepted by WeChat CI.
const clientImageAliases={'avatar.webp':'avatar.png','intro.webp':'intro.png'};
export const frameworkAsset=(name,mini=false)=>(mini?'/static/decoration/framework/':'/decoration/framework/')+(mini?clientImageAliases[name]||name:name);
export const decorationIconUrl=(name,mini=false)=>decorationIcons.includes(name)?frameworkAsset('icons/'+name+'.svg',mini):'';
export const frameworkActionTargets=Object.entries(decorationActions).map(([key,label])=>({key,label,path:'',group:'系统功能',source:'system'}));
export const systemDecorationTemplates=scheme=>[{id:'framework-default',kind:/** @type {'template'} */('template'),source:/** @type {'system'} */('system'),name:'框架默认方案',scheme,coverId:null,groupId:null,updatedAt:''}];
/** Undefined means an editor example, while null is an explicit guest/unavailable state. */
export function decorationPreviewMember(profile,member){return profile===undefined&&member===undefined?{accountAssets:{points:0,balanceCents:0,demo:true},active:true,points:128,memberPoints:30,expiresAt:null,target:'system:membership',level:{id:'preview-silver',name:'白银会员',threshold:100},growth:360,nextState:'automatic',nextLevel:{id:'preview-gold',name:'黄金会员',threshold:1000,description:'成长值达到 1,000',upgradeMode:'all',criteria:levelProgress({growth:1000},{growth:360})}}:member??null}
/** @returns {import('./decoration-types.ts').DecorationOptions} */
export function memberPalettePreset(palette){return palette==='gold'?{memberStyle:'gold',memberTheme:false,memberAccent:'#ffa336',memberSurface:'#fff3df',memberText:'#8c490b',memberMuted:'#b0773b',showMemberStatus:false}:palette==='dark'?{memberStyle:'plain',memberTheme:false,memberAccent:'#e8ce9e',memberSurface:'#222e40',memberText:'#fff9ef',memberMuted:'#b9c4d5'}:palette==='soft'?{memberStyle:'plain',memberTheme:true,memberSurface:'#f0f4fc',memberText:'#24344d',memberMuted:'#586b87'}:{memberStyle:'plain',memberTheme:true,memberSurface:'#ffffff',memberText:'#0f172a',memberMuted:'#64748b'}}
export function memberLayoutPreset(layout){return {memberLayout:layout,...memberPalettePreset(layout)}}
const item=(id,label,icon,target='',text='')=>({id,label,icon,target,text,imageId:null});
/** Applications advertise only destinations they actually implement. Never replace custom entries. */
export function fillOrderDefaults(block,routes=[],append=false){
 if(block.type!=='orders')return block;
 if(!block.target)block.target=routes.find(route=>route.orderEntry==='all')?.key||'';
 if(!block.items.length||append){
  const targets=new Set(block.items.map(entry=>typeof entry.target==='string'?entry.target:entry.target?.type==='url'?routes.find(route=>route.path===entry.target.url)?.key:''));
  for(const route of routes.filter(route=>route.orderEntry==='shortcut')){
   if(block.items.length>=8)break;if(targets.has(route.key))continue;
   let index=block.items.length;while(block.items.some(entry=>entry.id===block.id+'-order-'+index))index++;
   block.items.push(item(block.id+'-order-'+index,route.label,route.icon||'receipt-text',route.key));targets.add(route.key);
  }
 }
 return block;
}
/** The short-lived services block is now an ordinary graphic navigation block. */
export function migrateServiceBlock(block){
 if(block.type!=='services')return block;
 const {serviceLayout,...options}=block.options||{};
 return {...block,type:'links',appearance:{...block.appearance,columns:4,layout:serviceLayout==='grid'?'grid':'list'},options:{...options,navMode:'graphic',navRows:1,navDisplay:'fixed',iconSize:40,labelSize:12}};
}
export function frameworkBlockDefaults(block){
 if(['intro','features','orders'].includes(block.type)){
  block.inheritTheme=true;block.appearance={...block.appearance,padding:16,gap:12,radius:12,transparent:false};
 }
 if(block.type==='links'){block.inheritTheme=true;Object.assign(block.appearance,{padding:0,transparent:false,marginHorizontal:10,marginTop:12,marginBottom:12,radiusTop:12,radiusBottom:12});block.items.forEach((entry,index)=>entry.icon=['layout-grid','crown','file-text','info'][index%4]);}
 if(block.type==='notice'){block.inheritTheme=true;Object.assign(block.appearance,{padding:0,transparent:false,marginHorizontal:10,marginTop:10,marginBottom:12,radius:12,radiusTop:12,radiusBottom:12});}
 if(['banner','gallery','hot-area','image'].includes(block.type))Object.assign(block.appearance,{padding:0,marginHorizontal:10,marginTop:10,marginBottom:12,radius:12,radiusTop:12,radiusBottom:12});
 if(block.type==='rich-text'){block.inheritTheme=true;Object.assign(block.appearance,{padding:16,transparent:false,marginHorizontal:10,marginTop:10,marginBottom:12,radius:12,radiusTop:12,radiusBottom:12});}
 if(block.type==='search-box')Object.assign(block.appearance,{marginHorizontal:10,marginTop:10,marginBottom:12});
 if(block.type==='profile'){block.title='会员信息';Object.assign(block.appearance,{radiusTop:0,radiusBottom:0});}
 if(block.type==='intro')Object.assign(block,{title:'让应用开发\n更简单',text:'统一底座，灵活构建你的应用',target:'profile',options:{eyebrow:'多应用开发框架',buttonText:'体验个人中心'},appearance:{...block.appearance,padding:0,transparent:true,radiusTop:0,radiusBottom:0}});
 if(block.type==='features')Object.assign(block,{appearance:{...block.appearance,marginHorizontal:10,marginTop:12,marginBottom:12},title:'框架能力',text:'账号、素材与渠道能力统一复用',items:[
  item('applications','多租户 · 多应用','layout-grid','','站点独立管理，按需接入应用'),
  item('members','用户与会员','user-round','','统一用户资料、积分与会员权益'),
  item('payments','交易与支付','wallet','','通用订单、退款与支付渠道'),
  item('decoration','可视化装修','palette','','自由编排页面、主题与底部导航'),
 ]});
 if(block.type==='orders'){Object.assign(block,{title:'订单中心',items:[]});Object.assign(block.appearance,{marginHorizontal:10,marginTop:0,marginBottom:12});}
 if(block.type==='member-overview'){block.title='会员概览';block.icon='award';Object.assign(block.appearance,{marginHorizontal:10,marginTop:0,marginBottom:12});block.options={...memberLayoutPreset('soft')};}
 if(block.type==='member-level'){block.title='会员等级';block.icon='award';Object.assign(block.appearance,{marginHorizontal:10,marginTop:0,marginBottom:12});block.options={memberLayout:'soft',...memberLayoutPreset('soft')};}
 if(['membership','assets'].includes(block.type)){Object.assign(block.appearance,{padding:0,marginHorizontal:10,marginTop:0,marginBottom:12,transparent:true});block.options={...block.options,memberLayout:'compact'};if(block.type==='assets'){block.inheritTheme=true;Object.assign(block.appearance,{transparent:false,radius:12,radiusTop:12,radiusBottom:12});}}
 return block;
}
