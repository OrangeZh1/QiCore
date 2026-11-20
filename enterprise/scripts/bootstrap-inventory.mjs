import {readFileSync,readdirSync,lstatSync,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export async function verifyBootstrapInventory(root){
const manifest=JSON.parse(readFileSync(join(root,'bootstrap-manifest.json'),'utf8')),expected=new Map(manifest.files.map(file=>[file.path,file]));
if(expected.size!==manifest.files.length)throw Error('BOOTSTRAP_MANIFEST_INVALID');
const files=[];function walk(dir,prefix=''){for(const name of readdirSync(dir)){const path=join(dir,name),key=prefix+name,stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('BOOTSTRAP_LINK_REJECTED: '+key);if(stat.isDirectory()){if(key==='.htaccess')throw Error('BOOTSTRAP_FILE_REJECTED: '+key);walk(path,key+'/')}else if(key!=='bootstrap-manifest.json'){
 if(!stat.isFile()||stat.nlink!==1)throw Error('BOOTSTRAP_FILE_REJECTED: '+key);
 // Only BaoTa's undeclared root placeholder is optional. Declared files always retain their hash check.
 if(key==='.htaccess'&&!expected.has(key)&&stat.size<=1024){
  const content=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path)).trim();
  if(content===''||content==='# 请将伪静态规则或自定义Apache配置填写到此处')continue;
 }
 files.push({path,key,size:stat.size});
}}}walk(root);
const actual=new Set(files.map(file=>file.key)),extra=[...actual].filter(key=>!expected.has(key)),missing=[...expected.keys()].filter(key=>!actual.has(key));
if(extra.length||missing.length)throw Error('BOOTSTRAP_INVENTORY_MISMATCH: '+JSON.stringify({extra:extra.slice(0,20),missing:missing.slice(0,20)}));
for(const file of files){const declared=expected.get(file.key),hash=createHash('sha256');if(declared.size!==file.size)throw Error('BOOTSTRAP_INVENTORY_MISMATCH: '+file.key);for await(const bytes of createReadStream(file.path))hash.update(bytes);if(hash.digest('hex')!==declared.sha256)throw Error('BOOTSTRAP_FILE_CHANGED: '+file.key)}
return expected;
}
