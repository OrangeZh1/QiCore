import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decorationBlock,basicDecoration,defaultDecoration} from '../src/core/decoration-contract.mjs';
import {galleryStyle,gallerySlotSize,changeGalleryLayout,navigationPages,navigationRows,decorationIconStyle,decorationNavigationIconStyle,navigationContentStyle} from '../src/core/decoration-options.mjs';
import {memberPalettePreset} from '../src/core/decoration-framework.mjs';
import {memberCardContent,collectionContent,collectionItems,accountAssetItems,accountAssetStyle,decorationRenderGroups,decorationWarnings} from '../src/core/decoration-components.mjs';
import {validateDecoration,TenantDecoration} from '../src/core/tenant-decoration.mjs';
import {defaultCurrentDecorationId} from '../src/core/decoration-state.mjs';

test('incomplete content gives page-specific advice while save and activation persist and enforce link and image validation',async()=>{
 const scheme=defaultDecoration(),links=decorationBlock('links','unfinished-links');
 links.items[0].target='';scheme.home.blocks=[links];scheme.profile.blocks=[];
 assert.deepEqual(decorationWarnings(scheme),['首页第 1 个组件的内容、图片或跳转目标尚未补全']);
 links.enabled=false;assert.deepEqual(decorationWarnings(scheme),[]);links.enabled=true;
 let stored=null;const audits=[];
 const db={tenantDecoration:{findUnique:async()=>stored,upsert:async({create,update})=>{stored=stored?{...stored,...update}:create}},tenantMaterial:{count:async()=>0},audit:{create:async row=>audits.push(row)}};
 const service=new TenantDecoration(db,{});service.apps.admin=async()=>{};service.apps.transaction=fn=>fn(db);service.view=async()=>stored;
 for(const [version,action] of ['save','save-and-activate','activate'].entries()){
  const result=await service.mutate({id:'editor'},'site','system',{id:defaultCurrentDecorationId,version,action,...(action==='activate'?{}:{name:'未完成装修',scheme})});
  assert.equal(result.version,version+1);assert.equal(result.published.home.blocks[0].items[0].target,'');assert.equal(result.activeId,defaultCurrentDecorationId);
 }
 assert.equal(audits.length,3);
 const save=()=>service.mutate({id:'editor'},'site','system',{id:defaultCurrentDecorationId,version:3,action:'save',name:'未完成装修',scheme});
 links.items[0].target='javascript:alert(1)';await assert.rejects(save(),{code:'DECORATION_INVALID'});
 links.items[0].target='';links.items[0].imageId='11111111-1111-4111-8111-111111111111';await assert.rejects(save(),{code:'DECORATION_IMAGE_INVALID'});
 assert.equal(stored.version,3);assert.equal(audits.length,3);
});

test('asset settings preserve actual balances, scoped destinations and valid visible items',()=>{
 const block=decorationBlock('assets','assets'),member={accountAssets:{points:1234,balanceCents:12345}};
 const items=accountAssetItems(member,block);assert.equal(items[0].value,(1234).toLocaleString());assert.equal(items[1].value,'123.45');assert.deepEqual(items.map(item=>item.target),['member','system:recharge']);
 const guest=accountAssetItems(null,block);assert.deepEqual(guest.map(item=>item.target),['member','system:recharge']);assert.deepEqual(guest.map(item=>item.value),['0','0.00']);
 assert.deepEqual(accountAssetItems({accountAssets:{points:0,balanceCents:0}},block).map(item=>item.value),['0','0.00']);
 const scheme=defaultDecoration();scheme.profile.blocks=[block];
 for(const layout of ['cards','strip','list']){block.options={assetLayout:layout,assetTitle:false,assetPoints:false,assetBalance:true,assetBalanceLabel:'可用余额',assetValueSize:32,assetLabelSize:14,assetTheme:false,assetAccent:'#336699',assetSurface:'#f8fafc',assetText:'#123456',assetMuted:'#64748b'};assert.doesNotThrow(()=>validateDecoration(scheme,basicDecoration));assert.deepEqual(accountAssetItems(member,block).map(item=>item.label),['可用余额']);assert.equal(accountAssetStyle(block,'#000000')['--asset-accent'],'#336699')}
 block.options.assetPoints=true;block.options.assetBalance=false;assert.deepEqual(accountAssetItems(member,block).map(item=>item.key),['points']);
 block.options.assetPoints=false;assert.throws(()=>validateDecoration(scheme,basicDecoration),/至少显示一项/);
 block.options.assetPoints=true;for(const value of [17,41,24.5]){block.options.assetValueSize=value;assert.throws(()=>validateDecoration(scheme,basicDecoration))}
});

