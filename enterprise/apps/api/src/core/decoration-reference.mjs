// Defaults and style changes ported from niucloud ComponentDict / edit-active-cube.
// Source attribution: docs/reference-projects/niucloud/LICENSE.
export function referenceDefaults(block){
 const b=block;
 if(!['image','button','profile'].includes(b.type)){
  b.inheritTheme=false;b.background='#ffffff';b.color='#303133';b.appearance={...b.appearance,padding:0,gap:0,radius:0,fontSize:14,marginTop:0,marginBottom:0,marginHorizontal:0,transparent:true};
 }
 if(b.type==='text'){b.title='标题栏';b.align='center';b.appearance.fontSize=16}
 if(b.type==='banner'){b.height=180;b.items=b.items.slice(0,1)}
 if(b.type==='links'){b.appearance.marginTop=10;b.appearance.marginBottom=10;b.options={iconRadius:25,labelSize:14}}
 if(b.type==='notice'){b.appearance.padding=0}
 if(b.type==='button')Object.assign(b.appearance,{marginTop:10,marginBottom:10,marginHorizontal:10});
 if(b.type==='spacer')b.height=20;
 if(b.type==='float')b.options={floatOffset:0,floatSide:15};
 if(b.type==='activity'){
  b.title='超值爆款';b.text='为您精选爆款';b.builtin='active_cube/active_cube_text1.png';Object.assign(b.appearance,{radius:12,marginTop:10,marginBottom:10,marginHorizontal:10});
  b.options={subtitleColor:'#ffffff',imageRadiusTop:10,imageRadiusBottom:10};
  const names=['今日推荐','优惠好物','热销推荐','书桌好物'],sub=['诚意推荐','领券后更优惠','本周热销商品','办公好物推荐'];
  b.items.forEach((i,n)=>Object.assign(i,{label:names[n],text:sub[n],builtin:'active_cube/active_cube_goods'+(n+1)+'.png',buttonText:'去看看'}));changeActivityStyle(b,'style-1');
 }
 if(b.type==='membership'){b.title='会员权益';b.text='';b.appearance.marginBottom=12}
 if(b.type==='search-box'){b.title='请输入搜索关键词';b.options={showSearchBanner:false,showSearchTabs:false,searchVariant:1}}
 if(b.type==='search'){b.title='请输入搜索关键词';b.text='本地好价·优选生活';b.height=168;b.items=b.items.slice(0,1);b.options={interval:5000,subtitleColor:'#000000',subtitleBackground:'#ffffff',subtitleBackgroundEnd:'#ffffff'};b.tabs=Array.from({length:4},(_,i)=>({id:b.id+'-tab-'+i,label:'分类名称',target:'',imageId:null}))}
 if(b.type==='showcase'){b.appearance.marginHorizontal=10;b.panels.forEach((p,n)=>{p.title=n?'每日上新':'最高补1200元';p.text=p.title;p.builtin='picture_show/picture_show_head_text'+(n+3)+'.png';p.color='#666666';p.background=n?'#FFF1D4':'#D4EFFF';p.backgroundEnd=n?'#F9F2E5':'#EBF4FA';p.items.forEach((i,k)=>{i.builtin='picture_show/picture_0'+(5+n*2+k)+'.png';i.label=['全网低价','大牌特惠','人气爆款','官方正品'][n*2+k]})});b.options={imageRadiusTop:10,imageRadiusBottom:10}}
 return b;
}
export function changeActivityStyle(block,style){
 const second=style==='style-2',third=style==='style-3',fourth=style==='style-4';block.options={...block.options,activityStyle:style,activityWeight:second||fourth?'bold':'normal',buttonItalic:second};
 const btn=second?[['#FFC051','#FF9C00'],['#A4E894','#45CC2A'],['#4BC2FF','#1F7DFF'],['#FB792F','#F91700']]:[['#FEA715','#FE1E00'],['#FFBF50','#FF9E03'],['#A2E792','#49CD2D'],['#4AC1FF','#1D7CFF']];
 const bg=fourth?[['#FFAD4D','#F93D02'],['#7CA7F4','#2B56E9'],['#FF7F48','#EE335B'],['#90D48C','#299F4F']]:second?[['#FFF1DB','#FFFBF4'],['#E6F6E2','#F5FDF3'],['#E2F6FF','#F2FAFF'],['#FFEAEA','#FFFCFB']]:[];
 const subtitle=[['#ED6E00','#FFE4D9'],['#2E59E9','#CAD7F8'],['#F62F55','#FCD6D9'],['#139B3C','#D3F1DA']];
 block.items.forEach((item,index)=>{const n=index%4;Object.assign(item,{color:third&&n===0?'#FF1128':fourth?'#ffffff':'#303133',subtitleColor:fourth?subtitle[n][0]:'#999999',subtitleBackground:fourth?subtitle[n][1]:'#F3DAC5',subtitleBackgroundEnd:fourth?subtitle[n][1]:'#F3DAC5',buttonBackground:btn[n][0],buttonBackgroundEnd:btn[n][1],background:third?'#ffffff':bg[n]?.[0]||'#FFFAF5',backgroundEnd:bg[n]?.[1]||'#ffffff'});});
}
