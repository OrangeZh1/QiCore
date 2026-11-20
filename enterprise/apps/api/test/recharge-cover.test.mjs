import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Recharge,rechargeDefaults} from '../src/core/recharge.mjs';
import {TenantVirtualGoods} from '../src/core/tenant-virtual-goods.mjs';

test('recharge covers are scoped, persist on old-client saves and clear explicitly',async()=>{
 const config=rechargeDefaults(),id=randomUUID();config.points.push({id,name:'基础套餐',priceCents:199,points:20,giftPoints:0,enabled:true,sort:0});let row={version:1,config};const calls=[],scope={tenantId:'site-a',applicationKey:'app-a'};
 const db={rechargeSetting:{findUnique:async()=>row,upsert:async({update})=>row={version:row.version+1,config:structuredClone(update.config)}}};
 const storage={imageReference:async(value,site)=>{calls.push({value,site});if(value.includes('site-b'))throw Error('foreign image');return value}};
 const service=new Recharge(db,{storage});service.apps={transaction:fn=>fn(db)};service.adminContext=async()=>({...scope,canWrite:true});service.audit=async()=>{};
 const save=async config=>service.saveConfig({},scope.tenantId,scope.applicationKey,{version:row.version,config});
 let next=structuredClone(row.config);next.points[0].image='https://assets.example/site-a/cover.webp';await save(next);assert.equal(calls[0].site,'site-a');assert.equal(row.config.points[0].image,next.points[0].image);
 next=structuredClone(row.config);delete next.points[0].image;await save(next);assert.equal(row.config.points[0].image,'https://assets.example/site-a/cover.webp');assert.equal(calls.length,1);
 next=structuredClone(row.config);next.points[0].image='https://assets.example/site-b/cover.webp';await assert.rejects(save(next),/foreign image/);assert.equal(row.version,3);
 next=structuredClone(row.config);next.points[0].image=null;await save(next);assert.equal(row.config.points[0].image,null);
});
test('virtual goods inherit recharge metadata and preserve legacy covers until explicitly maintained',()=>{
 const service=new TenantVirtualGoods({}, {apps:{}},{}),source={localId:'recharge-points-package',name:'新套餐',price:199,image:'https://assets.example/new.webp',remark:'20积分',rechargeSnapshot:{asset:'points',id:'package',price:199,base:20,gift:0}},draft={localId:source.localId,version:1,config:{name:'旧名称',price:299,image:'https://assets.example/old.webp',productId:'existing-product'}};
 const read=value=>service.candidates('site','app',{sources:[value],drafts:[draft]})[0];
 const current=read(source);assert.equal(current.name,source.name);assert.equal(current.price,199);assert.equal(current.image,source.image);assert.equal(current.productId,'existing-product');assert.equal(current.reason,'');
 const cleared=read({...source,image:null});assert.equal(cleared.image,null);assert.match(cleared.reason,/充值配置/);assert.notEqual(cleared.snapshotHash,current.snapshotHash);
 const legacy={...source};delete legacy.image;assert.equal(read(legacy).image,draft.config.image);
});
