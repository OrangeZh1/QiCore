import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {createApplicationDatabase,applicationPrismaVersion} from '../dist/applications/database.mjs';

function fixture(){
 let config;const base=new PrismaClient({__internal:{configOverride:c=>{config=c;return c}}});
 const model=structuredClone(config.runtimeDataModel.models.SiteSetting);
 return {base,fragment:{format:'qicore-prisma-models-v1',prismaVersion:applicationPrismaVersion,schema:'model ExampleSetting {\n id String @id @db.VarChar(32)\n value Json\n}',models:{ExampleSetting:model}}};
}
test('installed model fragments extend one client without adding models to the default framework',async()=>{
 const {base,fragment}=fixture();const db=createApplicationDatabase([fragment]);
 try{assert.equal(base.exampleSetting,undefined);assert.equal(typeof db.exampleSetting.findUnique,'function');assert.equal(typeof db.walletAccount.findUnique,'function');assert.equal(Object.keys(db._runtimeDataModel.models).length,Object.keys(base._runtimeDataModel.models).length+1)}finally{await db.$disconnect();await base.$disconnect()}
});

test('two application model namespaces coexist in the same transaction client',async()=>{
 const {base,fragment}=fixture();
 const second={...fragment,schema:fragment.schema.replace('ExampleSetting','OtherAppSetting'),models:{OtherAppSetting:structuredClone(fragment.models.ExampleSetting)}};
 const db=createApplicationDatabase([fragment,second]);
 try{assert.equal(typeof db.exampleSetting.findUnique,'function');assert.equal(typeof db.otherAppSetting.findUnique,'function');assert.equal(typeof db.walletAccount.findUnique,'function');assert.equal(Object.keys(db._runtimeDataModel.models).length,Object.keys(base._runtimeDataModel.models).length+2);const empty=createApplicationDatabase();assert.equal(empty.exampleSetting,undefined);await empty.$disconnect();const repeated=createApplicationDatabase([fragment]);assert.equal(repeated.otherAppSetting,undefined);await repeated.$disconnect()}finally{await db.$disconnect();await base.$disconnect()}
});
test('model registration rejects engine drift, shared/other-app collisions and schema directives',async()=>{
 const {base,fragment}=fixture();try{
  assert.throws(()=>createApplicationDatabase([{...fragment,prismaVersion:'7.0.0'}]),/APPLICATION_DATABASE_CONTRACT_INVALID/);
  assert.throws(()=>createApplicationDatabase([fragment,fragment]),/APPLICATION_DATABASE_MODEL_CONFLICT/);
  assert.throws(()=>createApplicationDatabase([{...fragment,schema:fragment.schema+'\ndatasource rogue { provider = "mysql" }'}]),/APPLICATION_DATABASE_SCHEMA_INVALID/);
  const model=fragment.models.ExampleSetting;
  assert.throws(()=>createApplicationDatabase([{...fragment,schema:fragment.schema.replace('ExampleSetting','SiteSetting'),models:{SiteSetting:model}}]),/APPLICATION_DATABASE_MODEL_CONFLICT/);
  assert.throws(()=>createApplicationDatabase([{...fragment,schema:fragment.schema.replace(/}$/, '@@map("SiteSetting")\n}'),models:{ExampleSetting:{...model,dbName:'SiteSetting'}}}]),/APPLICATION_DATABASE_MODEL_CONFLICT/);
 }finally{await base.$disconnect()}
});
