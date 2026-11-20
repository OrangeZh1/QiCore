import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Prisma} from '@prisma/client';
import {assertSafeMigrationSql} from '../dist/lifecycle/migration-safety.js';

const excluded=['Photo','Job','Work','Grant','Unlock','Ledger','GenerationCharge','Order','AdSession','ProviderEvent','TenantImageAiSetting','TenantImageAiTest'];
function assertFrameworkSourceBoundary(file,code){
 const path=file.replaceAll('\\','/');
 assert.doesNotMatch(code,/\b(?:FROM|JOIN)\s+`?(?:Photo|Job|Work|Grant|Unlock|Ledger|GenerationCharge|Order|AdSession|ProviderEvent)\b|\b(?:db|tx|this\.db)\.(?:photo|job|work|grant|unlock|ledger|generationCharge|order|adSession|providerEvent)\b|waterPath|cleanPath/,file+' must not depend on application models or business fields');
 // Only these two evidence declarations are allowed, never a default application.
 const identityCode=path==='license/native-release.ts'?code
  .replace(/^export const ID_PHOTO_PACKAGE_KEY = 'app_kmqjjt72urnxp526'\r?$/m,'')
  .replace("format:z.literal('id-photo-release-integrity-v1')",'format:z.literal("ordinary-evidence")'):code;
 assert.doesNotMatch(identityCode,/id-photo|app_kmqjjt72urnxp526/,file+' must not depend on application identity outside release evidence');
 if(!['license/native-release.ts','license/native-updates.ts'].includes(path))assert.doesNotMatch(code,/ID_PHOTO_PACKAGE_KEY|nativePhotoReleaseIntegritySchema/,file+' must not use release policy as application authorization');
}
test('standalone Prisma model and initial migration contain only framework tables',async()=>{
 const schema=await readFile(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
 const sql=await readFile(new URL('../prisma/migrations/001_framework_initial/migration.sql',import.meta.url),'utf8');
 const models=Prisma.dmmf.datamodel.models;
 const benefitModels=['StandaloneBenefitCatalog','StandaloneBenefitHolding','StandaloneBenefitEntry'];
 assert.deepEqual(models.filter(m=>m.name.startsWith('StandaloneBenefit')).map(m=>m.name).sort(),benefitModels.sort());
 assert.equal(models.filter(m=>!benefitModels.includes(m.name)).length,63);
 assert.ok(models.some(m=>m.name==='TenantMiniAdSetting'));
 for(const name of excluded){assert.ok(!models.some(m=>m.name===name),name);assert.ok(!sql.includes('CREATE TABLE `'+name+'`'),name)}
 assert.doesNotMatch(schema,/id-photo|legacyConfig/);
 assert.equal(models.find(m=>m.name==='Session').fields.find(f=>f.name==='applicationKey').hasDefaultValue,false);
 assert.ok(sql.startsWith('-- CreateTable'));
});

test('default package mappings and source tree exclude application runtime and sibling builds',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../src/package.json',import.meta.url),'utf8'));
 for(const value of Object.values(pkg.imports))assert.equal(value,'./applications/installed-runtime.mjs');
 const runtime=await import('../dist/applications/installed-runtime.mjs');assert.deepEqual(runtime.applicationDefinitions,[]);
 const files=await readdir(new URL('../src/',import.meta.url),{recursive:true});
 assert.ok(!files.some(f=>/(?:^|[\\/])(photo-[^\\/]+|duomi-images.mjs|openai-images.mjs|docker-effects.ts|install-cli.ts)$/.test(f)));
 const admin=await readFile(new URL('../../admin/package.json',import.meta.url),'utf8');
 const nuxt=await readFile(new URL('../../admin/nuxt.config.ts',import.meta.url),'utf8');
 assert.doesNotMatch(admin+nuxt,/@zjz|\.\.\/miniapp|F:[/\\]|prototypeIcons/);
  for(const file of files.filter(file=>/\.(?:mjs|ts)$/.test(file))){
    const code=await readFile(new URL('../src/'+file.replaceAll('\\','/'),import.meta.url),'utf8');
    assertFrameworkSourceBoundary(file,code);
  }
});

test('release evidence declarations cannot hide application queries, defaults or unrelated source coupling',()=>{
 const metadata="export const ID_PHOTO_PACKAGE_KEY = 'app_kmqjjt72urnxp526'\nconst evidence={format:z.literal('id-photo-release-integrity-v1')}";
 assert.doesNotThrow(()=>assertFrameworkSourceBoundary('license/native-release.ts',metadata));
 for(const addition of ['db.photo.findMany()','SELECT * FROM Photo',"const defaultApplication='id-photo'","const debug='id-photo-debug'","const defaultKey='app_kmqjjt72urnxp526'"]){
  assert.throws(()=>assertFrameworkSourceBoundary('license/native-release.ts',metadata+'\n'+addition));
 }
 for(const file of ['license/native-updates.ts','applications/catalog.ts'])assert.throws(()=>assertFrameworkSourceBoundary(file,metadata));
 assert.throws(()=>assertFrameworkSourceBoundary('applications/catalog.ts',"import {ID_PHOTO_PACKAGE_KEY} from '../license/native-release.js'"));
});

test('automatic migrations reject destructive and executable SQL',()=>{
 for(const sql of ['DROP TABLE `Tenant`;','DELETE FROM `Tenant`;','ALTER TABLE `Tenant` MODIFY `name` TEXT;','/*! DROP TABLE `Tenant` */','CALL unsafe();'])assert.throws(()=>assertSafeMigrationSql(sql),/MANUAL_UPGRADE_REQUIRED/);
 assert.doesNotThrow(()=>assertSafeMigrationSql('ALTER TABLE `Tenant` ADD `note` TEXT;'));
});
