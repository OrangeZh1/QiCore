import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {testDatabaseAccount,testMysqlClient} from './mysql-tools.mjs';

const apiRoot=fileURLToPath(new URL('../../',import.meta.url));
export async function isolatedDatabase(t,{migrate=true}={}){
 const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/qicore_test');
 const name='qicore_ads_'+randomBytes(6).toString('hex');url.pathname='/'+name;
 const rootSql=sql=>{const result=spawnSync(testMysqlClient(),['--defaults-file='+resolve(process.env.TEST_RESTORE_ROOT_CONFIG)],{input:sql,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,'isolated database operation failed')};
 rootSql('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4; GRANT ALL ON `'+name+'`.* TO '+testDatabaseAccount()+';');
 const db=new PrismaClient({datasources:{db:{url:url.href}}});
 t.after(async()=>{await db.$disconnect();rootSql('DROP DATABASE `'+name+'`; REVOKE ALL PRIVILEGES ON `'+name+'`.* FROM '+testDatabaseAccount()+';')});
 const prisma=args=>{const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args,'--schema','prisma/schema.prisma'],{cwd:apiRoot,env:{...process.env,DATABASE_URL:url.href},encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout};
 if(migrate)prisma(['migrate','deploy']);
 return{db,url:url.href,prisma};
}
