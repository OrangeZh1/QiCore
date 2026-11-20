import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const prismaQueryEngine='libquery_engine-debian-openssl-3.0.x.so.node';

// This policy is only for the pinned Linux Node-API client, never source dependencies.
export function nativeDependencyOmission(path){
 if(path==='node_modules/.prisma/client/query_engine_bg.wasm')return 'inactive-generated-prisma-wasm';
 if(/^node_modules\/@prisma\/client\/runtime\/(?:query_(?:engine|compiler)_bg\.(?:cockroachdb|mysql|postgresql|sqlite|sqlserver)\.wasm-base64|wasm-(?:compiler|engine)-edge)\.(?:js|mjs)$/.test(path))return 'unused-prisma-wasm';
 if([`node_modules/prisma/${prismaQueryEngine}`,`node_modules/@prisma/engines/${prismaQueryEngine}`].includes(path))return 'duplicate-prisma-query-engine';
 if(/^node_modules\/prisma\/build\/query_(?:engine|compiler)_bg\.(?:cockroachdb|mysql|postgresql|sqlite|sqlserver)\.(?:wasm|js|mjs)$/.test(path))return 'unused-prisma-cli-query-wasm';
 if(path.startsWith('node_modules/prisma/build/public/'))return 'unused-prisma-studio';
 if(path.startsWith('node_modules/prisma/prisma-client/'))return 'unused-prisma-generator-template';
 return null;
}

export async function assertNativePrismaLayout(root){
 for(const name of ['prisma','@prisma/client','@prisma/engines','.prisma/client']){
  if(JSON.parse(await readFile(join(root,'node_modules',name,'package.json'),'utf8')).version!=='6.19.3')throw Error('PACKAGE_PRISMA_VERSION_UNSUPPORTED');
 }
 const generated=await readFile(join(root,'node_modules/.prisma/client/index.js'),'utf8');
 if(!/"engineType"\s*:\s*"library"/.test(generated)||!/"activeProvider"\s*:\s*"mysql"/.test(generated)
  ||!generated.includes("require('@prisma/client/runtime/library.js')")||!/^config\.engineWasm\s*=\s*undefined\s*;?\s*$/m.test(generated)||!/^config\.compilerWasm\s*=\s*undefined\s*;?\s*$/m.test(generated))throw Error('PACKAGE_PRISMA_RUNTIME_UNSUPPORTED');
 const engine=await readFile(join(root,'node_modules/.prisma/client',prismaQueryEngine));
 for(const name of ['prisma','@prisma/engines']){
  if(!engine.equals(await readFile(join(root,'node_modules',name,prismaQueryEngine))))throw Error('PACKAGE_PRISMA_ENGINE_MISMATCH');
 }
}
