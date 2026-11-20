import {referenceDefaults} from './decoration-reference.mjs';
import {frameworkBlockDefaults,migrateServiceBlock,fillOrderDefaults} from './decoration-framework.mjs';
import {decorationOptions,galleryLayout} from './decoration-options.mjs';
// Pure presentation contract shared by the editor and mini-program. No API/database dependencies.
/** @type {import('./decoration-types.js').DecorationRoute[]} */
export const decorationTargets=[
 {key:'home',label:'首页',path:'/pages/home/index',group:'系统自带',source:'system'},
 {key:'profile',label:'个人中心',path:'/pages/profile/index',group:'系统自带',source:'system'},
 {key:'system:member-levels',label:'会员等级',path:'/pages/levels/index',group:'系统自带',source:'system'},
 {key:'member',label:'积分套餐',path:'/pages/member/index',group:'系统自带',source:'system'},
 {key:'system:recharge',label:'我的余额',path:'/pages/recharge/index',group:'系统自带',source:'system'},
 {key:'settings',label:'个人资料',path:'/pages/personal/index',group:'系统自带',source:'system'},
 {key:'help',label:'帮助中心',path:'/pages/help/index',group:'系统自带',source:'system'},
 {key:'system:contact',label:'联系客服',path:'/pages/contact/index',group:'系统自带',source:'system'},
 {key:'system:growth-records',label:'成长记录',path:'/pages/growth-records/index',group:'系统自带',source:'system'},
 {key:'system:orders',label:'订单中心',path:'/pages/orders/index',group:'系统自带',source:'system'},
 {key:'system:points-records',label:'积分明细',path:'/pages/member/index?tab=records',group:'系统自带',source:'system'},
 {key:'system:balance-records',label:'余额明细',path:'/pages/recharge/index?tab=records',group:'系统自带',source:'system'},
 {key:'system:terms',label:'用户协议',path:'/pages/policy/index?kind=terms',group:'系统自带',source:'system'},
 {key:'system:privacy',label:'隐私政策',path:'/pages/policy/index?kind=privacy',group:'系统自带',source:'system'},
 {key:'login',label:'登录',path:'/pages/login/index',group:'系统自带',source:'system'},
];
export const decorationBlocks=[
 {type:'profile',label:'会员信息',pages:['home','profile']},
 {type:'orders',label:'订单中心',pages:['home','profile']},

 {type:'intro',label:'图文介绍',pages:['home','profile']},
 {type:'features',label:'功能介绍',pages:['home','profile']},
 {type:'text',label:'标题',pages:['home','profile']},
 {type:'notice',label:'公告',pages:['home','profile']},
 {type:'image',label:'图片',pages:['home','profile']},
 {type:'banner',label:'图片广告',pages:['home','profile']},
 {type:'wechat-ad',label:'微信广告',pages:['home','profile']},
 {type:'gallery',label:'魔方',pages:['home','profile']},
 {type:'links',label:'图文导航',pages:['home','profile']},
 {type:'collection',label:'卡片列表',pages:['home','profile']},
 {type:'hot-area',label:'热区',pages:['home','profile']},
 {type:'assets',label:'账户资产',pages:['home','profile']},
 {type:'membership',label:'会员权益',pages:['home','profile']},
 {type:'rich-text',label:'富文本',pages:['home','profile']},
 {type:'activity',label:'活动魔方',pages:['home','profile']},
 {type:'search-box',label:'搜索框',pages:['home','profile']},
 {type:'search',label:'轮播搜索',pages:['home','profile']},
 {type:'float',label:'浮动按钮',pages:['home','profile']},
 {type:'showcase',label:'图片展播',pages:['home','profile']},
 {type:'button',label:'按钮',pages:['home','profile']},
 {type:'spacer',label:'辅助空白',pages:['home','profile']},
 {type:'divider',label:'辅助线',pages:['home','profile']},
];
/** @returns {import('./decoration-types.js').DecorationBlock} */
export function decorationBlock(type,id,routes=[]){
 if(type==='collection')return{id,type,title:'卡片列表',text:'',enabled:true,align:'left',color:'#1e293b',background:'#ffffff',height:160,imageId:null,target:'',items:[],inheritTheme:true,appearance:{...decorationAppearance(),padding:14,marginHorizontal:10,marginBottom:12},options:{collectionSource:'',collectionLimit:6,collectionWidth:110,collectionImageHeight:120,showMore:true,moreText:'查看更多'}};
 if(type==='wechat-ad')return{id,type,title:'微信广告',text:'',enabled:true,align:'left',color:'#64748b',background:'#ffffff',height:100,imageId:null,target:'',items:[],appearance:{...decorationAppearance(),padding:0,radius:0,transparent:true,marginHorizontal:10,marginTop:10,marginBottom:10}};
 const count=['gallery','banner','search'].includes(type)?2:['links','activity'].includes(type)?4:['notice','float'].includes(type)?1:0;
 const items=Array.from({length:count},(_,index)=>({id:id+'-'+(index+1),label:(type==='links'?'导航':'图片')+(index+1),target:'',imageId:null,...(type==='notice'?{text:'在这里填写公告内容',enabled:true}:{})}));
 return fillOrderDefaults(frameworkBlockDefaults(referenceDefaults({id,type,title:['gallery','banner','links','image','hot-area','float','rich-text','showcase'].includes(type)?'':type==='search'?'请输入搜索关键词':type==='activity'?'精选推荐':decorationBlocks.find(b=>b.type===type)?.label||'',text:type==='notice'?'在这里填写公告内容':'',enabled:true,align:'left',color:type==='button'?'#ffffff':type==='notice'?'#303133':'#172554',background:type==='button'?'#2563eb':'#ffffff',height:type==='spacer'?24:160,imageId:null,target:'',items,inheritTheme:type!=='notice',appearance:{...decorationAppearance(),padding:['gallery','banner','image','links','hot-area','showcase','float'].includes(type)?0:type==='notice'?11:16,columns:type==='gallery'?2:4,layout:type==='gallery'?'row1-of2':'grid'},...(type==='rich-text'?{html:''}:{}),...(type==='search'?{tabs:[]}:{}),...(type==='showcase'?{panels:[0,1].map(n=>({id:id+'-panel-'+n,title:n?'人气精选':'本周推荐',text:'',imageId:null,color:'#303133',background:n?'#fff2e6':'#eaf5ff',backgroundEnd:'#ffffff',items:[0,1].map(i=>({id:id+'-panel-'+n+'-'+i,label:'去看看',target:'',imageId:null,color:'#ffffff',background:'#f5443e',backgroundEnd:'#f5443e'}))}))}:{})})),routes)
}
/** @param {Partial<import('./decoration-types.js').DecorationBlock>} [block] @returns {NonNullable<import('./decoration-types.js').DecorationBlock['appearance']>} */
export function decorationAppearance(block={}){
 const a={padding:14,gap:10,radius:8,fontSize:14,columns:4,layout:'grid',...block.appearance};
 // Upgrade the old transparent, edge-to-edge defaults; retain explicit custom colors/spacing.
 if(['links','notice'].includes(block.type)&&block.background==='#ffffff'&&a.transparent===true&&a.padding===0&&a.radius===0&&!a.marginHorizontal&&!a.backgroundImageId){Object.assign(a,{transparent:false,marginHorizontal:10,marginTop:10,marginBottom:12,radius:12,radiusTop:12,radiusBottom:12});}
 return a;
}
/** Shared CSS values keep the two rendering hosts consistent. */
export const clientPageBackground='#f3f9ff';
export function decorationTheme(scheme={}){return {primary:'#2563eb',background:clientPageBackground,surface:'#ffffff',text:'#1e293b',muted:'#64748b',radius:12,fontSize:14,spacing:12,...scheme.theme}}
/** @returns {import('./decoration-types.js').DecorationHeader} */
export function decorationHeader(page={}){return {brandName:'',mode:'title',align:'center',color:'#1e293b',background:'#ffffff',imageId:null,text:'',target:'',searchTarget:'',...page.header}}
export function decorationPageBackground(scheme,page){return scheme[page].inheritTheme!==false?clientPageBackground:scheme[page].background}
export function decorationNavigation(scheme){const t=decorationTheme(scheme);return scheme.navigation.inheritTheme!==false?{color:t.muted,selectedColor:t.primary,background:t.surface}:scheme.navigation}
export function decorationBlockStyle(block,scheme={},imageUrl=id=>id){let a=decorationAppearance(block),color=block.color,background=block.background;if(block.inheritTheme!==false){const t=decorationTheme(scheme);a={...a,gap:t.spacing,radius:t.radius,fontSize:t.fontSize};color=block.type==='button'?'#ffffff':t.text;background=block.type==='button'?t.primary:t.surface}const top=a.radiusTop??a.radius,bottom=a.radiusBottom??a.radius,style={color,background:a.transparent?'transparent':a.backgroundEnd?'linear-gradient('+(a.backgroundDirection||'to bottom')+','+background+','+a.backgroundEnd+')':background,textAlign:block.align,padding:(a.paddingTop??a.padding)+'px '+(a.paddingHorizontal??a.padding)+'px '+(a.paddingBottom??a.padding)+'px',borderRadius:top===bottom?top+'px':top+'px '+top+'px '+bottom+'px '+bottom+'px',fontSize:a.fontSize+'px',fontWeight:a.fontWeight||'normal',lineHeight:a.lineHeight||1.5,marginTop:Math.min(a.marginTop||0,0)+'px',marginBottom:Math.min(a.marginBottom??a.gap,0)+'px',boxSizing:/** @type {'border-box'} */('border-box')};if(a.backgroundImageId){const opacity=(a.backgroundOverlay||0)/100;Object.assign(style,{backgroundImage:'linear-gradient(rgba(0,0,0,'+opacity+'),rgba(0,0,0,'+opacity+')),url("'+imageUrl(a.backgroundImageId)+'")',backgroundSize:'cover',backgroundPosition:'center'})}return style}

