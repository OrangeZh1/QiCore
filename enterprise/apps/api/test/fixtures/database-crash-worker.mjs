import {PrismaClient} from '@prisma/client';
import {Wallet} from '../../src/core/wallet.mjs';
const url=new URL(process.env.QICORE_CRASH_TEST_URL);
if(url.hostname!=='127.0.0.1'||!/^\/qicore_ads_[a-f0-9]{12}$/.test(url.pathname))throw Error('ISOLATED_DATABASE_REQUIRED');
const db=new PrismaClient({datasources:{db:{url:url.href}}}),wallet=new Wallet(db);
await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe("INSERT INTO ReviewBusiness VALUES(2,'uncommitted')");
 await wallet.credit(tx,{tenantId:'restore',applicationKey:'test-app',userId:'crash-probe'},'balance',{requestKey:'uncommitted',kind:'gift',reference:'crash',amount:10,reason:'process crash test',actor:'fixture'});
 process.send({written:true});await new Promise(()=>{});
},{timeout:30000});
