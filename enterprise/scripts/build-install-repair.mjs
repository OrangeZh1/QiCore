import {build} from 'esbuild';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const output=process.argv[2];
if(!output||!isAbsolute(output))throw Error('Use: node scripts/build-install-repair.mjs <absolute-output.mjs>');
if(existsSync(output))throw Error('REPAIR_OUTPUT_ALREADY_EXISTS');
mkdirSync(dirname(output),{recursive:true});
const repo=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[resolve(repo,'scripts/repair-initial-install.mjs')],outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:false,legalComments:'inline',external:['@prisma/client'],banner:{js:"import {createRequire as qicoreRepairRequire} from 'node:module';const require=qicoreRepairRequire(import.meta.url);"}});
const sha256=createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(output+'.sha256',sha256+'  '+output.split(/[\\/]/).at(-1)+'\n');
console.log(JSON.stringify({file:output,sha256,customerDependenciesRequired:false}));