/** @returns {import('./decoration-types.js').DecorationScheme} */
export function defaultDecoration(){
 const intro=decorationBlock('intro','intro'),features=decorationBlock('features','features');
 const profile=decorationBlock('profile','profile'),membership=decorationBlock('membership','membership'),assets=decorationBlock('assets','assets');
 for(const block of [profile,membership]){block.inheritTheme=true;Object.assign(block.appearance,{padding:14,marginTop:0,marginHorizontal:10,marginBottom:12,radiusTop:12,radiusBottom:12,transparent:false});}
 profile.options={profileLayout:'banner'};Object.assign(profile.appearance,{transparent:true,padding:0,marginHorizontal:0,marginBottom:-26,radiusTop:0,radiusBottom:0});
 Object.assign(membership.appearance,{padding:0,transparent:true});
 membership.text='';
 const help=decorationBlock('links','help-center');help.items=[{id:'help',label:'帮助中心',target:'help',imageId:null,icon:'circle-help'}];help.appearance.layout='list';help.appearance.columns=2;
 Object.assign(features.appearance,{padding:18,marginBottom:0,radiusTop:12,radiusBottom:0});
 return {version:1,theme:decorationTheme(),home:{title:'首页',headerStyle:'framework',background:clientPageBackground,inheritTheme:true,blocks:[intro,features]},profile:{title:'个人中心',headerStyle:'framework',background:clientPageBackground,inheritTheme:true,blocks:[profile,membership,assets,help]},navigation:{enabled:true,inheritTheme:true,color:'#64748b',selectedColor:'#2563eb',background:'#ffffff',items:[{id:'home',label:'首页',target:'home',imageId:null},{id:'profile',label:'我的',target:'profile',imageId:null}]}};
}
/** @param {import('./decoration-types.js').DecorationScheme} scheme @returns {string[]} */
export function decorationImageIds(scheme){return [...new Set([...scheme.home.blocks,...scheme.profile.blocks].flatMap(b=>[b.imageId,b.appearance?.backgroundImageId,b.options?.noticeImageId,...b.items.map(i=>i.imageId),...(b.panels||[]).flatMap(p=>[p.imageId,...p.items.map(i=>i.imageId)]),...[...(b.html||'').matchAll(/\/decoration-media\/([0-9a-f-]{36})/gi)].map(m=>m[1])]).concat(scheme.home.header?.imageId,scheme.profile.header?.imageId,scheme.navigation.items.map(i=>i.imageId)).filter(Boolean))]}
export const basicDecoration={targets:decorationTargets,blocks:decorationBlocks,defaults:defaultDecoration};

