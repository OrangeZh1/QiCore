import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {singleEnterprise} from './fixtures/single-enterprise.mjs';
import {isolatedDatabase} from './fixtures/isolated-database.mjs';
import {assertSafeMigrationSql} from '../dist/lifecycle/migration-safety.js';
import {Recharge} from '../src/core/recharge.mjs';
import {PaymentExecution} from '../src/payments/execution.mjs';

test('growing histories retain indexed cleanup, payment recovery and tenant pagination',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {db,url}=await isolatedDatabase(t);await singleEnterprise(db,{id:'load'});
 assertSafeMigrationSql(await readFile(new URL('../prisma/migrations/007_query_indexes/migration.sql',import.meta.url),'utf8'));
 const indexes=await db.$queryRaw`SELECT TABLE_NAME,INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()`;
 for(const [table,index] of [['AdminSession','AdminSession_expiresAt_idx'],['AdminDelegation','AdminDelegation_expiresAt_idx'],['AdminDelegation','AdminDelegation_targetAdminId_idx'],['Session','Session_tenantId_applicationKey_userId_idx']])assert.ok(indexes.some(row=>row.TABLE_NAME.toLowerCase()===table.toLowerCase()&&row.INDEX_NAME===index),table+'.'+index);
 const digit='(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)',numbers=`(SELECT a.n+10*b.n+100*c.n+1000*d.n+10000*e.n AS n FROM ${digit} a CROSS JOIN ${digit} b CROSS JOIN ${digit} c CROSS JOIN ${digit} d CROSS JOIN ${digit} e) nums`;
 const cases=[
  {name:'expired sessions',table:'Session',index:'Session_expiresAt_idx',fields:'token',filter:"expiresAt<='2026-10-28'",order:'expiresAt ASC'},
  {name:'pending notices',table:'PaymentNotice',index:'PaymentNotice_pending_idx',fields:'id',filter:"state='PENDING' AND nextCheckAt<='2026-10-28'",order:'nextCheckAt ASC'},
  {name:'pending payments',table:'PaymentRecord',index:'PaymentRecord_pending_idx',fields:'id',filter:"state IN ('PREPARING','READY') AND nextCheckAt<='2026-10-28' AND (leaseUntil IS NULL OR leaseUntil<='2026-10-28')",order:'nextCheckAt ASC'},
  {name:'pending refunds',table:'PaymentRefund',index:'PaymentRefund_pending_idx',fields:'id',filter:"state IN ('PENDING','PROCESSING','ABNORMAL') AND nextCheckAt<='2026-10-28' AND (leaseUntil IS NULL OR leaseUntil<='2026-10-28')",order:'nextCheckAt ASC'},
  {name:'consumer page',table:'ConsumerProfile',index:'ConsumerProfile_listing_idx',fields:'userId',filter:"tenantId='load' AND applicationKey='system' AND deletedAt IS NULL",order:'createdAt DESC,userId ASC'},
  {name:'tenant recharge page',table:'RechargeOrder',index:'RechargeOrder_scope_idx',fields:'id',filter:"tenantId='load' AND applicationKey='system'",order:'createdAt DESC,id DESC'}
 ];
 let previous=0;
 for(const size of [1000,10000,30000]){
  const source=`FROM ${numbers} WHERE n>=${previous} AND n<${size}`,pending='MOD(n,1000)=999';
  await db.$executeRawUnsafe(`INSERT INTO Session (token,tenantId,applicationKey,userId,role,expiresAt) SELECT LPAD(n,64,'0'),'load','system',CONCAT('u',n),'user',IF(${pending},'2000-01-01','2100-01-01') ${source}`);
  await db.$executeRawUnsafe(`INSERT INTO PaymentRecord (id,tenantId,applicationKey,orderId,userId,provider,revisionId,payerCipher,amount,currency,state,expiresAt,nextCheckAt) SELECT LPAD(n,32,'0'),'load','system',LPAD(n,20,'0'),CONCAT('u',n),'balance','fixture','fixture',100,'CNY',IF(${pending},'READY','PAID'),'2100-01-01',IF(${pending},'2001-01-01','2000-01-01') ${source}`);
  await db.$executeRawUnsafe(`INSERT INTO PaymentRefund (id,paymentId,reason,state,nextCheckAt) SELECT LPAD(n,32,'0'),LPAD(n,32,'0'),'fixture',IF(${pending},'PENDING','SUCCESS'),IF(${pending},'2001-01-01','2000-01-01') ${source}`);
  await db.$executeRawUnsafe(`INSERT INTO PaymentNotice (id,paymentId,kind,payloadHash,payloadCipher,state,nextCheckAt) SELECT LPAD(n,64,'0'),LPAD(n,32,'0'),'payment',REPEAT('a',64),'fixture',IF(${pending},'PENDING','DONE'),IF(${pending},'2001-01-01','2000-01-01') ${source}`);
  await db.$executeRawUnsafe(`INSERT INTO ConsumerProfile (tenantId,applicationKey,userId,nickname,createdAt,updatedAt) SELECT 'load','system',CONCAT('u',n),'fixture',TIMESTAMPADD(SECOND,n,'2025-01-01'),'2025-01-01' ${source}`);
  await db.$executeRawUnsafe(`INSERT INTO RechargeOrder (id,tenantId,applicationKey,userId,requestKey,payloadHash,kind,product,amount,status,createdAt) SELECT LPAD(n,20,'0'),'load','system',CONCAT('u',n),CONCAT('r',n),REPEAT('a',64),'balance_recharge',JSON_OBJECT('name','fixture'),100,'paid',TIMESTAMPADD(SECOND,n,'2025-01-01') ${source}`);
  for(const item of cases){
   await db.$queryRawUnsafe('ANALYZE TABLE `'+item.table+'`');
   const sql=hint=>`SELECT ${item.fields} FROM ${item.table} ${hint} WHERE ${item.filter} ORDER BY ${item.order} LIMIT 20`;
   const plan=JSON.parse(Object.values((await db.$queryRawUnsafe('EXPLAIN FORMAT=JSON '+sql('')))[0])[0]);
   assert.match(JSON.stringify(plan),new RegExp('"key":"'+item.index+'"'),item.name+' should use its index at '+size+' rows');
   const current=Object.values((await db.$queryRawUnsafe('EXPLAIN ANALYZE '+sql('')))[0])[0];
   const baseline=Object.values((await db.$queryRawUnsafe('EXPLAIN ANALYZE '+sql('IGNORE INDEX (`'+item.index+'`)')))[0])[0];
   t.diagnostic('query-benchmark '+JSON.stringify({rows:size,name:item.name,index:item.index,current,baseline}));
  }
  previous=size;
 }
 const notice=await db.$queryRawUnsafe("EXPLAIN FORMAT=JSON SELECT COUNT(*) FROM PaymentNotice WHERE paymentId=LPAD('999',32,'0') AND state='PENDING'");assert.match(Object.values(notice[0])[0],/PaymentNotice_payment_idx/);
 const consumer=await db.consumerProfile.findMany({where:{tenantId:'load',applicationKey:'system',deletedAt:null},orderBy:[{createdAt:'desc'},{userId:'asc'}],take:20});assert.equal(consumer[0].userId,'u29999');
 assert.equal(await db.paymentRecord.count(),30000);assert.equal(await db.paymentRefund.count(),30000);assert.equal(await db.session.count(),30000);
 for(const [id,extra] of [['other-site',{tenantId:'load-other'}],['other-app',{applicationKey:'other'}],['other-user',{userId:'other',sequence:2,currentSlot:null}]])await db.paymentRecord.create({data:{id,tenantId:'load',applicationKey:'system',orderId:'29999'.padStart(20,'0'),userId:'u29999',provider:'balance',revisionId:'fixture',payerCipher:'fixture',amount:100,currency:'CNY',state:'PAID',expiresAt:new Date('2100-01-01'),...extra}});
 const client=new PrismaClient({datasources:{db:{url}},log:[{emit:'event',level:'query'}]}),selects=[];client.$on('query',event=>{if(/^SELECT\b/i.test(event.query))selects.push(event.query)});
 try{
  const service=new Recharge(client);service.payments={history:PaymentExecution.prototype.history,view:PaymentExecution.prototype.view,enabled:false};
  for(const pageSize of [20,50]){
   selects.length=0;
   const result=await client.$transaction(tx=>service.list(tx,{tenantId:'load',applicationKey:'system'},{pageSize},true));
   assert.equal(result.items.length,pageSize);assert.equal(result.total,30000);assert.ok(result.items.every(row=>row.paymentAttempts.length===1));
   assert.equal(selects.length,4,'orders, count, payment attempts and their refunds stay batched');
   t.diagnostic('query-count '+JSON.stringify({rows:30000,pageSize,selectQueries:selects.length}));
  }
 }finally{await client.$disconnect()}
});