test('membership and assets can share a card without changing either saved component or its destination',()=>{
 const membership=decorationBlock('membership','membership'),assets=decorationBlock('assets','assets'),blocks=[membership,assets];
 assert.equal(decorationRenderGroups(blocks).length,2);
 assets.options.assetMergeMembership=true;const saved=JSON.stringify(blocks),merged=decorationRenderGroups(blocks);
 assert.equal(merged.length,1);assert.equal(merged[0].block,assets);assert.equal(merged[0].membership,membership);assert.equal(JSON.stringify(blocks),saved);
 assert.equal(memberCardContent(membership,null).target,'system:member-levels');
 assert.deepEqual(accountAssetItems(null,assets).map(item=>[item.action,item.target]),[['积分充值','member'],['余额充值','system:recharge']]);
 const scheme=defaultDecoration();scheme.profile.blocks=blocks;assert.equal(validateDecoration(scheme,basicDecoration).profile.blocks[1].options.assetMergeMembership,true);
 assets.enabled=false;assert.equal(decorationRenderGroups(blocks).length,2);assets.enabled=true;
 membership.enabled=false;assert.equal(decorationRenderGroups(blocks).length,2);membership.enabled=true;
 assert.equal(decorationRenderGroups([assets,membership]).length,2);
 assert.equal(decorationRenderGroups([membership,decorationBlock('text','between'),assets]).length,3);
 assert.equal(decorationRenderGroups([assets])[0].membership,undefined);
 assets.options.assetMergeMembership=false;assert.equal(decorationRenderGroups(blocks).length,2);
 assets.options.assetMergeMembership='yes';assert.throws(()=>validateDecoration(scheme,basicDecoration));
});

test('cube layout, height and spacing change the rendered slots independently',()=>{
 const block=decorationBlock('gallery','cube');changeGalleryLayout(block,'row1-lt-of2-rt');
 block.appearance={...block.appearance,marginHorizontal:0,padding:0};
 block.options={imageGap:8,galleryHeight:160};
 assert.equal(block.items.length,3);assert.equal(galleryStyle(block).height,'160px');
 assert.equal(gallerySlotSize(block,0).height,160);assert.equal(gallerySlotSize(block,1).height,76);
 block.options.galleryHeight=200;assert.equal(gallerySlotSize(block,1).height,96);
 block.options.imageGap=20;assert.equal(gallerySlotSize(block,1).height,90);
 changeGalleryLayout(block,'row1-of3');assert.equal(gallerySlotSize(block,0).height,200);
 block.options.galleryHeight=0;assert.equal(galleryStyle(block).height,undefined);
});

test('navigation pagination uses the configured column count without losing entries',()=>{
 const block=decorationBlock('links','links');block.items=Array.from({length:7},(_,i)=>({id:String(i),enabled:true}));
 block.options={navDisplay:'pages',navRows:1};
 for(const columns of [1,2,3,4,5]){block.appearance.columns=columns;const pages=navigationPages(block);assert.equal(pages[0].length,columns);assert.equal(pages.flat().length,7)}
 block.items[1].enabled=false;
 block.options.navStyle='tiles';assert.deepEqual(navigationPages(block).map(page=>page.length),[6]);assert.deepEqual(navigationRows(block).map(row=>row.length),[6]);
 block.options.navStyle='icons';block.appearance.layout='list';assert.deepEqual(navigationPages(block).map(page=>page.length),[6]);assert.deepEqual(navigationRows(block).map(row=>row.length),[6]);
 block.appearance.layout='grid';assert.deepEqual(navigationPages(block).map(page=>page.length),[5,1]);
});

test('built-in card icons retain their full corners while uploaded images keep the configured radius',()=>{
 const block=decorationBlock('links','card-icons');
 for(const size of [20,40,60]){block.options.iconSize=size;block.options.iconRadius=25;const glyph=decorationIconStyle(block,true),photo=decorationIconStyle(block);assert.equal(glyph.width,size+'px');assert.equal(glyph.height,size+'px');assert.equal(glyph.borderRadius,'0px');assert.equal(photo.borderRadius,'25px')}
});

