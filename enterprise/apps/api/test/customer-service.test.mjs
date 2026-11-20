import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TenantConsumerSettings,consumerSettingDefaults,customerServiceConfig} from '../src/core/tenant-consumer-settings.mjs';
import {ConsumerMemberLevels} from '../src/core/consumer-member-levels.mjs';
import QRCode from 'qrcode';
import sharp from 'sharp';

test('customer settings preserve other sections and enforce version, write permission and public scope',async()=>{
 let row={tenantId:'tenant-a',applicationKey:'app-a',version:2,nextNumber:37,config:consumerSettingDefaults()},writable=true;const audits=[];
 const db={tenantConsumerSetting:{findUnique:async()=>structuredClone(row),upsert:async({update})=>{row={...row,config:update.config,version:row.version+1}}},tenant:{findUnique:async()=>({name:'Tenant'})},tenantSiteSetting:{findUnique:async()=>null},audit:{create:async({data})=>audits.push(data)}};
 const service=new TenantConsumerSettings(db),check=(tenant,key)=>{assert.equal(tenant,'tenant-a');assert.equal(key,'app-a')};
 service.apps={available:async(tenant,key)=>check(tenant,key),admin:async(_s,tenant,key)=>{check(tenant,key);if(!writable)throw Error('forbidden')},featureContext:async(_db,_s,tenant,key)=>{check(tenant,key);return{selected:{key},sources:[],permissions:writable?['settings.read','settings.write']:['settings.read']}},transaction:async work=>work(db)};
 const config={miniMode:'official',phone:'400-123-4567',wechat:'service_account',description:'服务时间\n工作日 09:00–18:00',avatar:null,qrCode:null},oldUsers=structuredClone(row.config.users);
 await service.save({id:'admin'},'tenant-a','app-a','customerService',{version:2,config});assert.deepEqual(row.config.users,oldUsers);assert.equal(row.nextNumber,37);assert.equal(row.version,3);assert.equal(audits.length,1);
 assert.deepEqual(await service.publicCustomerService({tenantId:'tenant-a',applicationKey:'app-a'}),config);
 await assert.rejects(service.publicCustomerService({tenantId:'tenant-a',applicationKey:'app-a',userId:'injected'}));await assert.rejects(service.publicCustomerService({tenantId:'tenant-b',applicationKey:'app-a'}));
 await assert.rejects(service.save({id:'admin'},'tenant-a','app-a','customerService',{version:2,config}),/设置已更新/);
 const png=await QRCode.toDataURL('https://example.com/customer-service-test',{width:256,margin:3});
 await service.save({id:'admin'},'tenant-a','app-a','customerService',{version:3,config:{...config,avatar:png,qrCode:png}});
 for(const [field,size] of [['avatar',256],['qrCode',512]]){assert.match(row.config.customerService[field],/^data:image\/webp;base64,/);const meta=await sharp(Buffer.from(row.config.customerService[field].split(',')[1],'base64')).metadata();assert.equal(meta.width,size);assert.equal(meta.height,size)}
 await assert.rejects(service.save({id:'admin'},'tenant-a','app-a','customerService',{version:4,config:{...config,qrCode:'data:image/svg+xml;base64,PHN2Zy8+'}}));assert.equal(row.version,4);
 writable=false;await assert.rejects(service.save({id:'admin'},'tenant-a','app-a','customerService',{version:4,config}),/forbidden/);assert.equal(row.version,4);
 assert.deepEqual(customerServiceConfig({miniMode:'invalid',phone:'<script>'}),{miniMode:'page',phone:'',wechat:'',description:'',avatar:null,qrCode:null});
});

test('anonymous member catalog exposes configured rules without reading a profile or account metrics',async()=>{
 const scope={tenantId:'tenant-a',applicationKey:'app-a'},db={consumerProfile:{findUnique(){throw Error('private read')}},memberRule:{findUnique:async()=>({registrationGrowth:10,purchaseGrowthPerYuan:2})},memberLevel:{findMany:async({where})=>{assert.deepEqual(where,scope);return[{id:'level-a',name:'黄金会员',rank:1,conditions:{growth:100},benefits:{}}]}}};
 const service=new ConsumerMemberLevels(db);let checks=0;service.apps={available:async(tenant,key)=>{assert.equal(tenant,scope.tenantId);assert.equal(key,scope.applicationKey);checks++}};
 const value=await service.publicView(scope);assert.equal(checks,2);assert.equal(value.levels.at(-1).name,'黄金会员');assert.equal(value.levels.at(-1).criteria[0].current,null);assert.deepEqual(value.growthRules,{registration:10,perYuan:2});
 for(const key of ['profile','current','growth','nextId'])assert.equal(Object.hasOwn(value,key),false);
 await assert.rejects(service.publicView({...scope,userId:'injected'}));
});
