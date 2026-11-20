import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';

test('001 framework upgrades to advertising without altering existing identities, settings or balances; replay is a no-op',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db,prisma}=await isolatedDatabase(t,{migrate:false});
 prisma(['db','execute','--file','prisma/migrations/001_framework_initial/migration.sql']);prisma(['migrate','resolve','--applied','001_framework_initial']);
 await db.$executeRaw`INSERT INTO Tenant (id,name) VALUES ('kept','升级保留站点')`;
 await db.$executeRaw`INSERT INTO TenantApplication (tenantId,applicationKey,config) VALUES ('kept','fixture',${JSON.stringify({marker:'keep-application'})})`;
 await db.tenantMiniProgramSetting.create({data:{tenantId:'kept',applicationKey:'fixture',config:{appId:'wx1234567890abcdef',displayName:'保留名称'},version:7,keyCipher:'fixture-ciphertext-unchanged'}});
 await db.consumerProfile.create({data:{tenantId:'kept',applicationKey:'fixture',userId:'same-user',nickname:'保留用户'}});
 await db.walletAccount.create({data:{id:'wallet-kept',tenantId:'kept',applicationKey:'fixture',userId:'same-user',asset:'points',amount:123n,version:4}});
 const originalRecords=async()=>({
  tenant:await db.tenant.findMany({select:{id:true,name:true,version:true,contactName:true,contactPhone:true,enabled:true,createdAt:true,logo:true,storageMode:true,remark:true,customDomain:true,expiresAt:true,ownerAdminId:true}}),
  binding:await db.tenantApplication.findMany({select:{tenantId:true,applicationKey:true,enabled:true,expiresAt:true,config:true,version:true,configVersion:true}}),
  mini:await db.tenantMiniProgramSetting.findMany(),
  consumer:await db.consumerProfile.findMany(),
  wallet:await db.walletAccount.findMany()
 });
 const before=await originalRecords();
 const siteCopy={tenant:{name:'自定义企业品牌',loginTitle:'自定义企业入口',loginDescription:'统一管理租户资源、成员和业务配置。'}};
 await db.siteSetting.create({data:{id:'platform',config:siteCopy}});
 const initial=await db.$queryRawUnsafe('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL');assert.equal(initial.length,1);
 prisma(['migrate','deploy']);
 assert.deepEqual(await originalRecords(),before);
 const site=await db.siteSetting.findUniqueOrThrow({where:{id:'platform'}});
 assert.deepEqual(site.config.tenant,{...siteCopy.tenant,loginDescription:'管理站点资源、成员和业务配置。'});
 assert.equal((await db.tenant.findUniqueOrThrow({where:{id:'kept'},select:{standaloneSlot:true}})).standaloneSlot,1);
 const history=await db.$queryRawUnsafe('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');assert.equal(history.length,11);assert.deepEqual(history.slice(7).map(row=>row.migration_name),['008_standalone_enterprise','009_standalone_service_benefits','010_enterprise_maintenance_scope','011_standalone_labels']);assert.deepEqual(history[0],initial[0]);assert.equal(history[1].migration_name,'002_mini_ad_settings');assert.equal(history[2].migration_name,'003_storage_ownership');assert.equal(history[3].migration_name,'004_tenant_application_selection');assert.equal(history[4].migration_name,'005_site_storage');assert.equal(history[5].migration_name,'006_stored_images');assert.equal(history[6].migration_name,'007_query_indexes');assert.equal((await db.tenantApplication.findFirst()).activeSlot,1);assert.equal(await db.tenantMiniAdSetting.count(),0);
 const data={tenantId:'kept',applicationKey:'fixture',appId:'wx1234567890abcdef',config:{mode:'manual',homeBanner:'adunit-kept00001',profileBanner:'',homeInterstitial:'',rewarded:''},version:9};await db.tenantMiniAdSetting.create({data});const saved=await db.tenantMiniAdSetting.findMany();
 prisma(['migrate','deploy']);assert.deepEqual(await db.tenantMiniAdSetting.findMany(),saved);assert.deepEqual(await db.$queryRawUnsafe('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'),history);
 assert.equal(await db.walletEntry.count(),0);assert.equal(await db.rechargeOrder.count(),0);
});