/** Explicit draft-only action. Existing custom values are retained so inheritance can be disabled later. */
export function inheritDecorationTheme(scheme){for(const key of ['home','profile']){scheme[key].inheritTheme=true;for(const block of scheme[key].blocks)block.inheritTheme=true}scheme.navigation.inheritTheme=true}

/** Normalize legacy drafts without persisting or overwriting explicit custom-style choices. */
export function normalizeDecorationScheme(value){const scheme=JSON.parse(JSON.stringify(value));scheme.theme=decorationTheme(scheme);for(const page of ['home','profile']){scheme[page].inheritTheme??=true;scheme[page].blocks=scheme[page].blocks.map(migrateServiceBlock);for(const block of scheme[page].blocks){if(block.type==='membership'){if(['套餐权益','会员概览'].includes(block.title))block.title='会员权益';if(block.text==='会员额度与普通积分')block.text='';}block.inheritTheme??=true;block.appearance=decorationAppearance(block);if(block.type==='notice'&&!block.options&&block.background==='#fffbeb'&&block.color==='#92400e'){block.background='#ffffff';block.color='#303133';block.appearance.padding=11}if(block.type==='notice'&&!block.items.length)block.items=[{id:block.id+'-notice',label:'公告',text:block.text||block.title,target:block.target,imageId:null,enabled:true}]}}scheme.navigation.inheritTheme??=true;return scheme}

/** Shared grid geometry used by both rendering hosts. */
export function decorationGridStyle(block){const a=decorationAppearance(block);return {gridTemplateColumns:'repeat('+(a.layout==='list'?1:a.layout==='left-large'||a.layout==='top-large'?2:a.columns)+',minmax(0,1fr))'}}

/** Niucloud puts positive spacing in the outer background, negative spacing on the component. */
export function decorationOuterStyle(block,scheme={}){if(block.type==='banner'&&block.options?.sameScreen)return {boxSizing:'border-box',paddingTop:'0px',paddingBottom:'0px',paddingLeft:'0px',paddingRight:'0px',background:'transparent'};const a=decorationAppearance(block),gap=block.inheritTheme!==false?decorationTheme(scheme).spacing:a.gap;return {boxSizing:/** @type {'border-box'} */('border-box'),paddingTop:Math.max(a.marginTop||0,0)+'px',paddingBottom:Math.max(a.marginBottom??gap,0)+'px',paddingLeft:(a.marginHorizontal||0)+'px',paddingRight:(a.marginHorizontal||0)+'px',background:a.outerBackgroundEnd?'linear-gradient(to bottom,'+(a.outerBackground||'#ffffff')+','+a.outerBackgroundEnd+')':a.outerBackground||'transparent'}}
