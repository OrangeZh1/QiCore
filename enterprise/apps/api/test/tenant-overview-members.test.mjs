import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {setApplicationDefinitions} from '../src/applications/catalog-state.mjs';
import {TenantOverview} from '../src/core/tenant-overview.mjs';

test('registered member count includes non-producing accounts in the current site and application only',async()=>{
 const applicationKey='members-fixture';setApplicationDefinitions([{key:applicationKey,name:'Fixture',permissions:[],overview:{read:async()=>({counts:{productionUsers:1,activeMembers:1,registeredMembers:999}}),orderRows:()=>Prisma.sql`SELECT id,userId,status,createdAt FROM FixtureOrder`}}]);
 const profiles=[{tenantId:'site-a',applicationKey,createdAt:new Date(0),deletedAt:null,enabled:true},{tenantId:'site-a',applicationKey,createdAt:new Date(0),deletedAt:null,enabled:false},{tenantId:'site-b',applicationKey,createdAt:new Date(0),deletedAt:null},{tenantId:'site-a',applicationKey:'other-app',createdAt:new Date(0),deletedAt:null},{tenantId:'site-a',applicationKey,createdAt:new Date(0),deletedAt:new Date(1)},{tenantId:'site-a',applicationKey,createdAt:new Date('2999-01-01'),deletedAt:null}];let where;
 const db={$transaction:fn=>fn(db),tenant:{findUnique:async()=>({id:'site-a'})},$queryRaw:async q=>q.sql.includes('ordersWithoutReceipt')?[{ordersWithoutReceipt:0,incompleteRefunds:0}]:[],consumerProfile:{count:async q=>{where=q.where;return profiles.filter(p=>p.tenantId===where.tenantId&&p.applicationKey===where.applicationKey&&p.deletedAt===null&&p.createdAt<=where.createdAt.lte).length}}};
 const service=new TenantOverview(db);service.context=async()=>applicationKey;const value=await service.view({},'site-a');
 assert.equal(value.counts.registeredMembers,2);assert.equal(value.counts.productionUsers,1);assert.equal(value.counts.activeMembers,1);assert.equal(where.tenantId,'site-a');assert.equal(where.applicationKey,applicationKey);assert.equal(where.deletedAt,null);assert.equal(where.createdAt.lte,value.updatedAt);
});
