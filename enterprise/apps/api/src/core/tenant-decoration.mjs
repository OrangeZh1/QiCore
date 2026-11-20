import {consumerAccountDisplay} from './consumer-account.mjs';
import {readCustomerService} from './tenant-consumer-settings.mjs';
import {applicationDecorationContent} from './decoration-application.mjs';
import {publicMember} from './member-management.mjs';
import {galleryLayouts} from './decoration-options.mjs';
import {randomUUID} from 'node:crypto';
import {decorationIcons,migrateServiceBlock,systemDecorationTemplates} from './decoration-framework.mjs';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {decorationImageIds} from './decoration-contract.mjs';
import {fail} from './errors.mjs';
import {currentDecorationState} from './decoration-state.mjs';
import {readConsumerSettings} from './tenant-consumer-settings.mjs';
import {normalizeDecorationLink} from './decoration-links.mjs';
import {decorationBuiltins} from './decoration-assets.mjs';
import {singleDecorationTypes} from './decoration-components.mjs';
import {sanitizeDecorationHtml} from './decoration-rich-text.mjs';

function registeredRoutes(key){const app=application(key);return app.decoration.targets.map(route=>route.source==='application'?{...route,group:app.name}:route)}

const text=n=>z.string().trim().max(n).refine(v=>!/[<>\u0000-\u0008\u000b-\u001f\u007f]/.test(v));
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),id=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),image=z.string().uuid().nullable();
const builtin=z.string().max(160).optional();
const percent=z.number().min(0).max(100);
const item=z.object({builtin,selectedBuiltin:builtin,icon:z.enum(decorationIcons).optional(),subtitleColor:color.optional(),subtitleBackground:color.optional(),subtitleBackgroundEnd:color.optional(),buttonBackground:color.optional(),buttonBackgroundEnd:color.optional(),id,label:text(20).min(1),target:z.unknown(),imageId:image,enabled:z.boolean().optional(),text:text(500).optional(),imageWidth:z.number().int().min(1).max(30000).optional(),imageHeight:z.number().int().min(1).max(30000).optional(),buttonText:text(12).optional(),color:color.optional(),background:color.optional(),backgroundEnd:color.optional(),badge:text(8).optional(),badgeColor:color.optional(),badgeBackground:color.optional(),left:percent.optional(),top:percent.optional(),width:percent.optional(),height:percent.optional()}).strict();
const panel=z.object({builtin,id,title:text(30),text:text(50),imageId:image,color,background:color,backgroundEnd:color,items:z.array(item).min(1).max(2)}).strict();
const appearance=z.object({transparent:z.boolean().optional(),padding:z.number().int().min(0).max(48),gap:z.number().int().min(0).max(48),radius:z.number().int().min(0).max(40),fontSize:z.number().int().min(12).max(32),columns:z.number().int().min(2).max(5),layout:z.enum(['grid','list','left-large','top-large',...galleryLayouts.map(l=>l.key)]).optional(),marginTop:z.number().min(-100).max(100).optional(),marginBottom:z.number().min(-100).max(100).optional(),marginHorizontal:z.number().min(0).max(100).optional(),paddingTop:z.number().min(0).max(100).optional(),paddingBottom:z.number().min(0).max(100).optional(),paddingHorizontal:z.number().min(0).max(100).optional(),radiusTop:z.number().min(0).max(100).optional(),radiusBottom:z.number().min(0).max(100).optional(),fontWeight:z.enum(['normal','bold']).optional(),lineHeight:z.number().min(1).max(3).optional(),backgroundEnd:color.nullable().optional(),backgroundDirection:z.enum(['to bottom','to right']).optional(),backgroundImageId:image.optional(),backgroundOverlay:z.number().min(0).max(100).optional(),outerBackground:color.nullable().optional(),outerBackgroundEnd:color.nullable().optional()}).strict();
const options=z.object({imageGap:z.number().min(0).max(30).optional(),imageRadiusTop:z.number().min(0).max(50).optional(),imageRadiusBottom:z.number().min(0).max(50).optional(),navMode:z.enum(['graphic','image','text']).optional(),navRows:z.union([z.literal(1),z.literal(2)]).optional(),navDisplay:z.enum(['fixed','scroll','pages']).optional(),iconSize:z.number().min(20).max(60).optional(),iconRadius:z.number().min(0).max(50).optional(),labelSize:z.number().min(12).max(20).optional(),labelWeight:z.enum(['normal','bold']).optional(),labelColor:color.optional(),indicatorStyle:z.enum(['dots','bars','elongated','fraction']).optional(),indicatorAlign:z.enum(['left','center','right']).optional(),indicatorColor:color.optional(),indicatorActiveColor:color.optional(),autoplay:z.boolean().optional(),interval:z.number().int().min(1000).max(10000).optional(),duration:z.number().int().min(100).max(2000).optional(),noticeMode:z.enum(['text','image']).optional(),noticeImageId:image.optional(),noticePreset:z.enum(['style1','style2','custom']).optional(),noticeScroll:z.enum(['vertical','horizontal']).optional(),noticeAction:z.enum(['popup','link']).optional()}).strict();
const extendedOptions=options.extend({assetMergeMembership:z.boolean().optional(),assetLayout:z.enum(['cards','strip','list']).optional(),assetTitle:z.boolean().optional(),assetIcons:z.boolean().optional(),assetPoints:z.boolean().optional(),assetBalance:z.boolean().optional(),assetPointsLabel:text(20).optional(),assetBalanceLabel:text(20).optional(),assetValueSize:z.number().int().min(18).max(40).optional(),assetLabelSize:z.number().int().min(10).max(18).optional(),assetGap:z.number().int().min(0).max(24).optional(),assetRadius:z.number().int().min(0).max(28).optional(),assetTheme:z.boolean().optional(),assetAccent:color.optional(),assetSurface:color.optional(),assetText:color.optional(),assetMuted:color.optional(),collectionSource:z.string().max(64).optional(),collectionLimit:z.number().int().min(1).max(50).optional(),collectionWidth:z.number().int().min(60).max(240).optional(),collectionImageHeight:z.number().int().min(40).max(320).optional(),galleryHeight:z.number().int().min(0).max(400).optional(),navStyle:z.enum(['icons','tiles']).optional(),searchInput:z.boolean().optional(),profileLayout:z.enum(['banner','plain','center']).optional(),profileHeight:z.number().int().min(170).max(300).optional(),memberLayout:z.enum(['classic','soft','dark','compact']).optional(),showLevelGrowth:z.boolean().optional(),showNextLevel:z.boolean().optional(),serviceLayout:z.enum(['grid','list']).optional(),eyebrow:text(30).optional(),buttonText:text(20).optional(),memberTheme:z.boolean().optional(),memberAccent:color.optional(),memberSurface:color.optional(),memberText:color.optional(),memberMuted:color.optional(),memberRadius:z.number().min(0).max(40).optional(),showMemberStatus:z.boolean().optional(),showMemberExpiry:z.boolean().optional(),showAvatar:z.boolean().optional(),showAccount:z.boolean().optional(),showMemberNumber:z.boolean().optional(),activityTitleStyle:z.enum(['style-1','style-2','style-3','style-4','style-5']).optional(),titleColor:color.optional(),subtitleBackground:color.optional(),subtitleBackgroundEnd:color.optional(),subtitleTarget:z.unknown().optional(),activityWeight:z.enum(['normal','bold']).optional(),buttonItalic:z.boolean().optional(),memberVariant:z.number().int().min(1).max(6).optional(),searchVariant:z.number().int().min(1).max(2).optional(),searchColor:color.optional(),searchBackground:color.optional(),searchButtonColor:color.optional(),searchButtonBackground:color.optional(),headerBack:z.boolean().optional(),headerPosition:z.boolean().optional(),headerColor:color.optional(),headerIconColor:color.optional(),fixedBackground:color.optional(),searchGradient:z.boolean().optional(),tabColor:color.optional(),tabSelectedColor:color.optional(),fixedTabColor:color.optional(),fixedTabSelectedColor:color.optional(),swiperStyle:z.enum(['peek','normal','full']).optional(),sameScreen:z.boolean().optional(),moreColor:color.optional(),titleStyle:z.enum(['simple','detailed','stacked']).optional(),showMore:z.boolean().optional(),moreText:text(12).optional(),moreTarget:z.unknown().optional(),subtitleColor:color.optional(),subtitleSize:z.number().int().min(12).max(20).optional(),lineStyle:z.enum(['solid','dashed','dotted']).optional(),lineWidth:z.number().int().min(1).max(10).optional(),floatPosition:z.enum(['top-left','top-right','bottom-left','bottom-right']).optional(),floatOffset:z.number().int().min(0).max(200).optional(),floatSide:z.number().int().min(-10).max(100).optional(),floatSize:z.number().int().min(30).max(100).optional(),activityStyle:z.enum(['style-1','style-2','style-3','style-4']).optional(),memberStyle:z.enum(['dark','gold','plain']).optional(),showMemberPoints:z.boolean().optional(),showPoints:z.boolean().optional(),searchStyle:z.enum(['simple','button','logo']).optional(),searchFixed:z.boolean().optional(),showSearchTabs:z.boolean().optional(),showSearchBanner:z.boolean().optional(),hotWords:z.array(text(20).min(1)).max(50).optional(),hotWordInterval:z.number().int().min(1000).max(10000).optional(),imageFit:z.enum(['fill','contain','cover']).optional()}).strict();
const block=z.object({builtin,icon:z.enum(decorationIcons).optional(),id,type:z.string().max(32),title:text(60),text:text(500),enabled:z.boolean(),align:z.enum(['left','center','right']),color,background:color,height:z.number().int().min(0).max(400),imageId:image,target:z.unknown(),items:z.array(item).max(50),inheritTheme:z.boolean().optional(),appearance:appearance.optional(),options:extendedOptions.optional(),html:z.string().max(30000).optional(),panels:z.array(panel).length(2).optional(),tabs:z.array(item).max(20).optional()}).strict();
const header=z.object({subtitle:text(60).optional(),searchInput:z.boolean().optional(),brandName:text(30).optional(),mode:z.enum(['title','brand','search','location']),align:z.enum(['left','center']),color,background:color,imageId:image,text:text(30),target:z.unknown(),searchTarget:z.unknown()}).strict();
const page=z.object({header:header.optional(),showHeader:z.boolean().optional(),headerStyle:z.enum(['default','framework']).optional(),title:text(30).min(1),background:color,inheritTheme:z.boolean().optional(),blocks:z.array(block).max(30)}).strict();
const schema=z.object({version:z.literal(1),theme:z.object({primary:color,background:color,surface:color,text:color,muted:color,radius:z.number().int().min(0).max(40),fontSize:z.number().int().min(12).max(22),spacing:z.number().int().min(0).max(32)}).strict().optional(),home:page,profile:page,navigation:z.object({enabled:z.boolean(),inheritTheme:z.boolean().optional(),color,selectedColor:color,background:color,items:z.array(item.extend({label:text(12).min(1)})).max(5)}).strict()}).strict();
const where=(tenantId,applicationKey)=>({tenantId_applicationKey:{tenantId,applicationKey}});
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail('DECORATION_INVALID','装修内容无效，请检查名称、颜色、图片和组件数量');return r.data};
export function validateDecoration(value,adapter){
 const scheme=parse(schema,value),checkTarget=t=>{try{return normalizeDecorationLink(t,adapter.targets)}catch(e){fail('DECORATION_INVALID',e.message)}};
 const builtinNames=[...scheme.home.blocks,...scheme.profile.blocks].flatMap(b=>[b.builtin,...(b.tabs||[]).flatMap(i=>[i.builtin,i.selectedBuiltin]),...b.items.flatMap(i=>[i.builtin,i.selectedBuiltin]),...(b.panels||[]).flatMap(p=>[p.builtin,...p.items.flatMap(i=>[i.builtin,i.selectedBuiltin])])]).concat(scheme.navigation.items.flatMap(i=>[i.builtin,i.selectedBuiltin]));
 if(builtinNames.some(name=>name&&!decorationBuiltins.includes(name)&&!adapter.assets?.includes(name)))fail('DECORATION_INVALID','内置素材不属于当前应用');
 for(const kind of ['home','profile']){
  if(scheme[kind].header){scheme[kind].header.target=checkTarget(scheme[kind].header.target);scheme[kind].header.searchTarget=checkTarget(scheme[kind].header.searchTarget);}
  scheme[kind].blocks=scheme[kind].blocks.map(migrateServiceBlock);
  const ids=new Set(),types=new Set();
  for(const b of scheme[kind].blocks){
   if(ids.has(b.id)||!adapter.blocks.some(t=>t.type===(['member-overview','member-level'].includes(b.type)?'membership':b.type)&&t.pages.includes(kind)))fail('DECORATION_INVALID','组件编号重复或不适用于当前页面');ids.add(b.id);
   if(singleDecorationTypes.includes(b.type)&&types.has(b.type))fail('DECORATION_INVALID','会员信息、会员权益、账户资产、订单中心、轮播搜索和浮动按钮每页只能添加一个');types.add(b.type);
   if(b.appearance?.layout&&!(b.type==='gallery'?['grid','left-large','top-large',...galleryLayouts.map(l=>l.key)]:b.type==='links'?['grid','list']:['grid']).includes(b.appearance.layout))fail('DECORATION_INVALID','当前组件不支持此布局');if(!['links','collection'].includes(b.type)&&b.items.length>10)fail('DECORATION_INVALID','当前组件最多配置 10 项');b.target=checkTarget(b.target);if(new Set(b.items.map(i=>i.id)).size!==b.items.length)fail('DECORATION_INVALID','入口编号重复');
   if(b.type==='assets'&&b.options?.assetPoints===false&&b.options?.assetBalance===false)fail('DECORATION_INVALID','账户资产至少显示一项');
   if(b.options?.collectionSource&&!adapter.collections?.includes(b.options.collectionSource))fail('DECORATION_INVALID','数据来源不属于当前应用');
   if(b.items.length&&!['collection','features','orders','services','links','banner','gallery','notice','hot-area','float','activity','search'].includes(b.type))fail('DECORATION_INVALID','此组件不支持入口列表');
   for(const i of b.items){i.target=checkTarget(i.target);}
   if(b.options?.moreTarget!==undefined)b.options.moreTarget=checkTarget(b.options.moreTarget);if(b.options?.subtitleTarget!==undefined)b.options.subtitleTarget=checkTarget(b.options.subtitleTarget);
   if(b.html!==undefined){if(b.type!=='rich-text')fail('DECORATION_INVALID','仅富文本组件支持正文');b.html=sanitizeDecorationHtml(b.html)}
   if(b.tabs){if(b.type!=='search')fail('DECORATION_INVALID','仅轮播搜索支持分类标签');if(new Set(b.tabs.map(i=>i.id)).size!==b.tabs.length)fail('DECORATION_INVALID','分类标签编号重复');for(const i of b.tabs)i.target=checkTarget(i.target)}
   if(b.panels){if(b.type!=='showcase'||new Set(b.panels.map(p=>p.id)).size!==b.panels.length)fail('DECORATION_INVALID','图片展播分组无效');for(const p of b.panels){if(new Set(p.items.map(i=>i.id)).size!==p.items.length)fail('DECORATION_INVALID','展播图片编号重复');for(const i of p.items)i.target=checkTarget(i.target)}}
   if(b.type==='float'&&b.items.length>3)fail('DECORATION_INVALID','浮动按钮最多添加 3 个');
   if(b.type==='hot-area')for(const i of b.items)if(i.left===undefined||i.top===undefined||!i.width||!i.height||i.left+i.width>100.001||i.top+i.height>100.001)fail('DECORATION_INVALID','热区必须在图片范围内');
  }

 }
 const nav=scheme.navigation.items;nav.forEach(i=>{i.target=checkTarget(i.target);if(!i.target)fail('DECORATION_INVALID','请选择底部导航目标')});
 if(new Set(nav.map(i=>i.id)).size!==nav.length||scheme.navigation.enabled&&!nav.length)fail('DECORATION_INVALID','导航编号不能重复，开启时至少需要一个导航项');
 if(decorationImageIds(scheme).length>60)fail('DECORATION_INVALID','一套方案最多引用 60 张图片');
 return scheme;
}
export class TenantDecoration {
 constructor(db,storage){this.db=db;this.storage=storage;this.apps=new TenantApplications(db)}
 context(db,s,tenantId,key){return this.apps.featureContext(db,s,tenantId,key,'decoration','settings.read')}
 async view(s,tenantId,input={}){
  const q=parse(z.object({applicationKey:z.string().max(64).optional()}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey),key=ctx.selected?.key;
  const row=key?await this.db.tenantDecoration.findUnique({where:where(tenantId,key)}):null;
  const current=await this.context(this.db,s,tenantId,key),state=key?currentDecorationState(row,application(key).decoration.defaults()):null;
  const content=key?await applicationDecorationContent(this.db,{tenantId,applicationKey:key}):{components:[]};
  return {assets:content.assets,components:content.components,applicationKey:key||null,applications:ctx.sources,targets:key?registeredRoutes(key):[],defaults:key?application(key).decoration.defaults():null,systemTemplates:key?systemDecorationTemplates(application(key).decoration.defaults()):[],groups:row?.groups||[],canWrite:current.permissions.includes('settings.write'),version:row?.version||0,current:state?.current||null,currentSaved:state?.saved||false,schemes:state?[state.current]:[],templates:state?.templates||[],activeId:row?.activeId||null,publishedAt:row?.publishedAt||null,published:row?.published||null};
 }
 async routes(s,tenantId,input={}){const q=parse(z.object({applicationKey:z.string().max(64).optional()}).strict(),input),ctx=await this.context(this.db,s,tenantId,q.applicationKey);return {applicationKey:ctx.selected?.key||null,applications:ctx.sources,items:ctx.selected?registeredRoutes(ctx.selected.key):[]}}
 async images(db,tenantId,key,scheme){const ids=decorationImageIds(scheme);if(ids.length&&await db.tenantMaterial.count({where:{id:{in:ids},tenantId,scopeKey:key,kind:'image',status:'ready',deletedAt:null}})!==ids.length)fail('DECORATION_IMAGE_INVALID','图片已删除或不属于当前站点应用素材库')}
 async mutate(s,tenantId,key,input){
  const q=parse(z.object({version:z.number().int().nonnegative(),action:z.enum(['save','save-and-activate','activate','delete','save-template','delete-template','create-from-template','set-cover','set-group','group-save','group-delete']),id:z.string().uuid(),sourceId:z.union([z.string().uuid(),z.literal('framework-default')]).optional(),coverId:z.string().uuid().nullable().optional(),groupId:z.string().uuid().nullable().optional(),name:text(40).min(1).optional(),scheme:z.unknown().optional()}).strict(),input);
  const adapter=application(key).decoration;if(!adapter)fail('DECORATION_INVALID','应用不支持装修');
  await this.apps.admin(s,tenantId,key,'settings.write');
  if(q.action==='create-from-template')fail('DECORATION_SINGLE_CURRENT','请在当前装修中套用模板，预览后保存',409);
  await this.apps.transaction(async db=>{
   await this.apps.admin(s,tenantId,key,'settings.write',db,true);
   const old=await db.tenantDecoration.findUnique({where:where(tenantId,key)});
   if((old?.version||0)!==q.version)fail('DECORATION_CONFLICT','装修方案已变更，请刷新后重试',409);
   const state=currentDecorationState(old,adapter.defaults()),groups=structuredClone(old?.groups||[]),schemes=state.records,index=schemes.findIndex(x=>x.id===q.id);let published=old?.published,activeId=old?.activeId,publishedAt=old?.publishedAt;
   if(['save','save-and-activate','activate','delete'].includes(q.action)&&q.id!==state.current.id)fail('DECORATION_SINGLE_CURRENT','每个站点应用只有一套当前装修，其他设计请保存为模板',409);
   if(q.action==='delete')fail('DECORATION_CURRENT','当前装修不能删除，可修改内容或套用模板',409);
   if(['save-template','delete-template'].includes(q.action)&&q.id===state.current.id)fail('DECORATION_CURRENT','当前装修与模板不能使用同一编号',409);
   if(q.action==='group-save'){
    if(!q.name||q.name.length>20)fail('DECORATION_INVALID','分类名称为 1–20 字');if(groups.some(g=>g.id!==q.id&&g.name.toLowerCase()===q.name.toLowerCase()))fail('DECORATION_INVALID','分类名称已存在');const index=groups.findIndex(g=>g.id===q.id);if(index<0){if(groups.length>=30)fail('DECORATION_LIMIT','最多 30 个分类');groups.push({id:q.id,name:q.name})}else groups[index].name=q.name;
   }else if(q.action==='group-delete'){const index=groups.findIndex(g=>g.id===q.id);if(index<0)fail('DECORATION_MISSING','分类不存在',404);groups.splice(index,1);for(const row of schemes)if(row.groupId===q.id)row.groupId=null;
   }else if(q.action==='set-cover'||q.action==='set-group'){
    if(index<0)fail('DECORATION_MISSING','方案或模板不存在',404);
    if(q.action==='set-cover'){if(q.coverId===undefined)fail('DECORATION_INVALID','请选择封面');if(q.coverId&&await db.tenantMaterial.count({where:{id:q.coverId,tenantId,scopeKey:key,kind:'image',status:'ready',deletedAt:null}})!==1)fail('DECORATION_IMAGE_INVALID','封面不属于当前站点应用');schemes[index].coverId=q.coverId}
    else{if(q.groupId===undefined||q.groupId&&!groups.some(g=>g.id===q.groupId))fail('DECORATION_INVALID','分类不存在');schemes[index].groupId=q.groupId}
    schemes[index].updatedAt=new Date().toISOString();
   }else if(['save','save-and-activate','save-template'].includes(q.action)){
    if(!q.name)fail('DECORATION_INVALID','请填写名称');const kind=q.action==='save-template'?'template':'scheme';if(index>=0&&((schemes[index].kind||'scheme')!==kind))fail('DECORATION_CONFLICT','编号已被使用',409);const scheme=validateDecoration(q.scheme,adapter);await this.images(db,tenantId,key,scheme);
    if(index<0&&kind==='template'&&schemes.filter(v=>v.kind==='template').length>=20)fail('DECORATION_LIMIT','最多保存 20 个我的模板');
    if(q.groupId&&!groups.some(g=>g.id===q.groupId))fail('DECORATION_INVALID','分类不存在');const row={...(index>=0?schemes[index]:{}),...(q.groupId!==undefined?{groupId:q.groupId}:{}),id:q.id,kind,name:q.name,scheme,updatedAt:new Date().toISOString()};if(index<0)schemes.push(row);else schemes[index]=row;
    if(['save','save-and-activate'].includes(q.action)){published=structuredClone(scheme);activeId=q.id;publishedAt=new Date()}
   }else{
    if(index<0)fail('DECORATION_MISSING','方案不存在',404);
    if((schemes[index].kind==='template')!==(q.action==='delete-template'))fail('DECORATION_INVALID','方案与模板操作不匹配');
    if(['delete','delete-template'].includes(q.action)){if(activeId===q.id)fail('DECORATION_ACTIVE','请先启用其他方案，再删除当前方案',409);schemes.splice(index,1)}
    else{published=validateDecoration(schemes[index].scheme,adapter);await this.images(db,tenantId,key,published);activeId=q.id;publishedAt=new Date()}
   }
   const data={schemes,groups,...(published?{published,activeId,publishedAt}:{}),version:q.version+1};
   await db.tenantDecoration.upsert({where:where(tenantId,key),create:{tenantId,applicationKey:key,...data},update:data});
   await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey:key,actor:s.impersonatedBy||s.id,action:'decoration.'+q.action,details:{schemeId:q.id,version:q.version+1,...(state.convertedIds.length?{preservedTemplateIds:state.convertedIds}:{}),...(s.delegated?{targetAdminId:s.id}:{})}}});
  });return this.view(s,tenantId,{applicationKey:key});
 }
 async publicView(input){
  const identity=parse(z.object({tenantId:id,applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)}).strict(),input);
  await this.apps.available(identity.tenantId,identity.applicationKey);
  const adapter=application(identity.applicationKey).decoration;if(!adapter)fail('NOT_FOUND','应用不支持装修',404);
  const row=await this.db.tenantDecoration.findUnique({where:where(identity.tenantId,identity.applicationKey)}),content=await applicationDecorationContent(this.db,identity),customerService=await readCustomerService(this.db,identity.tenantId,identity.applicationKey),settings=await readConsumerSettings(this.db,identity.tenantId,identity.applicationKey);
  const scheme=row?.published||adapter.defaults(),ids=decorationImageIds(scheme),imageUrls=ids.length?await this.storage.imageUrls(identity.tenantId,identity.applicationKey,ids):{};
  await this.apps.available(identity.tenantId,identity.applicationKey);
  return{defaultAvatar:settings.config.users.defaultAvatar,imageUrls,customerService,scheme,assets:content.assets,components:content.components,applicationData:content.applicationData,targets:[...adapter.targets,...content.targets],configured:!!row?.published,profile:null,member:null,version:row?.publishedAt?.toISOString()||'default'};
 }
 async publicImage(input,id){
  const view=await this.publicView(input);if(!decorationImageIds(view.scheme).includes(id))fail('NOT_FOUND','图片不存在',404);
  const row=await this.db.tenantMaterial.findFirst({where:{id,tenantId:input.tenantId,scopeKey:input.applicationKey,kind:'image',status:'ready',deletedAt:null}});if(!row)fail('NOT_FOUND','图片不存在',404);
  const file=await this.storage.delivery(row);
  try{await this.apps.available(input.tenantId,input.applicationKey)}catch(e){file.stream?.destroy();throw e}return{...file,mime:row.mime};
 }
 async published(s){
  if(s.role!=='user'||typeof s.userId!=='string'||!s.userId)fail('FORBIDDEN','需要消费者身份',403);
  await this.apps.available(s.tenantId,s.applicationKey);const adapter=application(s.applicationKey).decoration;if(!adapter)fail('NOT_FOUND','应用不支持装修',404);
  const row=await this.db.tenantDecoration.findUnique({where:where(s.tenantId,s.applicationKey)});
  const scheme=row?.published||adapter.defaults(),needsMember=[...scheme.home.blocks,...scheme.profile.blocks].some(b=>b.enabled&&['assets','membership','member-level','member-overview','profile'].includes(b.type));
  const member=needsMember&&adapter.member?{...await adapter.member(this.db,s),...await publicMember(this.db,s.tenantId,s.applicationKey,s.userId)}:null;
  let profile=null;
  if([...scheme.home.blocks,...scheme.profile.blocks].some(b=>b.enabled&&b.type==='profile')){
   const row=await this.db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId}},select:{nickname:true,avatar:true,memberNumber:true}});
   const {config}=await readConsumerSettings(this.db,s.tenantId,s.applicationKey);
   profile={nickname:row?.nickname||'',avatar:row?.avatar||null,defaultAvatar:config.users.defaultAvatar,...await consumerAccountDisplay(this.db,s),memberNumber:row?.memberNumber||null};
  }
  const content=await applicationDecorationContent(this.db,s),customerService=await readCustomerService(this.db,s.tenantId,s.applicationKey),settings=await readConsumerSettings(this.db,s.tenantId,s.applicationKey);
  await this.apps.available(s.tenantId,s.applicationKey);
  const ids=decorationImageIds(scheme);
  return {defaultAvatar:settings.config.users.defaultAvatar,imageUrls:ids.length?await this.storage.imageUrls(s.tenantId,s.applicationKey,ids):{},scheme,member,profile,customerService,assets:content.assets,components:content.components,targets:[...adapter.targets,...content.targets],configured:!!row?.published,version:row?.publishedAt?.toISOString()||'default'};
 }
 async image(s,id){
  const {scheme}=await this.published(s);if(!decorationImageIds(scheme).includes(id))fail('NOT_FOUND','图片不可访问',404);
  const row=await this.db.tenantMaterial.findFirst({where:{id,tenantId:s.tenantId,scopeKey:s.applicationKey,kind:'image',status:'ready',deletedAt:null}});if(!row)fail('NOT_FOUND','图片不可访问',404);
  const file=await this.storage.delivery(row);
  try{await this.apps.available(s.tenantId,s.applicationKey)}catch(e){file.stream?.destroy();throw e}
  return {...file,mime:row.mime};
 }
}