test('navigation badges scale their inset and reuse existing component spacing without changing saved settings',()=>{
 const block=decorationBlock('links','navigation');
 for(const size of [20,32,40,60]){block.options.iconSize=size;block.options.iconRadius=0;const icon=decorationNavigationIconStyle(block,true);assert.equal(parseFloat(icon.borderRadius),size/4);assert.equal(parseFloat(icon.padding),size/6);assert.equal(icon.width,size+'px');assert.equal(decorationNavigationIconStyle(block).borderRadius,'0px');assert.equal(decorationNavigationIconStyle(block).padding,undefined)}
 assert.deepEqual(navigationContentStyle(block),{'--nav-heading-top':'16px','--nav-content-x':'16px','--nav-grid-x':'8px','--nav-content-bottom':'16px'});
 block.appearance.padding=14;const saved=JSON.stringify(block);
 assert.deepEqual(navigationContentStyle(block),{'--nav-heading-top':'0px','--nav-content-x':'0px','--nav-grid-x':'0px','--nav-content-bottom':'0px'});assert.equal(JSON.stringify(block),saved);
 block.appearance.paddingTop=0;assert.equal(navigationContentStyle(block)['--nav-heading-top'],'16px');
 block.options.navStyle='tiles';assert.equal(navigationContentStyle(block)['--nav-content-x'],'0px');assert.equal(navigationContentStyle(block)['--nav-heading-top'],'16px');
});

test('gold membership is configurable and keeps public package navigation separate from member levels',()=>{
 const gold=memberPalettePreset('gold');assert.equal(gold.memberSurface,'#fff3df');assert.equal(gold.showMemberStatus,false);
 const block={type:'membership',title:'会员套餐',text:'查看套餐权益',target:'member',options:{...gold,buttonText:'查看套餐'}};
 assert.equal(memberCardContent(block,null).target,'member');assert.equal(memberCardContent(block,null).action,'查看套餐');
 assert.equal(memberCardContent({...block,target:'',options:{}},null).target,'system:member-levels');
 assert.equal(memberCardContent({...block,target:'login',options:{}},null).target,'login');
 assert.equal(memberPalettePreset('classic').memberStyle,'plain');
});

test('public card collection supports manual content and only registered application sources',()=>{
 const block=decorationBlock('collection','manual');block.items=[{id:'entry',label:'服务入口',text:'入口描述',imageId:null,target:'home'}];
 const scheme=defaultDecoration();scheme.home.blocks=[block];assert.doesNotThrow(()=>validateDecoration(scheme,basicDecoration));
 assert.equal(collectionContent(block).items[0].title,'服务入口');
 block.options.collectionSource='business-catalog';assert.throws(()=>validateDecoration(scheme,basicDecoration),/数据来源/);
 assert.doesNotThrow(()=>validateDecoration(scheme,{...basicDecoration,collections:['business-catalog']}));
 const source={type:'business-catalog',items:[{id:'real',title:'当前应用内容'}]};assert.equal(collectionContent(block,[source]),source);
 assert.deepEqual(collectionContent(block,[]).items,[]);assert.ok(basicDecoration.blocks.some(item=>item.type==='collection'));
});


test('collection count limits displayed items after search without changing source content',()=>{
 const block=decorationBlock('collection','limited'),source={items:Array.from({length:9},(_,i)=>({id:String(i),title:'卡片'+i,text:'内容'}))};
 assert.equal(collectionItems(block,source).length,6);block.options.collectionLimit=2;assert.equal(collectionItems(block,source).length,2);assert.equal(collectionItems(block,source,'卡片8')[0].id,'8');assert.equal(source.items.length,9);
 const scheme=defaultDecoration();scheme.home.blocks=[block];assert.doesNotThrow(()=>validateDecoration(scheme,basicDecoration));
 for(const value of [0,51,1.5]){block.options.collectionLimit=value;assert.throws(()=>validateDecoration(scheme,basicDecoration))}
 delete block.options.collectionLimit;assert.equal(collectionItems(block,source).length,6);
});
