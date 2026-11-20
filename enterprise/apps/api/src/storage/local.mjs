import {mkdir,open,readFile,lstat,unlink,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,sep} from 'node:path';

export function objectPath(root,key){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.[a-z0-9]+$/.test(key)||key.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('INVALID_OBJECT_KEY');
  const target=resolve(root,key),rel=relative(resolve(root),target);
  if(!rel||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('INVALID_OBJECT_KEY');return target;
}
// The root is operator-controlled via environment; browser configuration cannot choose filesystem paths.
export async function checkedPath(root,key,create=false){
  const target=objectPath(root,key);await mkdir(root,{recursive:true,mode:0o700});
  if((await lstat(root)).isSymbolicLink())throw Error('STORAGE_ROOT_SYMLINK');
  const normalized=await realpath(root),folders=relative(resolve(root),dirname(target)).split(sep).filter(Boolean);
  let current=resolve(root);
  for(const folder of folders){current=resolve(current,folder);if(create)await mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e});const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('STORAGE_PATH_INVALID')}
  const actual=await realpath(dirname(target));if(actual!==normalized&&!actual.startsWith(normalized+sep))throw Error('STORAGE_PATH_INVALID');
  try{const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isFile())throw Error('STORAGE_PATH_INVALID')}catch(e){if(e.code!=='ENOENT')throw e}
  return target;
}
export async function putLocal(root,key,bytes){
  const target=await checkedPath(root,key,true),handle=await open(target,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync()}catch(e){await handle.close();await unlink(target).catch(()=>{});throw e}finally{await handle.close().catch(()=>{})}
}
export async function getLocal(root,key,max=20*1024*1024){const target=await checkedPath(root,key),stat=await lstat(target);if(stat.size>max)throw Error('OBJECT_TOO_LARGE');return readFile(target)}
export async function deleteLocal(root,key){try{await unlink(await checkedPath(root,key))}catch(e){if(e.code!=='ENOENT')throw e}}
