import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {nativeDependencyOmission,assertNativePrismaLayout,prismaQueryEngine} from '../../../scripts/native-runtime-policy.mjs';

test('runtime pruning preserves the generated engine, migration tools and unrelated WASM assets',()=>{
 for(const path of ['node_modules/@prisma/client/runtime/query_engine_bg.mysql.wasm-base64.js','node_modules/@prisma/client/runtime/query_compiler_bg.postgresql.wasm-base64.mjs','node_modules/@prisma/client/runtime/wasm-engine-edge.js'])assert.equal(nativeDependencyOmission(path),'unused-prisma-wasm');
 for(const prefix of ['prisma','@prisma/engines'])assert.equal(nativeDependencyOmission(`node_modules/${prefix}/${prismaQueryEngine}`),'duplicate-prisma-query-engine');
 for(const [path,reason] of [['node_modules/prisma/build/query_engine_bg.mysql.wasm','unused-prisma-cli-query-wasm'],['node_modules/prisma/build/public/assets/vendor.js','unused-prisma-studio'],['node_modules/prisma/prisma-client/runtime/library.js','unused-prisma-generator-template']])assert.equal(nativeDependencyOmission(path),reason);
 assert.equal(nativeDependencyOmission('node_modules/.prisma/client/query_engine_bg.wasm'),'inactive-generated-prisma-wasm');
 for(const path of [`node_modules/.prisma/client/${prismaQueryEngine}`,'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x','node_modules/@prisma/client/runtime/library.js','node_modules/prisma/build/index.js','node_modules/prisma/build/schema_engine_bg.wasm','node_modules/other/query_engine_bg.mysql.wasm-base64.js','apps/admin/.output/public/wasm-engine-edge.js'])assert.equal(nativeDependencyOmission(path),null,path);
});

test('pruning fails closed on Prisma version, runtime or engine drift',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-prisma-policy-'));
 t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})});
 const put=async(path,value)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),value)};
 for(const name of ['prisma','@prisma/client','@prisma/engines','.prisma/client'])await put(`node_modules/${name}/package.json`,JSON.stringify({version:'6.19.3'}));
 const generated=`require('@prisma/client/runtime/library.js');const config={"engineType":"library","activeProvider":"mysql"};\nconfig.engineWasm = undefined\nconfig.compilerWasm = undefined\n`;
 const index='node_modules/.prisma/client/index.js';await put(index,generated);
 for(const name of ['prisma','@prisma/engines','.prisma/client'])await put(`node_modules/${name}/${prismaQueryEngine}`,'same engine');
 await assertNativePrismaLayout(root);
 await put('node_modules/prisma/package.json','{"version":"6.20.0"}');await assert.rejects(assertNativePrismaLayout(root),/PACKAGE_PRISMA_VERSION_UNSUPPORTED/);
 await put('node_modules/prisma/package.json','{"version":"6.19.3"}');
 for(const code of [generated.replace('"library"','"client"'),generated.replace('"mysql"','"postgresql"'),generated.replace('config.engineWasm = undefined','config.engineWasm = {}')]){await put(index,code);await assert.rejects(assertNativePrismaLayout(root),/PACKAGE_PRISMA_RUNTIME_UNSUPPORTED/)}
 await put(index,generated);await put(`node_modules/prisma/${prismaQueryEngine}`,'different engine');await assert.rejects(assertNativePrismaLayout(root),/PACKAGE_PRISMA_ENGINE_MISMATCH/);
});
