import {lstatSync,existsSync,mkdirSync,chmodSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {StateStore} from '../license/store.js';
import {noLinks,syncDirectory} from './native-files.js';
import type {DomainChallengePublisher} from '../license/client.js';

const recordSchema=z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number()}).strict();
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');

// BaoTa already serves /.well-known from the project root. Publish only the transient
// public challenge, outside bootstrap/code, and never alter Nginx or existing user files.
export function bootstrapChallengePublisher(webRoot:string,bootstrapRoot:string,controlRoot:string):DomainChallengePublisher{
 if(resolve(webRoot)!==dirname(resolve(bootstrapRoot)))throw Error('BAOTA_PROJECT_DIRECTORY_REQUIRED');
 noLinks(webRoot);noLinks(controlRoot);
 const directory=join(webRoot,'.well-known'),target=join(directory,'qilicense-challenge'),store=new StateStore(controlRoot),record='domain-challenge-file.json';let busy=false;
 const present=()=>{noLinks(target);try{const stat=lstatSync(target);if(!stat.isFile()||stat.nlink!==1||stat.size>1024)throw Error('DOMAIN_CHALLENGE_FILE_UNSAFE');return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}};
 const cleanup=()=>{
  noLinks(store.path(record));const saved=store.read(record);if(!saved)return;
  const entry=recordSchema.parse(saved);if(entry.path!==target)throw Error('DOMAIN_CHALLENGE_FILE_CONFLICT');
  if(present()){
   if(hash(readFileSync(target))!==entry.sha256)throw Error('DOMAIN_CHALLENGE_FILE_CONFLICT');
   unlinkSync(target);syncDirectory(directory);
  }
  store.remove(record);syncDirectory(controlRoot);
 };
 cleanup();
 return async(response,expiresAt)=>{
  if(busy)throw Error('DOMAIN_CHALLENGE_PUBLICATION_BUSY');
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(response.token)||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error('INVALID_CHALLENGE');
  busy=true;
  try{
   cleanup();if(present())throw Error('DOMAIN_CHALLENGE_FILE_CONFLICT');
   noLinks(directory);
   if(!existsSync(directory)){mkdirSync(directory,{mode:0o755});chmodSync(directory,0o755)}
   if(!lstatSync(directory).isDirectory())throw Error('DOMAIN_CHALLENGE_FILE_UNSAFE');
   const body=JSON.stringify({token:response.token});
   store.write(record,{path:target,sha256:hash(body),expiresAt});
   const fd=openSync(target,'wx',0o644);try{writeFileSync(fd,body);fsyncSync(fd)}finally{closeSync(fd)}
   chmodSync(target,0o644);syncDirectory(directory);
   return ()=>{try{cleanup()}finally{busy=false}};
  }catch(error){busy=false;throw error}
 };
}
