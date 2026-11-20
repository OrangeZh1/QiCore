import {mkdir,readFile,writeFile,copyFile,stat,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=process.argv[2]&&resolve(process.argv[2]);
if(!output)throw Error('SDK_OUTPUT_REQUIRED');
const inside=relative(root,output);
if(inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside)&&!inside.replaceAll('\\','/').startsWith('artifacts/'))throw Error('SDK_OUTPUT_MUST_BE_EXTERNAL_OR_ARTIFACTS');
await mkdir(output,{recursive:true});
if((await readdir(output)).length)throw Error('SDK_OUTPUT_MUST_BE_EMPTY');
function run(args,cwd){if(!process.env.npm_execpath)throw Error('Run pnpm package:sdk <output-directory>');const result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd,encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr||result.stdout);return result.stdout}
const built=spawnSync(process.execPath,[join(root,'packages/application-sdk/build.mjs'),'--incremental'],{cwd:root,encoding:'utf8',windowsHide:true});if(built.status!==0)throw Error(built.stderr||built.stdout);
const packages=[];
for(const directory of ['application-sdk','qisvc-console-ui']){
 const source=join(root,'packages',directory),pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
 const file=pkg.name.replace(/^@/,'').replace('/','-')+'-'+pkg.version+'.tgz';
 // Refuse to replace a published kit silently; callers select a fresh output.
 if(await stat(join(output,file)).then(()=>true,()=>false))throw Error('SDK_ARCHIVE_ALREADY_EXISTS');
 run(['pack','--pack-destination',output],source);
 const bytes=await readFile(join(output,file));packages.push({name:pkg.name,version:pkg.version,file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await copyFile(join(root,'packages/application-sdk/install.mjs'),join(output,'install.mjs'));
await copyFile(join(root,'docs/extension-development.md'),join(output,'DEVELOPMENT.md'));
await writeFile(join(output,'README.md'),'# QiCore 独立开发 SDK\n\n执行 `node <本目录>/install.mjs <应用目录>`，再在应用目录执行 `pnpm install --frozen-lockfile`。使用 `pnpm dev --host <官方宿主目录>` 联调。\n\n完整契约见 [独立开发协议](DEVELOPMENT.md)。本命令只生成本地开发包，不发布或部署线上服务。\n');
await writeFile(join(output,'sdk-kit.json'),JSON.stringify({format:'qicore-sdk-kit-v1',packages},null,2)+'\n');
console.log(JSON.stringify({output,packages}));
