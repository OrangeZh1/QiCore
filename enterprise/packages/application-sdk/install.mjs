import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// A downloaded SDK kit contains this standalone installer. No framework source,
// registry publication or package-manager configuration is needed to bootstrap.
export async function installSdk(kit,target){
 const manifest=JSON.parse(await readFile(join(kit,'sdk-kit.json'),'utf8'));
 if(manifest.format!=='qicore-sdk-kit-v1'||!Array.isArray(manifest.packages)||manifest.packages.length!==2)throw Error('SDK_KIT_INVALID');
 const expected=new Set(['@qicore/application-sdk','@orangezh1/qisvc-console-ui']);
 const verified=[];
 for(const item of manifest.packages){
  if(!expected.delete(item.name)||!/^\d+\.\d+\.\d+$/.test(item.version)||! /^[a-z0-9.-]+\.tgz$/.test(item.file))throw Error('SDK_KIT_INVALID');
  const bytes=await readFile(join(kit,item.file));
  if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('SDK_KIT_INTEGRITY_FAILED');
  verified.push(item);
 }
 if(expected.size)throw Error('SDK_KIT_INVALID');
 // Require the project to declare these exact versions before writing anything.
 const pkg=JSON.parse(await readFile(join(target,'package.json'),'utf8'));
 for(const item of verified)if(pkg.qicore?.sdk?.[item.name]!==item.version)throw Error('SDK_KIT_VERSION_MISMATCH: '+item.name);
 const output=join(target,'.local/qicore-sdk');await mkdir(output,{recursive:true});
 for(const item of verified)await copyFile(join(kit,item.file),join(output,item.file));
 await writeFile(join(output,'sdk-kit.json'),JSON.stringify(manifest,null,2)+'\n');
 return {target,packages:verified.map(item=>({name:item.name,version:item.version}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(!process.argv[2])throw Error('Usage: node <sdk-kit>/install.mjs <application-directory>');console.log(JSON.stringify(await installSdk(dirname(fileURLToPath(import.meta.url)),resolve(process.argv[2]))))}
 catch(error){console.error(error.message);process.exitCode=1}
}
